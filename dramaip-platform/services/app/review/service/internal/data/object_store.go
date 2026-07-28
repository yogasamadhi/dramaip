package data

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/dramaip/dramaip-platform/services/app/review/service/internal/conf"
)

var ErrObjectStoreUnavailable = errors.New("private review object store is not configured")

type SignedObjectURL struct {
	URL       string
	Headers   map[string]string
	ExpiresAt time.Time
}

type ObjectStore interface {
	Check(context.Context) error
	PresignPut(string, string, string, time.Duration) (SignedObjectURL, error)
	PresignGet(string, time.Duration) (SignedObjectURL, error)
	Verify(context.Context, string, int64, string) error
	Delete(context.Context, string) error
}

type S3CompatibleStore struct {
	endpoint, region, bucket, accessKey, secretKey string
	client                                         *http.Client
	configError                                    error
}

func NewS3CompatibleStore(cfg *conf.Bootstrap) *S3CompatibleStore {
	store := &S3CompatibleStore{
		endpoint: strings.TrimRight(cfg.ObjectStore.Endpoint, "/"),
		region:   cfg.ObjectStore.Region, bucket: cfg.ObjectStore.Bucket,
		accessKey: cfg.ObjectStore.AccessKey, secretKey: cfg.ObjectStore.SecretKey,
		client: &http.Client{Timeout: 15 * time.Second},
	}
	if store.endpoint == "" || store.bucket == "" || store.accessKey == "" || store.secretKey == "" {
		store.configError = ErrObjectStoreUnavailable
		return store
	}
	parsed, err := url.Parse(store.endpoint)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && strings.ToLower(cfg.Environment) != "development" && strings.ToLower(cfg.Environment) != "test") {
		store.configError = fmt.Errorf("%w: endpoint must be a valid HTTPS URL", ErrObjectStoreUnavailable)
	}
	return store
}

func (store *S3CompatibleStore) Check(ctx context.Context) error {
	if store.configError != nil {
		return store.configError
	}
	signed, err := store.presign(http.MethodHead, "", nil, time.Minute)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodHead, signed.URL, nil)
	if err != nil {
		return err
	}
	response, err := store.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 400 {
		return fmt.Errorf("review object store health returned %s", response.Status)
	}
	return nil
}

func (store *S3CompatibleStore) PresignPut(objectKey, mimeType, digest string, expiry time.Duration) (SignedObjectURL, error) {
	return store.presign(http.MethodPut, objectKey, map[string]string{
		"content-type":      mimeType,
		"x-amz-meta-sha256": digest,
	}, expiry)
}

func (store *S3CompatibleStore) PresignGet(objectKey string, expiry time.Duration) (SignedObjectURL, error) {
	return store.presign(http.MethodGet, objectKey, nil, expiry)
}

func (store *S3CompatibleStore) Verify(ctx context.Context, objectKey string, expectedBytes int64, expectedSHA256 string) error {
	signed, err := store.presign(http.MethodHead, objectKey, nil, time.Minute)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodHead, signed.URL, nil)
	if err != nil {
		return err
	}
	response, err := store.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		_, _ = io.CopyN(io.Discard, response.Body, 4<<10)
		return fmt.Errorf("review object %q returned %s", objectKey, response.Status)
	}
	actualBytes, err := strconv.ParseInt(response.Header.Get("Content-Length"), 10, 64)
	if err != nil || actualBytes != expectedBytes {
		return fmt.Errorf("review object %q size mismatch", objectKey)
	}
	if actualDigest := strings.ToLower(strings.TrimSpace(response.Header.Get("x-amz-meta-sha256"))); actualDigest != strings.ToLower(expectedSHA256) {
		return fmt.Errorf("review object %q checksum metadata mismatch", objectKey)
	}
	return nil
}

func (store *S3CompatibleStore) Delete(ctx context.Context, objectKey string) error {
	signed, err := store.presign(http.MethodDelete, objectKey, nil, time.Minute)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodDelete, signed.URL, nil)
	if err != nil {
		return err
	}
	response, err := store.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.CopyN(io.Discard, response.Body, 4<<10)
		return fmt.Errorf("delete review object %q returned %s", objectKey, response.Status)
	}
	return nil
}

func (store *S3CompatibleStore) presign(method, objectKey string, signedHeaders map[string]string, expiry time.Duration) (SignedObjectURL, error) {
	if store.configError != nil {
		return SignedObjectURL{}, store.configError
	}
	if expiry <= 0 || expiry > 15*time.Minute {
		return SignedObjectURL{}, fmt.Errorf("signed URL lifetime must be between 1 second and 15 minutes")
	}
	base, err := url.Parse(store.endpoint)
	if err != nil {
		return SignedObjectURL{}, err
	}
	segments := []string{strings.Trim(base.EscapedPath(), "/"), escapePathSegment(store.bucket)}
	for _, segment := range strings.Split(strings.Trim(objectKey, "/"), "/") {
		if segment != "" {
			segments = append(segments, escapePathSegment(segment))
		}
	}
	filtered := segments[:0]
	for _, segment := range segments {
		if segment != "" {
			filtered = append(filtered, segment)
		}
	}
	canonicalURI := "/" + strings.Join(filtered, "/")
	now := time.Now().UTC()
	date := now.Format("20060102")
	amzDate := now.Format("20060102T150405Z")
	scope := date + "/" + store.region + "/s3/aws4_request"

	headers := map[string]string{"host": base.Host}
	for name, value := range signedHeaders {
		headers[strings.ToLower(strings.TrimSpace(name))] = strings.TrimSpace(value)
	}
	headerNames := make([]string, 0, len(headers))
	for name := range headers {
		headerNames = append(headerNames, name)
	}
	sortStrings(headerNames)
	var canonicalHeaders strings.Builder
	for _, name := range headerNames {
		canonicalHeaders.WriteString(name)
		canonicalHeaders.WriteByte(':')
		canonicalHeaders.WriteString(headers[name])
		canonicalHeaders.WriteByte('\n')
	}
	signedHeaderNames := strings.Join(headerNames, ";")
	query := url.Values{}
	query.Set("X-Amz-Algorithm", "AWS4-HMAC-SHA256")
	query.Set("X-Amz-Credential", store.accessKey+"/"+scope)
	query.Set("X-Amz-Date", amzDate)
	query.Set("X-Amz-Expires", strconv.FormatInt(int64(expiry/time.Second), 10))
	query.Set("X-Amz-SignedHeaders", signedHeaderNames)
	canonicalQuery := query.Encode()
	canonicalRequest := strings.Join([]string{
		method,
		canonicalURI,
		canonicalQuery,
		canonicalHeaders.String(),
		signedHeaderNames,
		"UNSIGNED-PAYLOAD",
	}, "\n")
	requestDigest := sha256.Sum256([]byte(canonicalRequest))
	stringToSign := "AWS4-HMAC-SHA256\n" + amzDate + "\n" + scope + "\n" + hex.EncodeToString(requestDigest[:])
	signature := hex.EncodeToString(hmacSHA256(signingKey(store.secretKey, date, store.region), stringToSign))
	query.Set("X-Amz-Signature", signature)
	signedURL := base.Scheme + "://" + base.Host + canonicalURI + "?" + query.Encode()
	required := make(map[string]string, len(signedHeaders))
	for name, value := range signedHeaders {
		required[name] = value
	}
	return SignedObjectURL{URL: signedURL, Headers: required, ExpiresAt: now.Add(expiry)}, nil
}

func signingKey(secret, date, region string) []byte {
	dateKey := hmacSHA256([]byte("AWS4"+secret), date)
	regionKey := hmacSHA256(dateKey, region)
	serviceKey := hmacSHA256(regionKey, "s3")
	return hmacSHA256(serviceKey, "aws4_request")
}

func hmacSHA256(key []byte, value string) []byte {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(value))
	return mac.Sum(nil)
}

func escapePathSegment(value string) string {
	return strings.ReplaceAll(url.PathEscape(value), "+", "%20")
}

func sortStrings(values []string) {
	for index := 1; index < len(values); index++ {
		for cursor := index; cursor > 0 && values[cursor] < values[cursor-1]; cursor-- {
			values[cursor], values[cursor-1] = values[cursor-1], values[cursor]
		}
	}
}
