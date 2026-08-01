package service

import (
	"context"

	reviewv1 "github.com/dramaip/dramaip-platform/services/api/review/service/v1"
	"github.com/dramaip/dramaip-platform/services/app/review/service/internal/biz"
	"github.com/dramaip/dramaip-platform/services/pkg/platform"
)

type ReviewService struct {
	reviewv1.UnimplementedReviewServiceServer
	uc *biz.ReviewUsecase
}

func NewReviewService(uc *biz.ReviewUsecase) *ReviewService { return &ReviewService{uc: uc} }

func (service *ReviewService) CreatePackage(ctx context.Context, request *reviewv1.CreatePackageRequest) (*reviewv1.CreatePackageReply, error) {
	if err := platform.RequireUserIdentity(ctx, request.UserId); err != nil {
		return nil, err
	}
	media := make([]biz.ReviewMediaDeclaration, 0, len(request.Media))
	for _, item := range request.Media {
		media = append(media, biz.ReviewMediaDeclaration{
			ID: item.Id, RelativePath: item.RelativePath, MIMEType: item.MimeType,
			SizeBytes: item.SizeBytes, SHA256: item.Sha256,
		})
	}
	created, err := service.uc.Create(
		ctx, request.UserId, request.WorkspaceId, request.DesktopPackageId,
		request.Title, request.ManifestJson, request.Pin, media,
	)
	if err != nil {
		return nil, err
	}
	targets := make([]*reviewv1.UploadTarget, 0, len(created.UploadTargets))
	for _, target := range created.UploadTargets {
		targets = append(targets, uploadTargetReply(target))
	}
	return &reviewv1.CreatePackageReply{
		Package: reviewPackageReply(created.Package), ShareToken: created.ShareToken, UploadTargets: targets,
	}, nil
}

func (service *ReviewService) CompletePackage(ctx context.Context, request *reviewv1.CompletePackageRequest) (*reviewv1.ReviewPackage, error) {
	if err := platform.RequireUserIdentity(ctx, request.UserId); err != nil {
		return nil, err
	}
	reviewPackage, err := service.uc.Complete(ctx, request.UserId, request.PackageId)
	if err != nil {
		return nil, err
	}
	return reviewPackageReply(reviewPackage), nil
}

func (service *ReviewService) RefreshUploadTarget(ctx context.Context, request *reviewv1.RefreshUploadTargetRequest) (*reviewv1.UploadTarget, error) {
	if err := platform.RequireUserIdentity(ctx, request.UserId); err != nil {
		return nil, err
	}
	target, err := service.uc.RefreshUploadTarget(ctx, request.UserId, request.PackageId, request.MediaId)
	if err != nil {
		return nil, err
	}
	return uploadTargetReply(target), nil
}

func (service *ReviewService) SyncPackage(ctx context.Context, request *reviewv1.SyncPackageRequest) (*reviewv1.SyncPackageReply, error) {
	if err := platform.RequireUserIdentity(ctx, request.UserId); err != nil {
		return nil, err
	}
	sync, err := service.uc.Sync(ctx, request.UserId, request.PackageId, request.AfterCursor)
	if err != nil {
		return nil, err
	}
	reply := &reviewv1.SyncPackageReply{NextCursor: sync.NextCursor}
	for _, comment := range sync.Comments {
		reply.Comments = append(reply.Comments, commentReply(comment))
	}
	for _, decision := range sync.Decisions {
		reply.Decisions = append(reply.Decisions, decisionReply(decision))
	}
	return reply, nil
}

func (service *ReviewService) DeletePackage(ctx context.Context, request *reviewv1.DeletePackageRequest) (*reviewv1.DeletePackageReply, error) {
	if err := platform.RequireUserIdentity(ctx, request.UserId); err != nil {
		return nil, err
	}
	if err := service.uc.Delete(ctx, request.UserId, request.PackageId); err != nil {
		return nil, err
	}
	return &reviewv1.DeletePackageReply{PackageId: request.PackageId, Status: "deleted"}, nil
}

func (service *ReviewService) GetPublicPackage(ctx context.Context, request *reviewv1.GetPublicPackageRequest) (*reviewv1.PublicPackageReply, error) {
	reviewPackage, err := service.uc.PublicPackage(ctx, request.Token, request.Pin)
	if err != nil {
		return nil, err
	}
	return &reviewv1.PublicPackageReply{Package: reviewPackageReply(reviewPackage)}, nil
}

func (service *ReviewService) SubmitPublicComment(ctx context.Context, request *reviewv1.SubmitPublicCommentRequest) (*reviewv1.ReviewComment, error) {
	comment, err := service.uc.SubmitComment(
		ctx, request.Token, request.Pin, request.ClientId, request.ShotId,
		request.TimecodeSeconds, request.AuthorAlias, request.Body,
	)
	if err != nil {
		return nil, err
	}
	return commentReply(comment), nil
}

func (service *ReviewService) SubmitPublicDecision(ctx context.Context, request *reviewv1.SubmitPublicDecisionRequest) (*reviewv1.ReviewDecision, error) {
	decision, err := service.uc.SubmitDecision(
		ctx, request.Token, request.Pin, request.ClientId, request.ShotId,
		request.Decision, request.AuthorAlias, request.Note,
	)
	if err != nil {
		return nil, err
	}
	return decisionReply(decision), nil
}

func reviewPackageReply(reviewPackage biz.ReviewPackage) *reviewv1.ReviewPackage {
	reply := &reviewv1.ReviewPackage{
		Id: reviewPackage.ID, WorkspaceId: reviewPackage.WorkspaceID,
		DesktopPackageId: reviewPackage.DesktopPackageID, Title: reviewPackage.Title,
		Status: reviewPackage.Status, ManifestJson: reviewPackage.ManifestJSON,
		StorageBytes: reviewPackage.StorageBytes, SyncCursor: reviewPackage.SyncCursor,
		ExpiresAt: reviewPackage.ExpiresAt, CreatedAt: reviewPackage.CreatedAt,
	}
	for _, item := range reviewPackage.Media {
		reply.Media = append(reply.Media, &reviewv1.ReviewMedia{
			Id: item.ID, RelativePath: item.RelativePath, MimeType: item.MIMEType,
			SizeBytes: item.SizeBytes, Sha256: item.SHA256, Status: item.Status,
			DownloadUrl: item.DownloadURL, DownloadUrlExpiresAt: item.DownloadURLExpiresAt,
		})
	}
	return reply
}

func uploadTargetReply(target biz.UploadTarget) *reviewv1.UploadTarget {
	reply := &reviewv1.UploadTarget{
		MediaId: target.MediaID, Method: target.Method, Url: target.URL, ExpiresAt: target.ExpiresAt,
	}
	for name, value := range target.RequiredHeaders {
		reply.RequiredHeaders = append(reply.RequiredHeaders, &reviewv1.UploadHeader{Name: name, Value: value})
	}
	return reply
}

func commentReply(comment biz.ReviewComment) *reviewv1.ReviewComment {
	return &reviewv1.ReviewComment{
		Id: comment.ID, PackageId: comment.PackageID, ClientId: comment.ClientID,
		ShotId: comment.ShotID, TimecodeSeconds: comment.TimecodeSeconds,
		AuthorAlias: comment.AuthorAlias, Body: comment.Body, Resolved: comment.Resolved,
		Cursor: comment.Cursor, CreatedAt: comment.CreatedAt, UpdatedAt: comment.UpdatedAt,
	}
}

func decisionReply(decision biz.ReviewDecision) *reviewv1.ReviewDecision {
	return &reviewv1.ReviewDecision{
		Id: decision.ID, PackageId: decision.PackageID, ClientId: decision.ClientID,
		ShotId: decision.ShotID, Decision: decision.Decision, AuthorAlias: decision.AuthorAlias,
		Note: decision.Note, Cursor: decision.Cursor, CreatedAt: decision.CreatedAt,
	}
}
