import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
const source = await readFile(
  resolve(root, "packages/schema/src/provider-catalog.ts"),
  "utf8",
);

const release = source.match(
  /MODEL_PROVIDER_CATALOG_RELEASE\s*=\s*"([^"]+)"/,
)?.[1];
const updatedAt = source.match(
  /MODEL_PROVIDER_CATALOG_UPDATED_AT\s*=\s*"([^"]+)"/,
)?.[1];
if (!release || !updatedAt) throw new Error("模型服务商目录缺少版本或核对日期");
if (release !== manifest.version)
  throw new Error(
    `模型服务商目录仍对应 ${release}，发布 ${manifest.version} 前必须按各厂商官方文档更新模型清单`,
  );
if (!/^\d{4}-\d{2}-\d{2}$/.test(updatedAt))
  throw new Error("模型服务商目录核对日期格式无效");
const age = Date.now() - Date.parse(`${updatedAt}T00:00:00Z`);
if (age < 0 || age > 120 * 24 * 60 * 60 * 1000)
  throw new Error("模型服务商目录超过 120 天未核对，拒绝发布");

process.stdout.write(
  `模型服务商目录有效：适用版本 ${release}，最近核对 ${updatedAt}\n`,
);
