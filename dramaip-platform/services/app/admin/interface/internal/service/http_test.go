package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	aiv1 "github.com/dramaip/dramaip-platform/services/api/ai_gateway/service/v1"
	authv1 "github.com/dramaip/dramaip-platform/services/api/auth/service/v1"
	billingv1 "github.com/dramaip/dramaip-platform/services/api/billing/service/v1"
	notificationv1 "github.com/dramaip/dramaip-platform/services/api/notification/service/v1"
	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	reportingv1 "github.com/dramaip/dramaip-platform/services/api/reporting/service/v1"
	userv1 "github.com/dramaip/dramaip-platform/services/api/user/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/admin/interface/internal/biz"
	"github.com/dramaip/dramaip-platform/services/app/admin/interface/internal/conf"
	"github.com/dramaip/dramaip-platform/services/app/admin/interface/internal/data"
	"golang.org/x/crypto/bcrypt"
	"google.golang.org/grpc"
)

func TestAdminHTTPRejectsCustomerTokenAndEnforcesConfirmation(t *testing.T) {
	router := newTestHTTPService(t).Router()
	customer := httptest.NewRequest(http.MethodGet, "/v1/admin/me", nil)
	customer.Header.Set("Authorization", "Bearer customer-access-token")
	customerRecorder := httptest.NewRecorder()
	router.ServeHTTP(customerRecorder, customer)
	if customerRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("customer token status = %d: %s", customerRecorder.Code, customerRecorder.Body.String())
	}
	login := httptest.NewRequest(http.MethodPost, "/v1/admin/auth/login", bytes.NewBufferString(`{"email":"security@example.com","password":"correct-password"}`))
	loginRecorder := httptest.NewRecorder()
	router.ServeHTTP(loginRecorder, login)
	if loginRecorder.Code != http.StatusOK {
		t.Fatalf("login = %d: %s", loginRecorder.Code, loginRecorder.Body.String())
	}
	var session struct {
		AccessToken string `json:"access_token"`
	}
	_ = json.Unmarshal(loginRecorder.Body.Bytes(), &session)
	overview := httptest.NewRequest(http.MethodGet, "/v1/admin/reporting/overview", nil)
	overview.Header.Set("Authorization", "Bearer "+session.AccessToken)
	overviewRecorder := httptest.NewRecorder()
	router.ServeHTTP(overviewRecorder, overview)
	if overviewRecorder.Code != http.StatusOK || !bytes.Contains(overviewRecorder.Body.Bytes(), []byte(`"user_count":3`)) {
		t.Fatalf("overview = %d: %s", overviewRecorder.Code, overviewRecorder.Body.String())
	}
	confirmation := httptest.NewRequest(http.MethodPost, "/v1/admin/confirmations", bytes.NewBufferString(`{"action":"principal.suspend","target_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","reason":"approved offboarding"}`))
	confirmation.Header.Set("Authorization", "Bearer "+session.AccessToken)
	confirmationRecorder := httptest.NewRecorder()
	router.ServeHTTP(confirmationRecorder, confirmation)
	if confirmationRecorder.Code != http.StatusCreated {
		t.Fatalf("confirmation = %d: %s", confirmationRecorder.Code, confirmationRecorder.Body.String())
	}
	var reply struct {
		Confirmation struct {
			ID string `json:"id"`
		} `json:"confirmation"`
	}
	_ = json.Unmarshal(confirmationRecorder.Body.Bytes(), &reply)
	suspend := httptest.NewRequest(http.MethodPost, "/v1/admin/principals/suspend", bytes.NewBufferString(`{"target_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","confirmation_id":"`+reply.Confirmation.ID+`"}`))
	suspend.Header.Set("Authorization", "Bearer "+session.AccessToken)
	suspendRecorder := httptest.NewRecorder()
	router.ServeHTTP(suspendRecorder, suspend)
	if suspendRecorder.Code != http.StatusOK || !bytes.Contains(suspendRecorder.Body.Bytes(), []byte(`"status":"suspended"`)) {
		t.Fatalf("suspend = %d: %s", suspendRecorder.Code, suspendRecorder.Body.String())
	}
	audit := httptest.NewRequest(http.MethodGet, "/v1/admin/audit", nil)
	audit.Header.Set("Authorization", "Bearer "+session.AccessToken)
	auditRecorder := httptest.NewRecorder()
	router.ServeHTTP(auditRecorder, audit)
	if auditRecorder.Code != http.StatusOK || !bytes.Contains(auditRecorder.Body.Bytes(), []byte(`"action":"admin.principal.suspended"`)) {
		t.Fatalf("audit = %d: %s", auditRecorder.Code, auditRecorder.Body.String())
	}
}

func TestAdminHTTPResolvesOnlyAReportingProjectionWithConfirmation(t *testing.T) {
	router := newTestHTTPService(t).Router()
	login := httptest.NewRequest(http.MethodPost, "/v1/admin/auth/login", bytes.NewBufferString(`{"email":"security@example.com","password":"correct-password"}`))
	loginRecorder := httptest.NewRecorder()
	router.ServeHTTP(loginRecorder, login)
	var session struct {
		AccessToken string `json:"access_token"`
	}
	_ = json.Unmarshal(loginRecorder.Body.Bytes(), &session)
	const exceptionID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
	confirmation := httptest.NewRequest(http.MethodPost, "/v1/admin/confirmations", bytes.NewBufferString(`{"action":"reporting.exception.resolve","target_id":"`+exceptionID+`","reason":"source event replayed"}`))
	confirmation.Header.Set("Authorization", "Bearer "+session.AccessToken)
	confirmationRecorder := httptest.NewRecorder()
	router.ServeHTTP(confirmationRecorder, confirmation)
	if confirmationRecorder.Code != http.StatusCreated {
		t.Fatalf("confirmation = %d: %s", confirmationRecorder.Code, confirmationRecorder.Body.String())
	}
	var reply struct {
		Confirmation struct {
			ID string `json:"id"`
		} `json:"confirmation"`
	}
	_ = json.Unmarshal(confirmationRecorder.Body.Bytes(), &reply)
	resolve := httptest.NewRequest(http.MethodPost, "/v1/admin/reporting/exceptions/resolve", bytes.NewBufferString(`{"exception_id":"`+exceptionID+`","confirmation_id":"`+reply.Confirmation.ID+`"}`))
	resolve.Header.Set("Authorization", "Bearer "+session.AccessToken)
	resolveRecorder := httptest.NewRecorder()
	router.ServeHTTP(resolveRecorder, resolve)
	if resolveRecorder.Code != http.StatusOK || !bytes.Contains(resolveRecorder.Body.Bytes(), []byte(`"status":"resolved"`)) {
		t.Fatalf("resolve = %d: %s", resolveRecorder.Code, resolveRecorder.Body.String())
	}
}

func TestAdminHTTPCustomerStatusUsesOperationConfirmation(t *testing.T) {
	router := newTestHTTPServiceWithOperations(t).Router()
	login := httptest.NewRequest(http.MethodPost, "/v1/admin/auth/login", bytes.NewBufferString(`{"email":"security@example.com","password":"correct-password"}`))
	loginRecorder := httptest.NewRecorder()
	router.ServeHTTP(loginRecorder, login)
	var session struct {
		AccessToken string `json:"access_token"`
	}
	_ = json.Unmarshal(loginRecorder.Body.Bytes(), &session)
	const userID = "dddddddd-dddd-dddd-dddd-dddddddddddd"
	confirmation := httptest.NewRequest(http.MethodPost, "/v1/admin/confirmations", bytes.NewBufferString(`{"action":"customer.status.set","target_id":"`+userID+`","reason":"account abuse review"}`))
	confirmation.Header.Set("Authorization", "Bearer "+session.AccessToken)
	confirmationRecorder := httptest.NewRecorder()
	router.ServeHTTP(confirmationRecorder, confirmation)
	if confirmationRecorder.Code != http.StatusCreated {
		t.Fatalf("confirmation = %d: %s", confirmationRecorder.Code, confirmationRecorder.Body.String())
	}
	var reply struct {
		Confirmation struct {
			ID string `json:"id"`
		} `json:"confirmation"`
	}
	_ = json.Unmarshal(confirmationRecorder.Body.Bytes(), &reply)
	change := httptest.NewRequest(http.MethodPost, "/v1/admin/customers/status", bytes.NewBufferString(`{"user_id":"`+userID+`","status":"suspended","confirmation_id":"`+reply.Confirmation.ID+`"}`))
	change.Header.Set("Authorization", "Bearer "+session.AccessToken)
	changeRecorder := httptest.NewRecorder()
	router.ServeHTTP(changeRecorder, change)
	if changeRecorder.Code != http.StatusOK || !bytes.Contains(changeRecorder.Body.Bytes(), []byte(`"status":"suspended"`)) {
		t.Fatalf("status = %d: %s", changeRecorder.Code, changeRecorder.Body.String())
	}
}

func newTestHTTPService(t *testing.T) *HTTPService {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte("correct-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	repo := &httpFakeRepo{principals: map[string]data.Principal{"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa": {ID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", Email: "security@example.com", PasswordHash: string(hash), Status: "active", Roles: []string{"security_admin"}}, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb": {ID: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", Email: "target@example.com", PasswordHash: string(hash), Status: "active", Roles: []string{"viewer"}}}, confirmations: map[string]data.ConfirmationInput{}}
	uc, err := biz.NewAdminUsecase(repo, &conf.Bootstrap{Environment: "test", AdminJWT: conf.JWTConfig{Issuer: "dramaip-admin", Audience: "dramaip-admin-api", AccessTokenTTL: "10m"}})
	if err != nil {
		t.Fatal(err)
	}
	return NewHTTPService(uc, biz.NewReportingUsecase(&httpFakeReporting{}))
}

func newTestHTTPServiceWithOperations(t *testing.T) *HTTPService {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte("correct-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	repo := &httpFakeRepo{principals: map[string]data.Principal{"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa": {ID: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", Email: "security@example.com", PasswordHash: string(hash), Status: "active", Roles: []string{"security_admin"}}}, confirmations: map[string]data.ConfirmationInput{}}
	uc, err := biz.NewAdminUsecase(repo, &conf.Bootstrap{Environment: "test", AdminJWT: conf.JWTConfig{Issuer: "dramaip-admin", Audience: "dramaip-admin-api", AccessTokenTTL: "10m"}})
	if err != nil {
		t.Fatal(err)
	}
	return NewHTTPServiceWithOperations(uc, biz.NewReportingUsecase(&httpFakeReporting{}), biz.NewOperationsUsecase(uc, &httpOperationDomain{}))
}

type httpFakeRepo struct {
	principals    map[string]data.Principal
	confirmations map[string]data.ConfirmationInput
	audits        []data.AuditLog
}

func (r *httpFakeRepo) Checks() map[string]func(context.Context) error { return nil }
func (r *httpFakeRepo) FindPrincipalByEmail(_ context.Context, email string) (data.Principal, error) {
	for _, p := range r.principals {
		if p.Email == email {
			return p, nil
		}
	}
	return data.Principal{}, errors.New("missing")
}
func (r *httpFakeRepo) FindPrincipalByID(_ context.Context, id string) (data.Principal, error) {
	p, ok := r.principals[id]
	if !ok {
		return data.Principal{}, errors.New("missing")
	}
	return p, nil
}
func (r *httpFakeRepo) CreateSession(context.Context, data.SessionInput) error      { return nil }
func (r *httpFakeRepo) SessionActive(context.Context, string, string) (bool, error) { return true, nil }
func (r *httpFakeRepo) CreateConfirmation(_ context.Context, input data.ConfirmationInput) (data.Confirmation, error) {
	r.confirmations[input.ID] = input
	r.audits = append(r.audits, data.AuditLog{Action: "admin.confirmation.created"})
	return data.Confirmation{ID: input.ID, Action: input.Action, TargetID: input.TargetID, ExpiresAt: input.ExpiresAt.Format(time.RFC3339)}, nil
}
func (r *httpFakeRepo) SuspendWithConfirmation(_ context.Context, actor, targetID, confirmationID, _ string) (data.Principal, error) {
	input, ok := r.confirmations[confirmationID]
	if !ok || input.ActorID != actor || input.TargetID != targetID {
		return data.Principal{}, data.ErrConfirmationInvalid
	}
	target := r.principals[targetID]
	target.Status = "suspended"
	r.principals[targetID] = target
	r.audits = append(r.audits, data.AuditLog{Action: "admin.confirmation.consumed"}, data.AuditLog{Action: "admin.principal.suspended"})
	return target, nil
}
func (r *httpFakeRepo) ConsumeReportingExceptionConfirmation(_ context.Context, actor, targetID, confirmationID, _ string) (string, error) {
	input, ok := r.confirmations[confirmationID]
	if !ok || input.ActorID != actor || input.TargetID != targetID || input.Action != "reporting.exception.resolve" {
		return "", data.ErrConfirmationInvalid
	}
	return input.Reason, nil
}
func (r *httpFakeRepo) GetOperationConfirmation(_ context.Context, actor, action, targetID, confirmationID string) (data.Confirmation, error) {
	input, ok := r.confirmations[confirmationID]
	if !ok || input.ActorID != actor || input.Action != action || input.TargetID != targetID {
		return data.Confirmation{}, data.ErrConfirmationInvalid
	}
	return data.Confirmation{ID: input.ID, Action: input.Action, TargetID: input.TargetID, Reason: input.Reason, ExpiresAt: input.ExpiresAt.Format(time.RFC3339)}, nil
}
func (r *httpFakeRepo) ConsumeOperationConfirmation(_ context.Context, actor, action, targetID, confirmationID, resourceType, _ string, _ string) error {
	input, ok := r.confirmations[confirmationID]
	if !ok || input.ActorID != actor || input.Action != action || input.TargetID != targetID {
		return data.ErrConfirmationInvalid
	}
	r.audits = append(r.audits, data.AuditLog{Action: "admin." + action + ".applied", ResourceType: resourceType})
	return nil
}
func (r *httpFakeRepo) ListAuditLogs(context.Context, int) ([]data.AuditLog, error) {
	return r.audits, nil
}

type httpFakeReporting struct{}

type httpOperationDomain struct{}

func (*httpOperationDomain) SetUserStatus(_ context.Context, request *authv1.SetUserStatusRequest, _ ...grpc.CallOption) (*authv1.SetUserStatusReply, error) {
	return &authv1.SetUserStatusReply{UserId: request.UserId, Status: request.Status}, nil
}
func (*httpOperationDomain) SetProfileStatus(_ context.Context, request *userv1.SetProfileStatusRequest, _ ...grpc.CallOption) (*userv1.UserProfile, error) {
	return &userv1.UserProfile{Id: request.UserId, Status: request.Status}, nil
}
func (*httpOperationDomain) GetProfile(context.Context, *userv1.GetProfileRequest, ...grpc.CallOption) (*userv1.UserProfile, error) {
	return &userv1.UserProfile{}, nil
}
func (*httpOperationDomain) GetSubscription(context.Context, *billingv1.GetSubscriptionRequest, ...grpc.CallOption) (*billingv1.Subscription, error) {
	return &billingv1.Subscription{}, nil
}
func (*httpOperationDomain) ListOrders(context.Context, *billingv1.ListOrdersRequest, ...grpc.CallOption) (*billingv1.ListOrdersReply, error) {
	return &billingv1.ListOrdersReply{}, nil
}
func (*httpOperationDomain) RequestRefund(context.Context, *billingv1.RequestRefundRequest, ...grpc.CallOption) (*billingv1.Refund, error) {
	return &billingv1.Refund{}, nil
}
func (*httpOperationDomain) ResumeSubscription(context.Context, *billingv1.ResumeSubscriptionRequest, ...grpc.CallOption) (*billingv1.Subscription, error) {
	return &billingv1.Subscription{}, nil
}
func (*httpOperationDomain) GetTokenBalance(context.Context, *quotav1.GetTokenBalanceRequest, ...grpc.CallOption) (*quotav1.TokenBalance, error) {
	return &quotav1.TokenBalance{}, nil
}
func (*httpOperationDomain) ListTokenUsage(context.Context, *quotav1.ListTokenUsageRequest, ...grpc.CallOption) (*quotav1.ListTokenUsageReply, error) {
	return &quotav1.ListTokenUsageReply{}, nil
}
func (*httpOperationDomain) AdjustPeriodQuota(context.Context, *quotav1.AdjustPeriodQuotaRequest, ...grpc.CallOption) (*quotav1.QuotaAdjustment, error) {
	return &quotav1.QuotaAdjustment{}, nil
}
func (*httpOperationDomain) ListNotifications(context.Context, *notificationv1.ListNotificationsRequest, ...grpc.CallOption) (*notificationv1.ListNotificationsResponse, error) {
	return &notificationv1.ListNotificationsResponse{}, nil
}
func (*httpOperationDomain) CreateNotification(context.Context, *notificationv1.CreateNotificationRequest, ...grpc.CallOption) (*notificationv1.CreateNotificationResponse, error) {
	return &notificationv1.CreateNotificationResponse{}, nil
}
func (*httpOperationDomain) ListCostAlerts(context.Context, *aiv1.ListCostAlertsRequest, ...grpc.CallOption) (*aiv1.ListCostAlertsReply, error) {
	return &aiv1.ListCostAlertsReply{}, nil
}

func (*httpFakeReporting) GetOverview(context.Context, *reportingv1.GetOverviewRequest, ...grpc.CallOption) (*reportingv1.GetOverviewResponse, error) {
	return &reportingv1.GetOverviewResponse{UserCount: 3}, nil
}
func (*httpFakeReporting) ListUsers(context.Context, *reportingv1.ListUsersRequest, ...grpc.CallOption) (*reportingv1.ListUsersResponse, error) {
	return &reportingv1.ListUsersResponse{}, nil
}
func (*httpFakeReporting) ListOrders(context.Context, *reportingv1.ListOrdersRequest, ...grpc.CallOption) (*reportingv1.ListOrdersResponse, error) {
	return &reportingv1.ListOrdersResponse{}, nil
}
func (*httpFakeReporting) ListSubscriptions(context.Context, *reportingv1.ListSubscriptionsRequest, ...grpc.CallOption) (*reportingv1.ListSubscriptionsResponse, error) {
	return &reportingv1.ListSubscriptionsResponse{}, nil
}
func (*httpFakeReporting) ListExceptions(context.Context, *reportingv1.ListExceptionsRequest, ...grpc.CallOption) (*reportingv1.ListExceptionsResponse, error) {
	return &reportingv1.ListExceptionsResponse{}, nil
}
func (*httpFakeReporting) ResolveException(_ context.Context, req *reportingv1.ResolveExceptionRequest, _ ...grpc.CallOption) (*reportingv1.ResolveExceptionResponse, error) {
	return &reportingv1.ResolveExceptionResponse{Exception: &reportingv1.ProjectionException{Id: req.GetExceptionId(), Status: "resolved"}}, nil
}
