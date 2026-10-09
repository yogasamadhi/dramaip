import type { AssetCenterAsset } from "@dramaip/contracts/product";

export function AssetDeclarationStatus({ asset }: { asset: AssetCenterAsset }) {
  return (
    <>
      <div>
        <dt className="text-muted">权利</dt>
        <dd>
          {asset.rightsStatus === "restricted" ? "受限（用户声明）" : "待核验"}
          {asset.rightsDeclaration === "user-reported-cleared" &&
            " · 用户声明已核验，未提供核验凭证"}
        </dd>
      </div>
      <div>
        <dt className="text-muted">费用 / 服务</dt>
        <dd>
          结算费用未知
          {asset.costDeclaration === "user-reported-known" &&
            " · 用户声明费用已知，未提供结算回执"}
          {asset.providerStatus === "unavailable"
            ? " · 不可用（用户声明）"
            : " · 服务可用性未核验"}
          {asset.providerDeclaration === "user-reported-available" &&
            " · 用户声明可用"}
          {asset.providerDeclaration === "user-reported-not-required" &&
            " · 用户声明无需服务"}
        </dd>
      </div>
    </>
  );
}
