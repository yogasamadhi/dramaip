import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, confirmDialog } from "@dramaip/ui-shared";
import type {
  EpisodeDevelopmentResult,
  EpisodeScriptRevision,
  ScreenplayDocument,
} from "@dramaip/contracts/production";
import { message, useStudio } from "../../studio-shared";

/** Actual-document edits and formal adoption are intentionally separate writes. */
export function EpisodeScriptRevisionPanel({
  result,
}: {
  result: EpisodeDevelopmentResult;
}) {
  const client = useStudio();
  const [params] = useSearchParams();
  const requestedId = params.get("scriptRevisionId");
  const cache = useQueryClient();
  const [opened, setOpened] = useState(Boolean(requestedId));
  const [draft, setDraft] = useState<ScreenplayDocument>();
  const [selected, setSelected] = useState<EpisodeScriptRevision>();
  const [reviewed, setReviewed] = useState([false, false, false]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [previewKey, setPreviewKey] = useState<string>();
  const [actionKey, setActionKey] = useState<{
    kind: "adopt" | "discard";
    id: string;
    version: number;
    key: string;
  }>();
  const document = useQuery({
    queryKey: ["author-script-document", result.scriptId],
    queryFn: () => client.screenplays.get(result.scriptId!),
    enabled: opened && Boolean(result.scriptId),
  });
  const requested = useQuery({
    queryKey: ["author-script-revision", requestedId],
    queryFn: () => client.episodeDevelopments.getScriptRevision(requestedId!),
    enabled: Boolean(requestedId),
  });
  useEffect(() => {
    const value = requested.data;
    if (
      value?.projectId === result.projectId &&
      value.episodeId === result.episodeId
    ) {
      setSelected(value);
      setOpened(true);
      setReviewed([false, false, false]);
    }
  }, [requested.data, result.projectId, result.episodeId]);
  const history = useQuery({
    queryKey: ["author-script-revisions", result.projectId],
    enabled: opened,
    queryFn: async () => {
      const values: EpisodeScriptRevision[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await client.episodeDevelopments.listScriptRevisions(
          result.projectId,
          cursor,
          100,
        );
        values.push(...page.items);
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor))
          throw new Error("人工确认历史分页未完成。");
        if (cursor) seen.add(cursor);
      } while (cursor);
      return values.filter((value) => value.episodeId === result.episodeId);
    },
  });
  const ast = draft ?? document.data;
  const content =
    result.content.kind === "episode-script" ? result.content.value : undefined;
  // Reuse only exact heading IDs and full contiguous actual groups. Added or
  // deleted headings require another outline/mapping workflow, never a guess.
  const links =
    ast && content
      ? ast.blocks.reduce<Array<{ sceneId: string; blockIds: string[] }>>(
          (groups, block) => {
            if (block.type === "scene_heading") {
              const known = content.sceneLinks.find(
                (link) => link.blockIds[0] === block.id,
              );
              groups.push({
                sceneId: known?.sceneId ?? "",
                blockIds: [block.id],
              });
            } else groups.at(-1)?.blockIds.push(block.id);
            return groups;
          },
          [],
        )
      : [];
  const mappingKnown = Boolean(
    ast &&
    content &&
    links.length === content.sceneLinks.length &&
    links.every(
      (link, index) =>
        link.sceneId && link.sceneId === content.sceneLinks[index]?.sceneId,
    ) &&
    links.flatMap((link) => link.blockIds).length === ast.blocks.length,
  );
  const select = (value: EpisodeScriptRevision) => {
    setSelected(value);
    setReviewed([false, false, false]);
    setActionKey(undefined);
    setError(undefined);
  };
  const perform = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    await cache.invalidateQueries();
  };
  const save = () =>
    perform(async () => {
      if (!ast || !draft || !result.scriptId) return;
      if (
        !(await confirmDialog({
          title: "保存实际人工剧本？",
          description:
            "仅保存实际文档；旧正式剧本与下游仍保留旧快照并失效。不会自动采用新正式版本或重做分镜。",
        }))
      )
        return;
      const saved = await client.episodeDevelopments.saveScriptDocument(
        result.scriptId,
        { version: ast.version, title: ast.title, blocks: ast.blocks },
      );
      setDraft(undefined);
      setPreviewKey(undefined);
      setSelected(undefined);
      cache.setQueryData(["author-script-document", result.scriptId], saved);
      await refresh();
    });
  const preview = () =>
    perform(async () => {
      if (!ast || draft || !mappingKnown) return;
      const key = previewKey ?? crypto.randomUUID();
      setPreviewKey(key);
      select(
        await client.episodeDevelopments.previewScriptRevision(
          result.id,
          {
            sourceVersion: result.version,
            documentVersion: ast.version,
            sceneLinks: links,
          },
          key,
        ),
      );
      await history.refetch();
    });
  const action = (kind: "adopt" | "discard") =>
    perform(async () => {
      if (!selected) return;
      if (
        !(await confirmDialog({
          title:
            kind === "adopt" ? "确认新的正式剧本版本？" : "撤回本次人工预览？",
          description:
            kind === "adopt"
              ? "以审阅过的实际正文和场景映射生成独立正式快照。保留原正式版本；不调用模型、不修改实际正文、不自动更新分镜。语义正确性由作者声明，未获独立验证。"
              : "只撤回待确认预览，不撤回已保存的实际正文。",
        }))
      )
        return;
      const matches =
        actionKey?.id === selected.id &&
        actionKey.version === selected.stateVersion &&
        actionKey.kind === kind;
      const key = matches ? actionKey!.key : crypto.randomUUID();
      setActionKey({
        kind,
        id: selected.id,
        version: selected.stateVersion,
        key,
      });
      const value =
        kind === "adopt"
          ? await client.episodeDevelopments.adoptScriptRevision(
              selected.id,
              selected.stateVersion,
              {
                actualDocumentReviewed: true,
                sceneMappingReviewed: true,
                authorIntentAndSourcesRetained: true,
              },
              key,
            )
          : await client.episodeDevelopments.discardScriptRevision(
              selected.id,
              selected.stateVersion,
              key,
            );
      setSelected(value);
      await refresh();
    });
  return (
    <section
      aria-label="人工剧本修订确认"
      className="space-y-3 rounded border border-line p-3 text-sm"
    >
      <Button variant="secondary" onClick={() => setOpened(!opened)}>
        {opened ? "收起人工修订" : "审阅与确认人工修订"}
      </Button>
      <p className="text-muted">
        实际文档保存不等于正式采用。人工确认不调用模型，不自动重做分镜，也不解除其他来源失效。
      </p>
      {opened && (
        <>
          {(error || document.error || history.error || requested.error) && (
            <p role="alert" className="text-danger-strong">
              {error ??
                message(document.error ?? history.error ?? requested.error)}
            </p>
          )}
          {ast && (
            <details open aria-label="实际人工剧本文档">
              <summary>
                实际文档 v{ast.version} · 原正式快照 v
                {result.scriptDocumentVersion ?? "未知"} · {ast.blocks.length}{" "}
                个稳定块
              </summary>
              <label className="block">
                实际标题
                <input
                  aria-label="实际剧本标题"
                  className="w-full rounded border border-line bg-panel p-2"
                  value={ast.title}
                  disabled={busy}
                  onChange={(event) => {
                    setDraft({ ...ast, title: event.target.value });
                    setPreviewKey(undefined);
                  }}
                />
              </label>
              <div className="space-y-3">
                {ast.blocks.map((block, index) => (
                  <div key={block.id} className="space-y-1">
                    {index + 1} · {block.type}{" "}
                    <span className="text-muted break-all">{block.id}</span>
                    {"text" in block ? (
                      <textarea
                        aria-label={`人工剧本块 ${index + 1}`}
                        className="min-h-20 w-full rounded border border-line bg-panel p-2"
                        value={block.text}
                        disabled={busy}
                        onChange={(event) => {
                          setDraft({
                            ...ast,
                            blocks: ast.blocks.map((item) =>
                              item.id === block.id
                                ? { ...block, text: event.target.value }
                                : item,
                            ),
                          });
                          setPreviewKey(undefined);
                        }}
                      />
                    ) : (
                      <p>分页标记（保留）</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => {
                          setDraft({
                            ...ast,
                            blocks: [
                              ...ast.blocks.slice(0, index + 1),
                              {
                                id: crypto.randomUUID(),
                                type: "action",
                                text: "填写新增动作",
                              },
                              ...ast.blocks.slice(index + 1),
                            ],
                          });
                          setPreviewKey(undefined);
                        }}
                      >
                        在人工块 {index + 1} 后新增动作
                      </Button>
                      {block.type !== "scene_heading" && (
                        <>
                          <Button
                            variant="secondary"
                            disabled={
                              busy ||
                              index === 0 ||
                              ast.blocks[index - 1]?.type === "scene_heading"
                            }
                            onClick={() => {
                              const blocks = [...ast.blocks];
                              [blocks[index - 1], blocks[index]] = [
                                blocks[index]!,
                                blocks[index - 1]!,
                              ];
                              setDraft({ ...ast, blocks });
                              setPreviewKey(undefined);
                            }}
                          >
                            上移人工块 {index + 1}
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={
                              busy ||
                              index === ast.blocks.length - 1 ||
                              ast.blocks[index + 1]?.type === "scene_heading"
                            }
                            onClick={() => {
                              const blocks = [...ast.blocks];
                              [blocks[index], blocks[index + 1]] = [
                                blocks[index + 1]!,
                                blocks[index]!,
                              ];
                              setDraft({ ...ast, blocks });
                              setPreviewKey(undefined);
                            }}
                          >
                            下移人工块 {index + 1}
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => {
                              setDraft({
                                ...ast,
                                blocks: ast.blocks.filter(
                                  (item) => item.id !== block.id,
                                ),
                              });
                              setPreviewKey(undefined);
                            }}
                          >
                            移除人工块 {index + 1}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-muted">
                新增／移除／场内重排只是未保存草稿；原场景标题身份不变。保存后仍须预览完整连续映射与明确人工确认，分镜不会自动升级为新结构。
              </p>
              <Button disabled={busy || !draft} onClick={() => void save()}>
                保存实际人工正文（不正式采用）
              </Button>
              {draft && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setDraft(undefined)}
                >
                  放弃未保存编辑
                </Button>
              )}
              <h4 className="font-semibold">实际连续场景映射</h4>
              {links.map((link, index) => (
                <p key={index} className="break-all">
                  {link.sceneId || "未知场景：不可自动匹配"} ·{" "}
                  {link.blockIds.join("、")}
                </p>
              ))}
              {!mappingKnown && (
                <p role="alert" className="text-danger-strong">
                  场景结构与原正式映射未核全；请先重新审阅大纲与场景关系，不能猜测后采用。
                </p>
              )}
              <Button
                disabled={
                  busy ||
                  Boolean(draft) ||
                  !mappingKnown ||
                  ast.version === result.scriptDocumentVersion
                }
                onClick={() => void preview()}
              >
                预览实际人工修订正式版本
              </Button>
            </details>
          )}
          {history.data?.length ? (
            <details open>
              <summary>本集持久化人工确认历史（含重启恢复）</summary>
              {history.data.map((value) => (
                <Button
                  key={value.id}
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () =>
                      select(
                        await client.episodeDevelopments.getScriptRevision(
                          value.id,
                        ),
                      ),
                    )
                  }
                >
                  文档 v{value.document.version} ·{" "}
                  {value.status === "pending"
                    ? "待确认"
                    : value.status === "adopted"
                      ? "已采用"
                      : "已撤回"}{" "}
                  · {value.id.slice(0, 8)}
                </Button>
              ))}
            </details>
          ) : null}
          {selected && (
            <article aria-label="冻结人工剧本确认预览" className="space-y-3">
              <h4 className="font-semibold">
                {selected.title} · 实际文档 v{selected.document.version} ·{" "}
                {selected.status}
              </h4>
              <p className="break-all">
                原正式版本 {selected.sourceResult.id} v
                {selected.sourceResult.version} · 内容 SHA-256{" "}
                {selected.contentHash}
              </p>
              <p>
                继承原作者意图、故事来源、批准设定与大纲；不声称这些依据是新的模型输入。
              </p>
              <pre className="overflow-auto whitespace-pre-wrap break-all text-xs">
                {JSON.stringify(
                  {
                    authorIntent: selected.basis.authorIntent,
                    request: selected.basis.request,
                    references: selected.basis.references,
                  },
                  null,
                  2,
                )}
              </pre>
              {selected.staleReasons.map((reason) => (
                <p key={reason} role="alert" className="text-danger-strong">
                  {reason}
                </p>
              ))}
              {selected.content.blocks.map((block) => (
                <p key={block.id} className="whitespace-pre-wrap">
                  {block.type} · {"text" in block ? block.text : "分页"}
                </p>
              ))}
              {selected.content.sceneLinks.map((link) => (
                <p key={link.sceneId} className="break-all">
                  {link.sceneId} → {link.blockIds.join("、")}
                </p>
              ))}
              {selected.status === "pending" && (
                <>
                  {[
                    "我已审阅全部冻结实际正文",
                    "我已核对实际连续场景映射",
                    "我确认本次人工修订仍遵循原作者意图与来源；语义未获独立验证",
                  ].map((label, index) => (
                    <label key={label} className="block">
                      <input
                        type="checkbox"
                        checked={reviewed[index]}
                        disabled={busy}
                        onChange={(event) =>
                          setReviewed((values) =>
                            values.map((value, i) =>
                              i === index ? event.target.checked : value,
                            ),
                          )
                        }
                      />{" "}
                      {label}
                    </label>
                  ))}
                  <Button
                    disabled={
                      busy ||
                      !reviewed.every(Boolean) ||
                      selected.sourceState !== "current"
                    }
                    onClick={() => void action("adopt")}
                  >
                    确认采用人工修订为新正式剧本
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void action("discard")}
                  >
                    撤回人工确认预览
                  </Button>
                </>
              )}
            </article>
          )}
        </>
      )}
    </section>
  );
}
