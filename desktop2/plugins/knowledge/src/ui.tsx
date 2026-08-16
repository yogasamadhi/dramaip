import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { BookOpen, Network, Plus, UserRound } from "lucide-react";

import type { UiContribution } from "@dramaip/plugin-api";
import { confirmDialog } from "@dramaip/ui";
import {
  EmptyPanel,
  ErrorPanel,
  LoadingPanel,
  useStudioClient,
} from "@dramaip/ui-shared";

import type { ChangeSet, KnowledgeKind, KnowledgeRecord } from "./contracts.ts";

const sections: Array<{
  kind: KnowledgeKind;
  path: string;
  label: string;
  description: string;
}> = [
  {
    kind: "character",
    path: "characters",
    label: "人物",
    description: "人物背景、关系与当前状态",
  },
  {
    kind: "outline",
    path: "outlines",
    label: "全书大纲",
    description: "故事结构与关键节拍",
  },
  {
    kind: "story-arc",
    path: "story-arcs",
    label: "故事弧",
    description: "主线、支线及阶段转折",
  },
  {
    kind: "story-bible",
    path: "story-bibles",
    label: "Story Bible",
    description: "世界规则、事件、主题与伏笔",
  },
];

const emptyData = (kind: KnowledgeKind): Record<string, unknown> => {
  if (kind === "character")
    return {
      role: "",
      biography: "",
      traits: [],
      relationships: [],
      currentState: "",
      visualProfile: "",
    };
  if (kind === "outline") return { summary: "", beats: [] };
  if (kind === "story-arc") return { premise: "", beats: [] };
  return { world: "", rules: [], themes: [], events: [], foreshadowing: [] };
};

function KnowledgePage() {
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();
  const client = useStudioClient();
  const queryClient = useQueryClient();
  const requestedSection = searchParams.get("section");
  const requestedKind: KnowledgeKind =
    requestedSection === "outline"
      ? "outline"
      : requestedSection === "story-bible" || requestedSection === "longform"
        ? "story-bible"
        : "character";
  const [kind, setKind] = useState<KnowledgeKind>(requestedKind);
  const [selectedId, setSelectedId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const definition = sections.find((item) => item.kind === kind)!;
  const records = useQuery({
    queryKey: ["knowledge", kind, projectId],
    queryFn: () =>
      client.request<{ items: KnowledgeRecord[] }>(
        `/api/v2/knowledge/${definition.path}?projectId=${projectId}`,
      ),
    enabled: Boolean(projectId),
  });
  const selected =
    records.data?.items.find((item) => item.id === selectedId) ??
    records.data?.items[0];
  useEffect(() => {
    setKind(requestedKind);
    setSelectedId(undefined);
  }, [requestedKind]);
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["knowledge", kind, projectId] });
  const remove = useMutation({
    mutationFn: (record: KnowledgeRecord) =>
      client.request(`/api/v2/knowledge/${definition.path}/${record.id}`, {
        method: "DELETE",
        headers: { "if-match": `"v${record.version}"` },
      }),
    onSuccess: async () => {
      setSelectedId(undefined);
      await invalidate();
    },
  });
  return (
    <section className="knowledge-workspace">
      <header className="page-header knowledge-heading">
        <div>
          <p className="eyebrow">KNOWLEDGE</p>
          <h1>故事知识库</h1>
          <p>
            人物、大纲、故事弧和 Story Bible
            都有独立版本，不再混入无类型资源表。
          </p>
        </div>
        <button className="primary-button" onClick={() => setCreating(true)}>
          <Plus size={15} /> 新建{definition.label}
        </button>
      </header>
      <nav className="knowledge-tabs">
        {sections.map((item) => (
          <button
            className={kind === item.kind ? "active" : ""}
            key={item.kind}
            onClick={() => setKind(item.kind)}
          >
            {item.kind === "character" ? (
              <UserRound size={16} />
            ) : item.kind === "story-bible" ? (
              <BookOpen size={16} />
            ) : (
              <Network size={16} />
            )}
            {item.label}
            <small>{item.description}</small>
          </button>
        ))}
      </nav>
      <div className="knowledge-body">
        <aside className="knowledge-list">
          {records.isLoading ? (
            <LoadingPanel />
          ) : records.error ? (
            <ErrorPanel error={records.error} />
          ) : (
            records.data?.items.map((record) => (
              <button
                className={selected?.id === record.id ? "active" : ""}
                key={record.id}
                onClick={() => setSelectedId(record.id)}
              >
                <strong>{record.title}</strong>
                <small>
                  v{record.version} ·{" "}
                  {new Date(record.updatedAt).toLocaleDateString("zh-CN")}
                </small>
              </button>
            ))
          )}
          {!records.data?.items.length && (
            <EmptyPanel>暂无{definition.label}。</EmptyPanel>
          )}
        </aside>
        <main className="knowledge-editor">
          {creating ? (
            <RecordEditor
              kind={kind}
              projectId={projectId!}
              onDone={async () => {
                setCreating(false);
                await invalidate();
              }}
            />
          ) : selected ? (
            <RecordEditor
              kind={kind}
              projectId={projectId!}
              record={selected}
              onDone={invalidate}
              onDelete={async () => {
                if (
                  await confirmDialog({
                    title: `删除${definition.label}`,
                    description: `确定删除「${selected.title}」？此操作会创建领域变更记录。`,
                    confirmLabel: "确认删除",
                    tone: "danger",
                  })
                ) {
                  remove.mutate(selected);
                }
              }}
            />
          ) : (
            <EmptyPanel>从左侧选择或新建内容。</EmptyPanel>
          )}
        </main>
        <aside className="knowledge-changes">
          <StoryBibleSettings projectId={projectId!} />
          <ChangeSets projectId={projectId!} />
        </aside>
      </div>
    </section>
  );
}

function RecordEditor({
  kind,
  projectId,
  record,
  onDone,
  onDelete,
}: {
  kind: KnowledgeKind;
  projectId: string;
  record?: KnowledgeRecord;
  onDone(): void | Promise<void>;
  onDelete?(): void;
}) {
  const client = useStudioClient();
  const definition = sections.find((item) => item.kind === kind)!;
  const [title, setTitle] = useState(record?.title ?? "");
  const [dataText, setDataText] = useState(() =>
    friendlyText(kind, record?.data ?? emptyData(kind)),
  );
  useEffect(() => {
    setTitle(record?.title ?? "");
    setDataText(friendlyText(kind, record?.data ?? emptyData(kind)));
  }, [record?.id, kind]);
  const save = useMutation({
    mutationFn: () =>
      client.request<KnowledgeRecord>(
        record
          ? `/api/v2/knowledge/${definition.path}/${record.id}`
          : `/api/v2/knowledge/${definition.path}`,
        {
          method: record ? "PATCH" : "POST",
          headers: record ? { "if-match": `"v${record.version}"` } : undefined,
          body: JSON.stringify(
            record
              ? { title, data: parseFriendlyText(kind, dataText, record.data) }
              : {
                  projectId,
                  title,
                  data: parseFriendlyText(kind, dataText, emptyData(kind)),
                },
          ),
        },
      ),
    onSuccess: onDone,
  });
  return (
    <form
      className="knowledge-form"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <p className="eyebrow">
        {record ? `编辑 v${record.version}` : `新建${definition.label}`}
      </p>
      <label>
        标题
        <input
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label>
        {kind === "character"
          ? "人物小传与当前状态"
          : kind === "story-bible"
            ? "世界设定与一致性规则"
            : "结构内容"}
        <textarea
          rows={18}
          value={dataText}
          onChange={(event) => setDataText(event.target.value)}
        />
      </label>
      <p className="field-hint">
        每行可作为一个节拍、规则、事件或伏笔；保存时会转换为结构化字段。
      </p>
      {save.error && <ErrorPanel error={save.error} />}
      <div className="button-row">
        <button
          className="primary-button"
          disabled={save.isPending || !title.trim()}
        >
          保存
        </button>
        {record && onDelete && (
          <button type="button" className="danger-button" onClick={onDelete}>
            删除
          </button>
        )}
      </div>
    </form>
  );
}

function friendlyText(kind: KnowledgeKind, data: unknown): string {
  const value = data as Record<string, unknown>;
  if (kind === "character")
    return [value.role, value.biography, value.currentState]
      .filter(Boolean)
      .join("\n\n");
  if (kind === "outline")
    return [value.summary, ...(Array.isArray(value.beats) ? value.beats : [])]
      .filter(Boolean)
      .join("\n\n");
  if (kind === "story-arc") return String(value.premise ?? "");
  return [
    value.world,
    ...(Array.isArray(value.rules) ? value.rules : []),
    ...(Array.isArray(value.events) ? value.events : []),
    ...(Array.isArray(value.foreshadowing) ? value.foreshadowing : []),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function parseFriendlyText(
  kind: KnowledgeKind,
  text: string,
  previous: unknown,
): Record<string, unknown> {
  const value = previous as Record<string, unknown>;
  const parts = text
    .split(/\n{2,}/u)
    .map((item) => item.trim())
    .filter(Boolean);
  if (kind === "character")
    return {
      ...value,
      role: parts[0] ?? "",
      biography: parts[1] ?? parts[0] ?? "",
      currentState: parts[2] ?? "",
    };
  if (kind === "outline")
    return { ...value, summary: parts[0] ?? "", beats: parts.slice(1) };
  if (kind === "story-arc") return { ...value, premise: text };
  return { ...value, world: parts[0] ?? "", rules: parts.slice(1) };
}

function StoryBibleSettings({ projectId }: { projectId: string }) {
  const client = useStudioClient();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["knowledge", "settings", projectId],
    queryFn: () =>
      client.requestWithMetadata<{ autoSuggest: boolean; version: number }>(
        `/api/v2/knowledge/projects/${projectId}/story-bible/settings`,
      ),
  });
  const update = useMutation({
    mutationFn: () =>
      client.request(
        `/api/v2/knowledge/projects/${projectId}/story-bible/settings`,
        {
          method: "PUT",
          headers: { "if-match": settings.data!.response.headers.get("etag")! },
          body: JSON.stringify({
            autoSuggest: !settings.data!.data.autoSuggest,
          }),
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["knowledge", "settings", projectId],
      });
    },
  });
  return (
    <section className="side-section">
      <h3>长篇一致性</h3>
      <label className="switch-row">
        <span>
          自动建议变更<small>章节变化时保留人工确认</small>
        </span>
        <input
          type="checkbox"
          checked={settings.data?.data.autoSuggest ?? false}
          onChange={() => update.mutate()}
        />
      </label>
    </section>
  );
}

function ChangeSets({ projectId }: { projectId: string }) {
  const client = useStudioClient();
  const queryClient = useQueryClient();
  const sets = useQuery({
    queryKey: ["knowledge", "change-sets", projectId],
    queryFn: () =>
      client.request<{ items: ChangeSet[] }>(
        `/api/v2/knowledge/projects/${projectId}/story-bible/change-sets`,
      ),
  });
  const action = useMutation({
    mutationFn: ({ set, verb }: { set: ChangeSet; verb: "apply" | "undo" }) =>
      client.request(
        `/api/v2/knowledge/change-sets/${set.id}/actions/${verb}`,
        {
          method: "POST",
          headers: {
            "if-match": `"v${set.version}"`,
            "idempotency-key": crypto.randomUUID(),
          },
          body:
            verb === "apply"
              ? JSON.stringify({
                  selectedItemIds: set.items.map((item) => item.id),
                })
              : undefined,
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["knowledge", "change-sets", projectId],
      });
    },
  });
  return (
    <section className="side-section">
      <h3>变更草案</h3>
      {sets.data?.items.map((set) => (
        <article className="change-set" key={set.id}>
          <strong>{set.rationale || "Story Bible 变更"}</strong>
          <small>
            {set.items.length} 项 · {set.status}
          </small>
          {set.status === "queued" && (
            <button onClick={() => action.mutate({ set, verb: "apply" })}>
              全部采用
            </button>
          )}
          {set.status === "applied" && (
            <button onClick={() => action.mutate({ set, verb: "undo" })}>
              撤销
            </button>
          )}
        </article>
      ))}
      {!sets.data?.items.length && <p className="muted">暂无待处理草案。</p>}
    </section>
  );
}

function StoryBibleAuxiliary() {
  const { projectId } = useParams();
  const client = useStudioClient();
  const data = useQuery({
    queryKey: ["knowledge", "story-bibles", projectId],
    queryFn: () =>
      client.request<{ items: KnowledgeRecord[] }>(
        `/api/v2/knowledge/story-bibles?projectId=${projectId}`,
      ),
    enabled: Boolean(projectId),
  });
  return (
    <div className="aux-plugin-panel">
      <h3>Story Bible</h3>
      {data.data?.items.map((record) => (
        <article key={record.id}>
          <strong>{record.title}</strong>
          <p>
            {friendlyText("story-bible", record.data).slice(0, 500) ||
              "尚未填写设定"}
          </p>
        </article>
      ))}
      {!data.data?.items.length && (
        <EmptyPanel>
          在知识库中创建 Story Bible，写作时会自动进入助手上下文。
        </EmptyPanel>
      )}
    </div>
  );
}

function KnowledgeProjectCard() {
  const { projectId } = useParams();
  return (
    <Link className="tool-card" to={`/projects/${projectId}/knowledge`}>
      <span className="card-kicker">KNOWLEDGE</span>
      <h2>人物与 Story Bible</h2>
      <p>维护人物、大纲、故事弧、伏笔和长篇一致性。</p>
    </Link>
  );
}

export const knowledgeUi: readonly UiContribution[] = [
  {
    kind: "route",
    id: "knowledge.project",
    pluginId: "knowledge",
    path: "/projects/:projectId/knowledge",
    title: "故事知识库",
    component: async () => ({ default: KnowledgePage }),
  },
  {
    kind: "navigation",
    id: "knowledge.characters.navigation",
    pluginId: "knowledge",
    section: "project",
    order: 20,
    label: "大纲",
    to: "/projects/:projectId/knowledge?section=outline",
  },
  {
    kind: "navigation",
    id: "knowledge.outlines.navigation",
    pluginId: "knowledge",
    section: "project",
    order: 30,
    label: "人物",
    to: "/projects/:projectId/knowledge?section=character",
  },
  {
    kind: "navigation",
    id: "knowledge.story-bible.navigation",
    pluginId: "knowledge",
    section: "project",
    order: 50,
    label: "故事圣经",
    to: "/projects/:projectId/knowledge?section=story-bible",
  },
  {
    kind: "navigation",
    id: "knowledge.longform.navigation",
    pluginId: "knowledge",
    section: "project",
    order: 60,
    label: "长篇工具",
    to: "/projects/:projectId/knowledge?section=longform",
  },
  {
    kind: "slot",
    id: "knowledge.project.section",
    pluginId: "knowledge",
    slot: "project.section",
    order: 20,
    component: async () => ({ default: KnowledgeProjectCard }),
  },
  {
    kind: "slot",
    id: "knowledge.chapter.auxiliary",
    pluginId: "knowledge",
    slot: "chapter.auxiliary",
    order: 20,
    component: async () => ({ default: StoryBibleAuxiliary }),
  },
];
