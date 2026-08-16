import type { Context, Plugin } from "@deepseek-ai/cordis";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { ZodType } from "zod";

import type { DomainEvent, DramaPluginDescriptor } from "@dramaip/contracts";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface PluginProfileEntry {
  id: string;
  config?: JsonValue;
}

export interface PluginProfile {
  name: "studio" | "safe" | "test" | "e2e";
  plugins: readonly PluginProfileEntry[];
}

export interface MigrationDefinition {
  id: string;
  pluginId: string;
  version: string;
  dependsOn: readonly string[];
  sql: string;
  /** Reserved for forward-only table rebuilds that are followed by foreign_key_check. */
  foreignKeysOff?: boolean;
}

export interface RouteContribution {
  id: string;
  pluginId: string;
  install(app: OpenAPIHono<any>): void;
}

export interface UiRouteContribution {
  kind: "route";
  id: string;
  pluginId: string;
  path: string;
  title: string;
  /** Tells the shell which chrome owns the route without coupling it to a plugin. */
  layout?: "standard" | "project" | "project-tools" | "edge-to-edge";
  component: () => Promise<{ default: unknown }>;
}

export interface UiNavigationContribution {
  kind: "navigation";
  id: string;
  pluginId: string;
  section: "main" | "project" | "settings";
  order: number;
  label: string;
  to: string;
  activePaths?: readonly string[];
}

export type UiSlot =
  | "shell.assistant"
  | "project.section"
  | "project.header.leading"
  | "project.header.actions"
  | "chapter.auxiliary"
  | "settings.section";

export interface UiSlotContribution {
  kind: "slot";
  id: string;
  pluginId: string;
  slot: UiSlot;
  order: number;
  component: () => Promise<{ default: unknown }>;
}

export interface CommandContribution {
  kind: "command";
  id: string;
  pluginId: string;
  title: string;
  run(): void | Promise<void>;
}

export type UiContribution =
  | UiRouteContribution
  | UiNavigationContribution
  | UiSlotContribution
  | CommandContribution;

export interface DramaPluginExports<TConfig = JsonValue | undefined> {
  descriptor: DramaPluginDescriptor;
  contracts: Readonly<Record<string, ZodType>>;
  server?: Plugin<TConfig>;
  ui?: readonly UiContribution[];
  migrations?: readonly MigrationDefinition[];
}

export interface PendingDomainEvent<T = unknown> {
  type: `${string}.${string}.v${number}`;
  pluginId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  payload: T;
}

export interface UnitOfWork {
  execute<T>(work: (tx: UnitOfWorkTransaction) => T): T;
}

export interface UnitOfWorkTransaction {
  run(
    sql: string,
    ...params: unknown[]
  ): { changes: number | bigint; lastInsertRowid: number | bigint };
  get<T>(sql: string, ...params: unknown[]): T | undefined;
  all<T>(sql: string, ...params: unknown[]): T[];
  append(event: PendingDomainEvent): DomainEvent;
}

export interface WorkspaceProjectContract {
  id: string;
  name: string;
  description: string;
  synopsis: string;
  genre: string;
  creationMode: "inspiration" | "source-import" | "script-import";
  targetWordCount: number;
  targetEpisodeCount: number;
  initialScript: string | null;
  status: "active" | "archived" | "trashed";
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SourceImportCandidateContract {
  id: string;
  kind:
    | "character"
    | "scene"
    | "prop"
    | "chapter-summary"
    | "adaptation-suggestion";
  title: string;
  data: Record<string, unknown>;
  selectedByDefault: boolean;
}

export interface SourceImportPreviewContract {
  id: string;
  projectId: string;
  fileName: string;
  sourceType: "txt" | "markdown" | "docx";
  checksum: string;
  charCount: number;
  chapters: readonly {
    id: string;
    title: string;
    content: string;
    ordinal: number;
    wordCount: number;
  }[];
  candidates: readonly SourceImportCandidateContract[];
  warnings: readonly string[];
  status: "preview" | "committed" | "discarded" | "undone";
  createdAt: string;
  expiresAt: string;
}

export interface SourceImportAdopter {
  pluginId: string;
  adopt(
    tx: UnitOfWorkTransaction,
    input: {
      projectId: string;
      preview: SourceImportPreviewContract;
      candidates: readonly SourceImportCandidateContract[];
    },
  ): readonly string[];
  undo(tx: UnitOfWorkTransaction, resourceIds: readonly string[]): void;
}

export interface ProjectArchiveContributor {
  pluginId: string;
  export(tx: UnitOfWorkTransaction, projectId: string): unknown;
  import(
    tx: UnitOfWorkTransaction,
    project: WorkspaceProjectContract,
    payload: unknown,
  ): void;
}

export interface WorkspaceExtensionRegistry {
  registerSourceImportAdopter(
    adopter: SourceImportAdopter,
  ): () => Promise<void>;
  registerArchiveContributor(
    contributor: ProjectArchiveContributor,
  ): () => Promise<void>;
  sourceImportAdopters(): readonly SourceImportAdopter[];
  archiveContributors(): readonly ProjectArchiveContributor[];
}

export interface ResolvedFileCapability {
  path: string;
  name: string;
}

/** One-shot Main-issued file authority. It is never exposed to the Renderer. */
export interface FileCapabilityAccess {
  resolve(token: string): Promise<ResolvedFileCapability | undefined>;
}

export interface ContextRequest {
  projectId?: string;
  chapterId?: string;
  selection?: string;
  taskType: string;
  pinned?: readonly string[];
  excluded?: readonly string[];
  tokenBudget?: number;
}

export interface ContextFragment {
  id: string;
  pluginId: string;
  kind: string;
  title: string;
  content: string;
  sourceId: string;
  sourceVersion: number;
  priority: number;
  tokenEstimate: number;
  provenance: string;
}

export interface ContextSnapshot {
  id: string;
  request: ContextRequest;
  fragments: readonly ContextFragment[];
  totalTokens: number;
  truncated: readonly { id: string; reason: string }[];
  createdAt: string;
}

export interface AgentContextProvider {
  id: string;
  pluginId: string;
  provide(
    input: ContextRequest,
  ): readonly ContextFragment[] | Promise<readonly ContextFragment[]>;
}

export interface ChangePreviewTarget {
  id: string;
  kind: string;
  targetId: string;
  baseVersion: number;
  patch: Record<string, unknown>;
  displayDiff?: unknown;
}

export interface ChangeTargetHandler {
  kind: string;
  pluginId: string;
  apply(tx: UnitOfWorkTransaction, target: ChangePreviewTarget): void;
}

export interface ChangePreview {
  id: string;
  projectId: string;
  sessionId?: string;
  runId?: string;
  taskType?: string;
  rationale: string;
  status: "pending" | "committed" | "discarded";
  targets: readonly ChangePreviewTarget[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRuntime {
  registerContextProvider(provider: AgentContextProvider): () => Promise<void>;
  registerChangeTarget(handler: ChangeTargetHandler): () => Promise<void>;
  snapshot(input: ContextRequest): Promise<ContextSnapshot>;
  createPreview(input: {
    projectId: string;
    sessionId?: string;
    runId?: string;
    taskType?: string;
    rationale: string;
    targets: readonly Omit<ChangePreviewTarget, "id">[];
  }): ChangePreview;
  getPreview(id: string): ChangePreview;
  updatePreview(
    id: string,
    expectedVersion: number,
    input: { rationale?: string; targets?: readonly ChangePreviewTarget[] },
  ): ChangePreview;
  commitPreview(id: string, expectedVersion: number): ChangePreview;
  discardPreview(id: string, expectedVersion: number): ChangePreview;
}

export interface ProductionLineageItem {
  id: string;
  projectId: string;
  kind: "adaptation" | "episode" | "script" | "scene" | "shot";
  parentId: string | null;
  title: string;
  status: string;
  ordinal: number;
  version: number;
  updatedAt: string;
}

/** Read-only production boundary used by media, timeline, review and delivery. */
export interface ProductionReadService {
  lineage(projectId: string): readonly ProductionLineageItem[];
  get(itemId: string): ProductionLineageItem | undefined;
  assertVersion(itemId: string, expectedVersion: number): void;
}

export interface MediaAssetReference {
  id: string;
  projectId: string;
  kind: "image" | "video" | "audio" | "voice" | "document" | "other";
  title: string;
  mimeType: string;
  rightsStatus: "unverified" | "cleared" | "restricted";
  adoptionStatus: "candidate" | "adopted" | "locked" | "rejected";
  version: number;
  byteLength: number;
}

/** Exposes metadata only. Local paths and media bytes never cross this boundary. */
export interface MediaReadService {
  list(projectId: string): readonly MediaAssetReference[];
  get(assetId: string): MediaAssetReference | undefined;
  assertUsable(assetId: string): void;
}

export interface CanonicalTimelineReference {
  id: string;
  projectId: string;
  title: string;
  durationMs: number;
  version: number;
  locked: boolean;
  updatedAt: string;
}

export interface TimelinePreflightResult {
  ready: boolean;
  errors: readonly string[];
  warnings: readonly string[];
  assetIds: readonly string[];
}

/** Read-only delivery boundary for canonical timelines and their preflight state. */
export interface TimelineReadService {
  canonical(projectId: string): CanonicalTimelineReference | undefined;
  preflight(timelineId: string): TimelinePreflightResult;
  deliveryManifest(timelineId: string): Readonly<Record<string, JsonValue>>;
}

export interface HttpRouteRegistry {
  register(contribution: RouteContribution): () => Promise<void>;
  fetch(request: Request): Response | Promise<Response>;
  openapiDocument(): Record<string, unknown>;
}

export interface LiveEvent {
  id: string;
  type: string;
  payload: JsonValue;
  occurredAt: string;
}

export interface EventRuntime {
  publishLive(event: Omit<LiveEvent, "id" | "occurredAt">): void;
  subscribeLive(listener: (event: LiveEvent) => void): () => void;
  replay(afterCursor: number, limit?: number): DomainEvent[];
  registerConsumer(consumer: DurableConsumer): () => Promise<void>;
  drain(): Promise<void>;
  diagnostics(): readonly ConsumerDiagnostic[];
}

export interface DurableConsumer {
  id: string;
  pluginId: string;
  critical: boolean;
  handle(event: DomainEvent): void | Promise<void>;
}

export interface ConsumerDiagnostic {
  id: string;
  pluginId: string;
  critical: boolean;
  checkpoint: number;
  consecutiveFailures: number;
  status: "healthy" | "retrying" | "degraded";
  lastError?: string;
}

export interface UiRegistry {
  register(contributions: readonly UiContribution[]): () => Promise<void>;
  routes(): readonly UiRouteContribution[];
  navigation(): readonly UiNavigationContribution[];
  slots(slot: UiSlot): readonly UiSlotContribution[];
  commands(): readonly CommandContribution[];
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    uow: UnitOfWork;
    http: HttpRouteRegistry;
    eventRuntime: EventRuntime;
    uiRegistry: UiRegistry;
    workspaceExtensions: WorkspaceExtensionRegistry;
    fileCapabilities: FileCapabilityAccess;
    automationRuntime: AutomationRuntime;
    productionRead: ProductionReadService;
    mediaRead: MediaReadService;
    timelineRead: TimelineReadService;
  }
}

export function defineDramaPlugin<TConfig>(
  exports: DramaPluginExports<TConfig>,
): DramaPluginExports<TConfig> {
  return Object.freeze(exports);
}

export function registerFiberCleanup(
  ctx: Context,
  setup: () => void | (() => void | Promise<void>),
  label: string,
): void {
  ctx.effect(() => setup() ?? (() => undefined), label);
}
