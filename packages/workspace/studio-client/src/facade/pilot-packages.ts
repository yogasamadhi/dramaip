import {
  PilotPackagePageSchema,
  PilotPackagePreviewSchema,
  PilotPackagePreviewInputSchema,
  PilotPackageSaveInputSchema,
  type PilotPackagePage,
  type PilotPackagePreview,
  type PilotPackagePreviewInput,
  type PilotPackageSaveInput,
} from "@dramaip/contracts/delivery";

export interface PilotPackageClient {
  preview(
    projectId: string,
    input: PilotPackagePreviewInput,
    key: string,
  ): Promise<PilotPackagePreview>;
  get(id: string): Promise<PilotPackagePreview>;
  list(
    projectId: string,
    cursor?: string,
    limit?: number,
  ): Promise<PilotPackagePage>;
  save(
    id: string,
    input: PilotPackageSaveInput,
    key: string,
  ): Promise<PilotPackagePreview>;
}

export function createPilotPackageClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
): PilotPackageClient {
  const project = (id: string) =>
    `/api/v2/projects/${encodeURIComponent(id)}/pilot-packages`;
  const item = (id: string) =>
    `/api/v2/pilot-packages/${encodeURIComponent(id)}`;
  const exact = (raw: unknown, id?: string, projectId?: string) => {
    const value = PilotPackagePreviewSchema.parse(raw);
    if (
      (id && value.id !== id) ||
      (projectId && value.manifest.projectId !== projectId)
    )
      throw new Error("返回的试制包不是指定身份，未使用最新包或其他项目替代。");
    return value;
  };
  return {
    preview: async (id, input, key) => {
      const checked = PilotPackagePreviewInputSchema.parse(input);
      const value = exact(
        await request(project(id), {
          method: "POST",
          headers: { "Idempotency-Key": key },
          body: JSON.stringify(checked),
        }),
        undefined,
        id,
      );
      if (
        value.manifest.projectVersion !== checked.projectVersion ||
        value.manifest.adopted.storyboard.id !== checked.storyboard.id ||
        value.manifest.adopted.storyboard.version !==
          checked.storyboard.version ||
        JSON.stringify(value.manifest.adopted.shotAttribution ?? null) !==
          JSON.stringify(checked.shotAttribution ?? null)
      )
        throw new Error("返回的试制包不属于明确确认的项目／分镜版本。");
      return value;
    },
    get: async (id) => exact(await request(item(id)), id),
    list: async (id, cursor, limit) => {
      const query = new URLSearchParams();
      if (cursor) query.set("cursor", cursor);
      if (limit !== undefined) query.set("limit", String(limit));
      const page = PilotPackagePageSchema.parse(
        await request(`${project(id)}${query.size ? `?${query}` : ""}`),
      );
      if (
        page.items.some((value) => value.manifest.projectId !== id) ||
        new Set(page.items.map((value) => value.id)).size !==
          page.items.length ||
        (page.nextCursor && page.nextCursor !== page.items.at(-1)?.id)
      )
        throw new Error("试制包分页身份或游标无法核对，未作为空成功返回。");
      return page;
    },
    save: async (id, input, key) => {
      const checked = PilotPackageSaveInputSchema.parse(input);
      return exact(
        await request(`${item(id)}/save`, {
          method: "POST",
          headers: {
            "Idempotency-Key": key,
            "If-Match": `"${checked.version}"`,
          },
          body: JSON.stringify(checked),
        }),
        id,
      );
    },
  };
}
