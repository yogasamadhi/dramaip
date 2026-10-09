import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AssetCenterAssetSchema } from "@dramaip/contracts/media";
import { AssetDeclarationStatus } from "./AssetDeclarationStatus";

const asset = {
  id: "95000000-0000-4000-8000-000000000001",
  title: "原资产",
  category: "character" as const,
  subject: "原角色",
  assetVersion: "v1",
  adopted: true,
  lockStatus: "locked" as const,
  stale: false,
  preview: { kind: "none" as const, status: "unattached" as const },
  rightsStatus: "unknown" as const,
  costStatus: "unknown" as const,
  providerStatus: "unknown" as const,
  rightsDeclaration: "user-reported-cleared" as const,
  costDeclaration: "user-reported-known" as const,
  providerDeclaration: "user-reported-not-required" as const,
  usages: [],
  version: 0,
};

test("已采用／锁定资产的可编辑正面声明仍显示未知核验和结算，不当许可证或服务成功", () => {
  const html = renderToStaticMarkup(<AssetDeclarationStatus asset={asset} />);
  expect(html).toContain("待核验");
  expect(html).toContain("用户声明已核验，未提供核验凭证");
  expect(html).toContain("结算费用未知");
  expect(html).toContain("用户声明费用已知，未提供结算回执");
  expect(html).toContain("服务可用性未核验");
  expect(html).toContain("用户声明无需服务");
  expect(html).not.toContain("可用或无需服务");
  expect(html).not.toContain("<dd>已核验</dd>");
});

test("保留明确受限／不可用声明，缺失声明不补造正面事实", () => {
  const restricted = renderToStaticMarkup(
    <AssetDeclarationStatus
      asset={{
        ...asset,
        rightsStatus: "restricted",
        rightsDeclaration: "user-reported-restricted",
        providerStatus: "unavailable",
        providerDeclaration: "user-reported-unavailable",
      }}
    />,
  );
  expect(restricted).toContain("受限（用户声明）");
  expect(restricted).toContain("不可用（用户声明）");
  const missing = renderToStaticMarkup(
    <AssetDeclarationStatus
      asset={{
        ...asset,
        rightsDeclaration: "not-provided",
        costDeclaration: "not-provided",
        providerDeclaration: "not-provided",
      }}
    />,
  );
  expect(missing).not.toContain("用户声明");
  expect(missing).toContain("服务可用性未核验");
});

test("资产中心当前声明来源契约拒绝未绑定凭证的正面核验／结算／可用性状态", () => {
  expect(AssetCenterAssetSchema.safeParse(asset).success).toBe(true);
  for (const change of [
    { rightsStatus: "verified" },
    { costStatus: "known" },
    { providerStatus: "available" },
    { providerStatus: "not-required" },
    { rightsDeclaration: "receipt-/private/path" },
    { providerDeclaration: undefined },
  ])
    expect(
      AssetCenterAssetSchema.safeParse({ ...asset, ...change }).success,
    ).toBe(false);
});
