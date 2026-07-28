package data

import (
	"context"
	"time"

	aiv1 "github.com/dramaip/dramaip-platform/services/api/ai_gateway/service/v1"
	authv1 "github.com/dramaip/dramaip-platform/services/api/auth/service/v1"
	billingv1 "github.com/dramaip/dramaip-platform/services/api/billing/service/v1"
	inspirationv1 "github.com/dramaip/dramaip-platform/services/api/inspiration/service/v1"
	quotav1 "github.com/dramaip/dramaip-platform/services/api/quota/service/v1"
	reviewv1 "github.com/dramaip/dramaip-platform/services/api/review/service/v1"
	snapshotv1 "github.com/dramaip/dramaip-platform/services/api/snapshot/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/bff/desktop/interface/internal/conf"
	"github.com/dramaip/dramaip-platform/services/pkg/kratosx"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
	"google.golang.org/grpc"
)

type AuthClient interface {
	ExchangeDesktopAuthorizationCode(context.Context, *authv1.ExchangeDesktopAuthorizationCodeRequest, ...grpc.CallOption) (*authv1.AuthReply, error)
	Refresh(context.Context, *authv1.RefreshRequest, ...grpc.CallOption) (*authv1.AuthReply, error)
	Logout(context.Context, *authv1.LogoutRequest, ...grpc.CallOption) (*authv1.LogoutReply, error)
	ValidateAccessToken(context.Context, *authv1.ValidateAccessTokenRequest, ...grpc.CallOption) (*authv1.AuthReply, error)
}

type BillingClient interface {
	GetSubscription(context.Context, *billingv1.GetSubscriptionRequest, ...grpc.CallOption) (*billingv1.Subscription, error)
}

type QuotaClient interface {
	GetTokenBalance(context.Context, *quotav1.GetTokenBalanceRequest, ...grpc.CallOption) (*quotav1.TokenBalance, error)
}

type AIClient interface {
	ListModels(context.Context, *aiv1.ListModelsRequest, ...grpc.CallOption) (*aiv1.ListModelsReply, error)
	Preflight(context.Context, *aiv1.PreflightRequest, ...grpc.CallOption) (*aiv1.PreflightReply, error)
	Chat(context.Context, *aiv1.ChatRequest, ...grpc.CallOption) (*aiv1.ChatReply, error)
}

type InspirationClient interface {
	ListMobileDrafts(context.Context, *inspirationv1.ListMobileDraftsRequest, ...grpc.CallOption) (*inspirationv1.ListMobileDraftsResponse, error)
	RecordMobileDraftAdoption(context.Context, *inspirationv1.RecordMobileDraftAdoptionRequest, ...grpc.CallOption) (*inspirationv1.RecordMobileDraftAdoptionResponse, error)
}

type SnapshotClient interface {
	CreateProjectSnapshot(context.Context, *snapshotv1.CreateProjectSnapshotRequest, ...grpc.CallOption) (*snapshotv1.CreateProjectSnapshotResponse, error)
	StartProjectSnapshotUpload(context.Context, *snapshotv1.StartProjectSnapshotUploadRequest, ...grpc.CallOption) (*snapshotv1.StartProjectSnapshotUploadResponse, error)
	UploadProjectSnapshotChunk(context.Context, *snapshotv1.UploadProjectSnapshotChunkRequest, ...grpc.CallOption) (*snapshotv1.UploadProjectSnapshotChunkResponse, error)
	CompleteProjectSnapshotUpload(context.Context, *snapshotv1.CompleteProjectSnapshotUploadRequest, ...grpc.CallOption) (*snapshotv1.CompleteProjectSnapshotUploadResponse, error)
	ListProjectSnapshots(context.Context, *snapshotv1.ListProjectSnapshotsRequest, ...grpc.CallOption) (*snapshotv1.ListProjectSnapshotsResponse, error)
	GetProjectSnapshot(context.Context, *snapshotv1.GetProjectSnapshotRequest, ...grpc.CallOption) (*snapshotv1.GetProjectSnapshotResponse, error)
	DeleteProjectSnapshot(context.Context, *snapshotv1.DeleteProjectSnapshotRequest, ...grpc.CallOption) (*snapshotv1.DeleteProjectSnapshotResponse, error)
}

type ReviewClient interface {
	CreatePackage(context.Context, *reviewv1.CreatePackageRequest, ...grpc.CallOption) (*reviewv1.CreatePackageReply, error)
	CompletePackage(context.Context, *reviewv1.CompletePackageRequest, ...grpc.CallOption) (*reviewv1.ReviewPackage, error)
	RefreshUploadTarget(context.Context, *reviewv1.RefreshUploadTargetRequest, ...grpc.CallOption) (*reviewv1.UploadTarget, error)
	SyncPackage(context.Context, *reviewv1.SyncPackageRequest, ...grpc.CallOption) (*reviewv1.SyncPackageReply, error)
	DeletePackage(context.Context, *reviewv1.DeletePackageRequest, ...grpc.CallOption) (*reviewv1.DeletePackageReply, error)
}

type Data struct {
	Auth        AuthClient
	Billing     BillingClient
	Quota       QuotaClient
	AI          AIClient
	Inspiration InspirationClient
	Snapshot    SnapshotClient
	Review      ReviewClient
	conns       []*grpc.ClientConn
}

func NewData(cfg *conf.Bootstrap) (*Data, func(), error) {
	ctx, cancel := context.WithTimeout(context.Background(), kratosx.Duration(cfg.Downstream.DialTimeout, 15*time.Second))
	defer cancel()
	authConn, err := platform.DialGRPC(ctx, cfg.Downstream.AuthEndpoint, cfg.MTLS)
	if err != nil {
		return nil, nil, err
	}
	billingConn, err := platform.DialGRPC(ctx, cfg.Downstream.BillingEndpoint, cfg.MTLS)
	if err != nil {
		_ = authConn.Close()
		return nil, nil, err
	}
	quotaConn, err := platform.DialGRPC(ctx, cfg.Downstream.QuotaEndpoint, cfg.MTLS)
	if err != nil {
		_ = authConn.Close()
		_ = billingConn.Close()
		return nil, nil, err
	}
	aiConn, err := platform.DialGRPC(ctx, cfg.Downstream.AIGatewayEndpoint, cfg.MTLS)
	if err != nil {
		_ = authConn.Close()
		_ = billingConn.Close()
		_ = quotaConn.Close()
		return nil, nil, err
	}
	inspirationConn, err := platform.DialGRPC(ctx, cfg.Downstream.InspirationEndpoint, cfg.MTLS)
	if err != nil {
		_ = authConn.Close()
		_ = billingConn.Close()
		_ = quotaConn.Close()
		_ = aiConn.Close()
		return nil, nil, err
	}
	// Snapshot downloads are bounded at 64 MiB by the owner service. All upload
	// writes remain 1 MiB chunks, while this explicit limit keeps the opaque
	// download response usable without weakening other internal RPC clients.
	snapshotConn, err := platform.DialGRPC(ctx, cfg.Downstream.SnapshotEndpoint, cfg.MTLS,
		grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(66<<20), grpc.MaxCallSendMsgSize(10<<20)))
	if err != nil {
		_ = authConn.Close()
		_ = billingConn.Close()
		_ = quotaConn.Close()
		_ = aiConn.Close()
		_ = inspirationConn.Close()
		return nil, nil, err
	}
	reviewConn, err := platform.DialGRPC(ctx, cfg.Downstream.ReviewEndpoint, cfg.MTLS)
	if err != nil {
		_ = authConn.Close()
		_ = billingConn.Close()
		_ = quotaConn.Close()
		_ = aiConn.Close()
		_ = inspirationConn.Close()
		_ = snapshotConn.Close()
		return nil, nil, err
	}
	d := &Data{
		Auth: authv1.NewAuthServiceClient(authConn), Billing: billingv1.NewBillingServiceClient(billingConn), Quota: quotav1.NewQuotaServiceClient(quotaConn), AI: aiv1.NewAiGatewayServiceClient(aiConn), Inspiration: inspirationv1.NewInspirationServiceClient(inspirationConn), Snapshot: snapshotv1.NewSnapshotServiceClient(snapshotConn), Review: reviewv1.NewReviewServiceClient(reviewConn),
		conns: []*grpc.ClientConn{authConn, billingConn, quotaConn, aiConn, inspirationConn, snapshotConn, reviewConn},
	}
	return d, d.Close, nil
}

func (d *Data) Close() {
	for _, conn := range d.conns {
		_ = conn.Close()
	}
}
