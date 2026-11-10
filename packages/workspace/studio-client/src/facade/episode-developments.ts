import type {
  EpisodeDevelopmentCatalog,
  EpisodeDevelopmentResult,
  EpisodeDevelopmentPage,
  EpisodeDevelopmentImpact,
  StoryboardAttributionImpactSelection,
  EpisodeDevelopmentSummaryPage,
  EpisodeScriptRevision,
  EpisodeScriptRevisionInput,
  EpisodeScriptRevisionConfirmation,
  EpisodeScriptRevisionSummary,
  EpisodeTopologyRevision,
  EpisodeTopologyRevisionInput,
  EpisodeTopologyRevisionConfirmation,
  EpisodeTopologyRevisionSummary,
  ScreenplayDocument,
  ScreenplayBlock,
  ProductionRecordMergeComparison,
  ProductionRecordMergeRequest,
  ProductionRecordMergeStructure,
  ProductionRecordMergeShotPlan,
  ProductionRecordMergeTopologyPlan,
} from "@dramaip/contracts/production";
import {
  EpisodeDevelopmentSummaryPageSchema,
  EpisodeDevelopmentCatalogSchema,
  EpisodeDevelopmentResultSchema,
  EpisodeDevelopmentPageSchema,
  EpisodeDevelopmentImpactSchema,
  StoryboardAttributionImpactSelectionSchema,
  ProductionRecordMergeComparisonSchema,
  ProductionRecordMergeRequestSchema,
  EpisodeTopologyRevisionSchema,
  EpisodeTopologyRevisionInputSchema,
  EpisodeTopologyRevisionConfirmationSchema,
  EpisodeTopologyRevisionPageSchema,
  EpisodeTopologyRevisionSummaryPageSchema,
} from "@dramaip/contracts/production";
import {
  CreationWorkflowSchema,
  type CreationWorkflow,
} from "@dramaip/contracts/creation";
import { canonicalCreativeMetricJSON } from "@dramaip/contracts/insights";
import {
  createEpisodeSourceRevisionClient,
  type EpisodeSourceRevisionClient,
} from "./episode-source-revisions.js";
export interface EpisodeDevelopmentClient extends EpisodeSourceRevisionClient {
  topologyRevisionSummaries(
    projectId: string,
    cursor?: string,
  ): Promise<{ items: EpisodeTopologyRevisionSummary[]; nextCursor?: string }>;
  previewTopologyRevision(
    id: string,
    input: EpisodeTopologyRevisionInput,
    key: string,
  ): Promise<EpisodeTopologyRevision>;
  getTopologyRevision(id: string): Promise<EpisodeTopologyRevision>;
  listTopologyRevisions(
    projectId: string,
    cursor?: string,
    limit?: number,
  ): Promise<{ items: EpisodeTopologyRevision[]; nextCursor?: string }>;
  adoptTopologyRevision(
    id: string,
    stateVersion: number,
    confirmation: EpisodeTopologyRevisionConfirmation,
    key: string,
  ): Promise<EpisodeTopologyRevision>;
  discardTopologyRevision(
    id: string,
    stateVersion: number,
    key: string,
  ): Promise<EpisodeTopologyRevision>;
  sources(projectId: string): Promise<EpisodeDevelopmentCatalog>;
  get(id: string): Promise<EpisodeDevelopmentResult>;
  impact(
    id: string,
    expected?: { projectId: string; episodeId: string; version: number },
    attribution?: StoryboardAttributionImpactSelection,
  ): Promise<EpisodeDevelopmentImpact>;
  compareRecords(
    workflowId: string,
    expected: {
      projectId: string;
      episodeId: string;
      workflowVersion: number;
      base: { id: string; version: number };
      confirmedStructure?: Pick<
        ProductionRecordMergeStructure,
        "receipt" | "script" | "documentVersion"
      >;
      confirmedShotPlan?: Pick<
        ProductionRecordMergeShotPlan,
        "receipt" | "script" | "documentVersion"
      >;
      confirmedTopologyPlan?: Pick<
        ProductionRecordMergeTopologyPlan,
        "receipt" | "script" | "documentVersion"
      >;
    },
  ): Promise<ProductionRecordMergeComparison>;
  mergeRecords(
    workflowId: string,
    input: ProductionRecordMergeRequest,
    key: string,
  ): Promise<CreationWorkflow>;
  summaries(
    projectId: string,
    cursor?: string,
    limit?: number,
  ): Promise<EpisodeDevelopmentSummaryPage>;
  scriptRevisionSummaries(
    projectId: string,
    cursor?: string,
  ): Promise<{ items: EpisodeScriptRevisionSummary[]; nextCursor?: string }>;
  saveScriptDocument(
    id: string,
    input: { version: number; title?: string; blocks: ScreenplayBlock[] },
  ): Promise<ScreenplayDocument>;
  previewScriptRevision(
    id: string,
    input: EpisodeScriptRevisionInput,
    key: string,
  ): Promise<EpisodeScriptRevision>;
  getScriptRevision(id: string): Promise<EpisodeScriptRevision>;
  listScriptRevisions(
    projectId: string,
    cursor?: string,
    limit?: number,
  ): Promise<{ items: EpisodeScriptRevision[]; nextCursor?: string }>;
  adoptScriptRevision(
    id: string,
    stateVersion: number,
    confirmation: EpisodeScriptRevisionConfirmation,
    key: string,
  ): Promise<EpisodeScriptRevision>;
  discardScriptRevision(
    id: string,
    stateVersion: number,
    key: string,
  ): Promise<EpisodeScriptRevision>;
  list(
    projectId: string,
    cursor?: string,
    limit?: number,
  ): Promise<EpisodeDevelopmentPage>;
}
export function createEpisodeDevelopmentClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
): EpisodeDevelopmentClient {
  const project = (id: string) => `/api/v2/projects/${encodeURIComponent(id)}`;
  const revision = (id: string) =>
    `/api/v2/episode-script-revisions/${encodeURIComponent(id)}`;
  const topology = (id: string) =>
    `/api/v2/episode-topology-revisions/${encodeURIComponent(id)}`;
  const exactTopology = (id: string, raw: unknown) => {
    const value = EpisodeTopologyRevisionSchema.parse(raw);
    if (value.id !== id)
      throw new Error("场景拓扑确认身份不符，不读取其他预览。");
    return value;
  };
  const topologyPage = <T extends { id: string; projectId: string }>(
    id: string,
    value: { items: T[]; nextCursor?: string },
  ) => {
    if (
      value.items.some((item) => item.projectId !== id) ||
      new Set(value.items.map((item) => item.id)).size !== value.items.length ||
      (value.nextCursor && value.nextCursor !== value.items.at(-1)?.id)
    )
      throw new Error("场景拓扑历史归属、身份或游标不符，不补空列表。");
    return value;
  };
  const post = <T>(path: string, body: unknown, version: number, key: string) =>
    request<T>(path, {
      method: "POST",
      headers: { "If-Match": `"${version}"`, "Idempotency-Key": key },
      body: JSON.stringify(body),
    });
  return {
    ...createEpisodeSourceRevisionClient(request),
    topologyRevisionSummaries: async (id, cursor) =>
      topologyPage(
        id,
        EpisodeTopologyRevisionSummaryPageSchema.parse(
          await request(
            `${project(id)}/episode-topology-revision-summaries${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
          ),
        ),
      ),
    previewTopologyRevision: async (id, raw, key) => {
      const input = EpisodeTopologyRevisionInputSchema.parse(raw);
      const value = EpisodeTopologyRevisionSchema.parse(
        await post(
          `/api/v2/episode-development/${encodeURIComponent(id)}/topology-revision-previews`,
          input,
          input.sourceVersion,
          key,
        ),
      );
      if (
        value.sourceScript.id !== id ||
        value.sourceScript.version !== input.sourceVersion ||
        value.sourceOutline.id !== input.outline.id ||
        value.sourceOutline.version !== input.outline.version ||
        value.document.version !== input.documentVersion ||
        canonicalCreativeMetricJSON(value.outlineContent) !==
          canonicalCreativeMetricJSON(input.outlineContent) ||
        canonicalCreativeMetricJSON(value.scriptContent.sceneLinks) !==
          canonicalCreativeMetricJSON(input.sceneLinks)
      )
        throw new Error("拓扑预览未绑定原请求，不使用其他正式来源或映射。");
      return value;
    },
    getTopologyRevision: async (id) =>
      exactTopology(id, await request(topology(id))),
    listTopologyRevisions: async (id, cursor, limit) => {
      const query = new URLSearchParams();
      if (cursor) query.set("cursor", cursor);
      if (limit !== undefined) query.set("limit", String(limit));
      return topologyPage(
        id,
        EpisodeTopologyRevisionPageSchema.parse(
          await request(
            `${project(id)}/episode-topology-revisions${query.size ? `?${query}` : ""}`,
          ),
        ),
      );
    },
    adoptTopologyRevision: async (id, stateVersion, raw, key) => {
      const confirmation = EpisodeTopologyRevisionConfirmationSchema.parse(raw);
      const value = exactTopology(
        id,
        await post(
          `${topology(id)}/adopt`,
          { stateVersion, confirmation },
          stateVersion,
          key,
        ),
      );
      if (
        value.status !== "adopted" ||
        value.stateVersion !== stateVersion + 1 ||
        canonicalCreativeMetricJSON(value.confirmation) !==
          canonicalCreativeMetricJSON(confirmation)
      )
        throw new Error("双正式采用回执未对应原状态与作者确认。");
      return value;
    },
    discardTopologyRevision: async (id, stateVersion, key) => {
      const value = exactTopology(
        id,
        await post(
          `${topology(id)}/discard`,
          { stateVersion },
          stateVersion,
          key,
        ),
      );
      if (
        value.status !== "discarded" ||
        value.stateVersion !== stateVersion + 1
      )
        throw new Error("拓扑撤回回执未对应原预览状态。");
      return value;
    },
    sources: async (id) => {
      const value = EpisodeDevelopmentCatalogSchema.parse(
        await request(`${project(id)}/episode-development-sources`),
      );
      const scope =
        value.narrativeSourceScope ?? value.narrativeSources?.chapters;
      if (
        value.projectId !== id ||
        (value.direct && value.direct.project.id !== id) ||
        (value.narrativeSources &&
          value.narrativeSources.basis.projectId !== id) ||
        new Set(value.episodes.map((item) => item.id)).size !==
          value.episodes.length ||
        (scope &&
          new Set(scope.map((item) => item.id)).size !== scope.length) ||
        value.currentResults.some(
          (item) => item.projectId !== id || !item.isCurrent,
        ) ||
        new Set(
          value.currentResults.map(
            (item) => `${item.episodeId}:${item.operation}`,
          ),
        ).size !== value.currentResults.length ||
        (value.direct &&
          new Set(value.direct.episodes.map((item) => item.id)).size !==
            value.direct.episodes.length)
      )
        throw new Error("单集来源归属或唯一身份不符，不补其他项目或最新记录。");
      if (
        scope &&
        value.episodes.some((episode) =>
          episode.sourceChapters.some(
            (chapter) =>
              !scope.some(
                (item) =>
                  item.id === chapter.id && item.version === chapter.version,
              ),
          ),
        )
      )
        throw new Error("单集实际映射超出正式季纲来源范围，尚未核全。");
      if (
        value.narrativeSourceScope &&
        value.narrativeSources &&
        JSON.stringify(value.narrativeSourceScope) !==
          JSON.stringify(value.narrativeSources.chapters)
      )
        throw new Error("整季实际表达范围不一致，不能独立选择或换源。");
      return value;
    },
    get: async (id) => {
      const value = EpisodeDevelopmentResultSchema.parse(
        await request(`/api/v2/episode-development/${encodeURIComponent(id)}`),
      );
      if (value.id !== id)
        throw new Error("指定单集成果身份不符，不读取最新成果。");
      return value;
    },
    impact: async (id, expected, attribution) => {
      const selected = attribution
        ? StoryboardAttributionImpactSelectionSchema.parse(attribution)
        : undefined;
      const value = EpisodeDevelopmentImpactSchema.parse(
        await request(
          `/api/v2/episode-development/${encodeURIComponent(id)}/impact${selected ? `?attributionId=${encodeURIComponent(selected.id)}&attributionVersion=${selected.version}` : ""}`,
        ),
      );
      if (
        value.result.id !== id ||
        (expected &&
          (value.projectId !== expected.projectId ||
            value.episodeId !== expected.episodeId ||
            value.result.version !== expected.version)) ||
        Boolean(value.attributionImpact) !== Boolean(selected) ||
        (value.attributionImpact &&
          (!selected ||
            value.attributionImpact.attribution.id !== selected.id ||
            value.attributionImpact.attribution.version !== selected.version ||
            value.attributionImpact.projectId !== value.projectId ||
            value.attributionImpact.episodeId !== value.episodeId ||
            value.attributionImpact.storyboard.id !== value.result.id ||
            value.attributionImpact.storyboard.version !==
              value.result.version))
      )
        throw new Error(
          "指定分镜影响清单的成果、项目、分集或版本不符，不补最新记录。",
        );
      return value;
    },
    compareRecords: async (id, expected) => {
      const value = ProductionRecordMergeComparisonSchema.parse(
        await request(
          `/api/v2/workflows/creation/${encodeURIComponent(id)}/record-merge`,
        ),
      );
      if (
        value.workflow.id !== id ||
        value.workflow.version !== expected.workflowVersion ||
        value.projectId !== expected.projectId ||
        value.episodeId !== expected.episodeId ||
        value.base.id !== expected.base.id ||
        value.base.version !== expected.base.version ||
        (value.format === "storyboard-record-field-comparison-v4"
          ? Boolean(
              expected.confirmedStructure || expected.confirmedShotPlan,
            ) ||
            !expected.confirmedTopologyPlan ||
            canonicalCreativeMetricJSON({
              receipt: value.structure.receipt,
              script: value.structure.script,
              documentVersion: value.structure.documentVersion,
            }) !== canonicalCreativeMetricJSON(expected.confirmedTopologyPlan)
          : value.format === "storyboard-record-field-comparison-v3"
            ? Boolean(expected.confirmedStructure) ||
              Boolean(expected.confirmedTopologyPlan) ||
              !expected.confirmedShotPlan ||
              canonicalCreativeMetricJSON({
                receipt: value.structure.receipt,
                script: value.structure.script,
                documentVersion: value.structure.documentVersion,
              }) !== canonicalCreativeMetricJSON(expected.confirmedShotPlan)
            : value.format === "storyboard-record-field-comparison-v2"
              ? Boolean(expected.confirmedShotPlan) ||
                Boolean(expected.confirmedTopologyPlan) ||
                !expected.confirmedStructure ||
                canonicalCreativeMetricJSON({
                  receipt: value.structure.receipt,
                  script: value.structure.script,
                  documentVersion: value.structure.documentVersion,
                }) !== canonicalCreativeMetricJSON(expected.confirmedStructure)
              : Boolean(
                  expected.confirmedStructure ||
                  expected.confirmedShotPlan ||
                  expected.confirmedTopologyPlan,
                ))
      )
        throw new Error(
          "实际字段比较的候选、项目、分集或原基准不符，不补最新记录。",
        );
      return value;
    },
    mergeRecords: async (id, raw, key) => {
      const input = ProductionRecordMergeRequestSchema.parse(raw);
      if (input.workflow.id !== id || !key)
        throw new Error("字段合并原请求身份或幂等标识不完整。");
      const value = CreationWorkflowSchema.parse(
        await post(
          `/api/v2/workflows/creation/${encodeURIComponent(id)}/record-rebase`,
          input,
          input.workflow.version,
          key,
        ),
      );
      if (
        value.input.operation !== "storyboard-package" ||
        value.input.projectId !== input.projectId ||
        value.episodeDevelopmentBasis?.episode.id !== input.episodeId ||
        value.sourceWorkflowId !== id ||
        !value.recordMergeSource ||
        canonicalCreativeMetricJSON(value.recordMergeSource.request) !==
          canonicalCreativeMetricJSON(input)
      )
        throw new Error(
          "字段合并回执不属于原请求，不恢复其他候选或补最新运行。",
        );
      return value;
    },
    summaries: async (id, cursor, limit) => {
      const query = new URLSearchParams();
      if (cursor) query.set("cursor", cursor);
      if (limit !== undefined) query.set("limit", String(limit));
      const value = EpisodeDevelopmentSummaryPageSchema.parse(
        await request(
          `${project(id)}/episode-development-summaries${query.size ? `?${query}` : ""}`,
        ),
      );
      if (value.items.some((item) => item.projectId !== id))
        throw new Error("单集来源状态不属于指定项目，未替换为其他项目。");
      if (
        new Set(value.items.map((item) => item.id)).size !== value.items.length
      )
        throw new Error("单集来源状态身份重复，尚未核全。");
      return value;
    },
    scriptRevisionSummaries: (id, cursor) =>
      request(
        `${project(id)}/episode-script-revision-summaries${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      ),
    saveScriptDocument: (id, input) =>
      request(`/api/v2/scripts/${encodeURIComponent(id)}/screenplay`, {
        method: "PATCH",
        headers: { "If-Match": `"${input.version}"` },
        body: JSON.stringify(input),
      }),
    previewScriptRevision: (id, input, key) =>
      post(
        `/api/v2/episode-development/${encodeURIComponent(id)}/script-revision-previews`,
        input,
        input.sourceVersion,
        key,
      ),
    getScriptRevision: (id) => request(revision(id)),
    listScriptRevisions: (id, cursor, limit) => {
      const query = new URLSearchParams();
      if (cursor) query.set("cursor", cursor);
      if (limit !== undefined) query.set("limit", String(limit));
      return request(
        `${project(id)}/episode-script-revisions${query.size ? `?${query}` : ""}`,
      );
    },
    adoptScriptRevision: (id, stateVersion, confirmation, key) =>
      post(
        `${revision(id)}/adopt`,
        { stateVersion, confirmation },
        stateVersion,
        key,
      ),
    discardScriptRevision: (id, stateVersion, key) =>
      post(`${revision(id)}/discard`, { stateVersion }, stateVersion, key),
    list: async (id, cursor, limit) => {
      const query = new URLSearchParams();
      if (cursor) query.set("cursor", cursor);
      if (limit !== undefined) query.set("limit", String(limit));
      const value = EpisodeDevelopmentPageSchema.parse(
        await request(
          `${project(id)}/episode-development${query.size ? `?${query}` : ""}`,
        ),
      );
      if (
        value.items.some((item) => item.projectId !== id) ||
        new Set(value.items.map((item) => item.id)).size !==
          value.items.length ||
        (value.nextCursor && value.nextCursor !== value.items.at(-1)?.id)
      )
        throw new Error("单集历史归属、唯一身份或游标不符，不伪造空列表。");
      return value;
    },
  };
}
