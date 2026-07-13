package biz

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/dramaip/dramaip-platform/services/app/auth/service/internal/conf"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const emailActionTTL = 15 * time.Minute

type emailActionSender struct {
	url          string
	token        string
	from         string
	requireHTTPS bool
	client       *http.Client
}

type emailEnvelope struct {
	To       string `json:"to"`
	From     string `json:"from,omitempty"`
	Template string `json:"template"`
	Subject  string `json:"subject"`
	Text     string `json:"text"`
}

func newEmailActionSender(cfg conf.EmailConfig, environment string) *emailActionSender {
	timeout := kratosx.Duration(cfg.Timeout, 10*time.Second)
	return &emailActionSender{
		url: strings.TrimSpace(cfg.DeliveryURL), token: strings.TrimSpace(cfg.DeliveryToken), from: strings.TrimSpace(cfg.From),
		requireHTTPS: isProductionEnvironment(environment), client: &http.Client{Timeout: timeout},
	}
}

func (s *emailActionSender) Send(ctx context.Context, to string, purpose string, code string) error {
	if s == nil || s.url == "" {
		return status.Error(codes.FailedPrecondition, "email delivery is not configured")
	}
	endpoint, err := url.Parse(s.url)
	if err != nil || endpoint.Scheme == "" || endpoint.Host == "" || s.requireHTTPS && endpoint.Scheme != "https" {
		return status.Error(codes.FailedPrecondition, "email delivery endpoint is invalid")
	}
	subject, text := emailMessage(purpose, code)
	body, err := json.Marshal(emailEnvelope{To: to, From: s.from, Template: purpose, Subject: subject, Text: text})
	if err != nil {
		return status.Error(codes.Internal, "email delivery request failed")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.url, bytes.NewReader(body))
	if err != nil {
		return status.Error(codes.Internal, "email delivery request failed")
	}
	req.Header.Set("Content-Type", "application/json")
	if s.token != "" {
		req.Header.Set("Authorization", "Bearer "+s.token)
	}
	response, err := s.client.Do(req)
	if err != nil {
		return status.Error(codes.Unavailable, "email delivery unavailable")
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return status.Error(codes.Unavailable, "email delivery unavailable")
	}
	return nil
}

func emailMessage(purpose string, code string) (string, string) {
	if purpose == "reset_password" {
		return "DramaIP 密码重置验证码", fmt.Sprintf("你的 DramaIP 密码重置验证码是：%s。验证码将在 15 分钟后失效；请勿向任何人透露。", code)
	}
	return "DramaIP 邮箱验证验证码", fmt.Sprintf("你的 DramaIP 邮箱验证验证码是：%s。验证码将在 15 分钟后失效；请勿向任何人透露。", code)
}
