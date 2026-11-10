import { pathToFileURL } from "node:url";

/** Serializable view of Pi's native provider and chat-model modules. */
export interface PiProviderCatalog {
  release: string;
  updatedAt: string;
  providers: Array<{
    id: string;
    name: string;
    protocol: string;
    baseUrl?: string;
    apiKeyUrl?: string;
    sourceUrl: string;
    models: Array<{
      id: string;
      label: string;
      baseUrl?: string;
      recommended?: boolean;
    }>;
  }>;
}

/** Query the prepared Pi module, without maintaining an application model list. */
export async function readPiProviderCatalog(
  modulePath: string,
): Promise<PiProviderCatalog> {
  if (!modulePath) throw new Error("Pi 服务商模块未配置，请先准备 Pi Runtime");
  const runtime = (await import(pathToFileURL(modulePath).href)) as {
    getPiProviderCatalog?: () => PiProviderCatalog;
  };
  if (typeof runtime.getPiProviderCatalog !== "function")
    throw new Error("Pi Runtime 缺少服务商目录模块");
  return runtime.getPiProviderCatalog();
}
