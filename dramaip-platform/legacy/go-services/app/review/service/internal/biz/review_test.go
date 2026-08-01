package biz

import (
	"encoding/json"
	"strings"
	"testing"
)

func validManifestFixture(t *testing.T) (string, []ReviewMediaDeclaration) {
	t.Helper()
	size := int64(1024)
	manifest := reviewManifest{
		Format: "dramaip-review", Version: 1, PackageID: "review-package-01",
		ProjectID: "project-01", AdaptationProjectID: "adaptation-01", EpisodeID: "episode-01",
		Title: "审片样片", CreatedAt: "2026-07-28T00:00:00Z",
		Media: []reviewManifestMedia{{
			ID: "media-01", ShotID: "shot-01", OrderIndex: 0, Label: "镜头 1",
			RelativePath: "media/shot-01.png", MIMEType: "image/png",
			SHA256: strings.Repeat("a", 64), SizeBytes: &size,
		}},
	}
	raw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw), []ReviewMediaDeclaration{{
		ID: "media-01", RelativePath: "media/shot-01.png", MIMEType: "image/png",
		SHA256: strings.Repeat("a", 64), SizeBytes: size,
	}}
}

func TestValidateReviewManifestAcceptsStrictProxyManifest(t *testing.T) {
	raw, declarations := validManifestFixture(t)
	manifest, err := validateReviewManifest(raw, "review-package-01", "审片样片", declarations)
	if err != nil {
		t.Fatalf("validate manifest: %v", err)
	}
	if manifest.Format != "dramaip-review" || len(manifest.Media) != 1 {
		t.Fatalf("unexpected manifest: %#v", manifest)
	}
}

func TestValidateReviewManifestRejectsSensitiveUnknownFields(t *testing.T) {
	raw, declarations := validManifestFixture(t)
	raw = strings.TrimSuffix(raw, "}") + `,"prompt":"must never leave desktop"}`
	if _, err := validateReviewManifest(raw, "review-package-01", "审片样片", declarations); err == nil {
		t.Fatal("expected strict manifest to reject prompt field")
	}
}

func TestValidateReviewManifestRejectsPathTraversal(t *testing.T) {
	raw, declarations := validManifestFixture(t)
	declarations[0].RelativePath = "../source/master.mov"
	if _, err := validateReviewManifest(raw, "review-package-01", "审片样片", declarations); err == nil {
		t.Fatal("expected path traversal to be rejected")
	}
}
