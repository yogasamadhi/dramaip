package com.dramaip.platform.creation.service;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/** Small, dependency-free AWS Signature V4 client for the private review-media bucket. */
@Component
public class ReviewObjectStore {
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("yyyyMMdd").withZone(ZoneOffset.UTC);
    private static final DateTimeFormatter AMZ_TIME = DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'").withZone(ZoneOffset.UTC);
    private final URI endpoint;
    private final String region;
    private final String bucket;
    private final String accessKey;
    private final String secretKey;
    private final boolean allowInsecure;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    public ReviewObjectStore(
            @Value("${dramaip.review.object-store.endpoint:}") String endpoint,
            @Value("${dramaip.review.object-store.region:us-east-1}") String region,
            @Value("${dramaip.review.object-store.bucket:}") String bucket,
            @Value("${dramaip.review.object-store.access-key:}") String accessKey,
            @Value("${dramaip.review.object-store.secret-key:}") String secretKey,
            @Value("${dramaip.review.object-store.allow-insecure:false}") boolean allowInsecure) {
        this.endpoint = endpoint == null || endpoint.isBlank() ? null : URI.create(endpoint.replaceAll("/+$", ""));
        this.region = region;
        this.bucket = bucket;
        this.accessKey = accessKey;
        this.secretKey = secretKey;
        this.allowInsecure = allowInsecure;
    }

    public void check() {
        URI signed = presign("HEAD", "", Map.of(), Duration.ofMinutes(1)).url();
        HttpResponse<Void> response = send(HttpRequest.newBuilder(signed).method("HEAD", HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.discarding());
        if (response.statusCode() < 200 || response.statusCode() >= 400) unavailable("review object-store health check returned " + response.statusCode());
    }

    public SignedUrl presignPut(String objectKey, String contentType, String sha256) {
        return presign("PUT", objectKey, Map.of("content-type", contentType, "x-amz-meta-sha256", sha256), Duration.ofMinutes(15));
    }

    public SignedUrl presignGet(String objectKey) { return presign("GET", objectKey, Map.of(), Duration.ofMinutes(15)); }

    public void verify(String objectKey, long expectedBytes, String expectedSha256) {
        URI signed = presign("HEAD", objectKey, Map.of(), Duration.ofMinutes(1)).url();
        HttpResponse<Void> response = send(HttpRequest.newBuilder(signed).method("HEAD", HttpRequest.BodyPublishers.noBody()).build(), HttpResponse.BodyHandlers.discarding());
        long actualBytes = response.headers().firstValueAsLong("content-length").orElse(-1);
        String actualSha256 = response.headers().firstValue("x-amz-meta-sha256").orElse("").trim().toLowerCase(Locale.ROOT);
        if (response.statusCode() != 200 || actualBytes != expectedBytes || !actualSha256.equals(expectedSha256.toLowerCase(Locale.ROOT))) {
            unavailable("review object is missing or does not match its declared checksum");
        }
    }

    public void delete(String objectKey) {
        URI signed = presign("DELETE", objectKey, Map.of(), Duration.ofMinutes(1)).url();
        HttpResponse<Void> response = send(HttpRequest.newBuilder(signed).DELETE().build(), HttpResponse.BodyHandlers.discarding());
        if (response.statusCode() < 200 || response.statusCode() >= 300) unavailable("review object deletion returned " + response.statusCode());
    }

    private SignedUrl presign(String method, String objectKey, Map<String, String> requestedHeaders, Duration lifetime) {
        validateConfiguration();
        Instant now = Instant.now();
        String date = DAY.format(now);
        String timestamp = AMZ_TIME.format(now);
        String canonicalUri = canonicalUri(objectKey);
        String scope = date + "/" + region + "/s3/aws4_request";
        Map<String, String> headers = new TreeMap<>();
        headers.put("host", endpoint.getRawAuthority());
        requestedHeaders.forEach((name, value) -> headers.put(name.toLowerCase(Locale.ROOT), value.trim()));
        StringBuilder canonicalHeaders = new StringBuilder();
        headers.forEach((name, value) -> canonicalHeaders.append(name).append(':').append(value).append('\n'));
        String signedHeaders = String.join(";", headers.keySet());
        Map<String, String> query = new TreeMap<>();
        query.put("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
        query.put("X-Amz-Credential", accessKey + "/" + scope);
        query.put("X-Amz-Date", timestamp);
        query.put("X-Amz-Expires", Long.toString(lifetime.toSeconds()));
        query.put("X-Amz-SignedHeaders", signedHeaders);
        String canonicalQuery = query(query);
        String canonicalRequest = String.join("\n", method, canonicalUri, canonicalQuery, canonicalHeaders.toString(), signedHeaders, "UNSIGNED-PAYLOAD");
        String stringToSign = "AWS4-HMAC-SHA256\n" + timestamp + "\n" + scope + "\n" + sha256(canonicalRequest.getBytes(StandardCharsets.UTF_8));
        query.put("X-Amz-Signature", HexFormat.of().formatHex(hmac(signingKey(date), stringToSign)));
        URI url = URI.create(endpoint.getScheme() + "://" + endpoint.getRawAuthority() + canonicalUri + "?" + query(query));
        return new SignedUrl(url, Map.copyOf(requestedHeaders), now.plus(lifetime));
    }

    private void validateConfiguration() {
        if (endpoint == null || endpoint.getHost() == null || bucket == null || bucket.isBlank() || accessKey == null || accessKey.isBlank() || secretKey == null || secretKey.isBlank()) {
            unavailable("private review object store is not configured");
        }
        if (!"https".equalsIgnoreCase(endpoint.getScheme()) && !(allowInsecure && "http".equalsIgnoreCase(endpoint.getScheme()))) {
            unavailable("review object-store endpoint must use HTTPS");
        }
    }

    private String canonicalUri(String objectKey) {
        String prefix = endpoint.getRawPath() == null ? "" : endpoint.getRawPath().replaceAll("/+$", "");
        StringBuilder path = new StringBuilder(prefix).append('/').append(encode(bucket));
        for (String segment : objectKey.split("/")) if (!segment.isBlank()) path.append('/').append(encode(segment));
        return path.toString();
    }

    private byte[] signingKey(String date) {
        return hmac(hmac(hmac(hmac(("AWS4" + secretKey).getBytes(StandardCharsets.UTF_8), date), region), "s3"), "aws4_request");
    }

    private static String query(Map<String, String> values) {
        return values.entrySet().stream().map(entry -> encode(entry.getKey()) + "=" + encode(entry.getValue())).reduce((left, right) -> left + "&" + right).orElse("");
    }

    private static String encode(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20").replace("%7E", "~"); }

    private static String sha256(byte[] value) {
        try { return HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(value)); }
        catch (GeneralSecurityException exception) { throw new IllegalStateException(exception); }
    }

    private static byte[] hmac(byte[] key, String value) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(value.getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException exception) { throw new IllegalStateException(exception); }
    }

    private <T> HttpResponse<T> send(HttpRequest request, HttpResponse.BodyHandler<T> bodyHandler) {
        try { return client.send(request, bodyHandler); }
        catch (Exception exception) { throw new com.dramaip.platform.common.web.BusinessException("CREATION_REVIEW_STORAGE_UNAVAILABLE", "private review storage is unavailable", HttpStatus.SERVICE_UNAVAILABLE); }
    }

    private static void unavailable(String message) { throw new com.dramaip.platform.common.web.BusinessException("CREATION_REVIEW_STORAGE_UNAVAILABLE", message, HttpStatus.SERVICE_UNAVAILABLE); }

    public record SignedUrl(URI url, Map<String, String> headers, Instant expiresAt) { }
}
