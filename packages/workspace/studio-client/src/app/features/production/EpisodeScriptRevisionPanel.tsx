import { useEffect, useState } from "react";
import { useSearchParams } from "../../router";
import { useQuery, useQueryClient } from "../../query";
import { Button } from "@dramaip/infra-ui-primitives";
import { confirmDialog } from "../../controls";
import type {
  EpisodeDevelopmentResult,
  EpisodeScriptRevision,
  ScreenplayDocument,
} from "@dramaip/contracts/production";
import { message, useStudio } from "../../studio-shared";
import styles from "./EpisodeScriptRevisionPanel.module.css";
import { copyText } from "../../copy";

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
      aria-label={copyText(
        "app/features/production/EpisodeScriptRevisionPanel.1",
      )}
      className={styles.c1}
    >
      <Button variant="secondary" onClick={() => setOpened(!opened)}>
        {opened ? "收起人工修订" : "审阅与确认人工修订"}
      </Button>
      <p className={styles.c2}>
        {copyText("app/features/production/EpisodeScriptRevisionPanel.2")}
      </p>
      {opened && (
        <>
          {(error || document.error || history.error || requested.error) && (
            <p role="alert" className={styles.c3}>
              {error ??
                message(document.error ?? history.error ?? requested.error)}
            </p>
          )}
          {ast && (
            <details
              open
              aria-label={copyText(
                "app/features/production/EpisodeScriptRevisionPanel.3",
              )}
            >
              <summary>
                {copyText(
                  "app/features/production/EpisodeScriptRevisionPanel.4",
                )}
                {ast.version}
                {copyText(
                  "app/features/production/EpisodeScriptRevisionPanel.5",
                )}
                {result.scriptDocumentVersion ?? "未知"} · {ast.blocks.length}{" "}
                {copyText(
                  "app/features/production/EpisodeScriptRevisionPanel.6",
                )}
              </summary>
              <label className={styles.c4}>
                {copyText(
                  "app/features/production/EpisodeScriptRevisionPanel.7",
                )}
                <input
                  aria-label={copyText(
                    "app/features/production/EpisodeScriptRevisionPanel.8",
                  )}
                  className={styles.c5}
                  value={ast.title}
                  disabled={busy}
                  onChange={(event) => {
                    setDraft({ ...ast, title: event.target.value });
                    setPreviewKey(undefined);
                  }}
                />
              </label>
              <div className={styles.c6}>
                {ast.blocks.map((block, index) => (
                  <div key={block.id} className={styles.c7}>
                    {index + 1} · {block.type}{" "}
                    <span className={styles.c8}>{block.id}</span>
                    {"text" in block ? (
                      <textarea
                        aria-label={copyText(
                          "app/features/production/EpisodeScriptRevisionPanel.31",
                          { p1: index + 1 },
                        )}
                        className={styles.c9}
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
                      <p>
                        {copyText(
                          "app/features/production/EpisodeScriptRevisionPanel.9",
                        )}
                      </p>
                    )}
                    <div className={styles.c10}>
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
                        {copyText(
                          "app/features/production/EpisodeScriptRevisionPanel.10",
                        )}
                        {index + 1}
                        {copyText(
                          "app/features/production/EpisodeScriptRevisionPanel.11",
                        )}
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
                            {copyText(
                              "app/features/production/EpisodeScriptRevisionPanel.12",
                            )}
                            {index + 1}
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
                            {copyText(
                              "app/features/production/EpisodeScriptRevisionPanel.13",
                            )}
                            {index + 1}
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
                            {copyText(
                              "app/features/production/EpisodeScriptRevisionPanel.14",
                            )}
                            {index + 1}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className={styles.c2}>
                {copyText(
                  "app/features/production/EpisodeScriptRevisionPanel.15",
                )}
              </p>
              <Button disabled={busy || !draft} onClick={() => void save()}>
                {copyText(
                  "app/features/production/EpisodeScriptRevisionPanel.16",
                )}
              </Button>
              {draft && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setDraft(undefined)}
                >
                  {copyText(
                    "app/features/production/EpisodeScriptRevisionPanel.17",
                  )}
                </Button>
              )}
              <h4 className={styles.c11}>
                {copyText(
                  "app/features/production/EpisodeScriptRevisionPanel.18",
                )}
              </h4>
              {links.map((link, index) => (
                <p key={index} className={styles.c12}>
                  {link.sceneId || "未知场景：不可自动匹配"} ·{" "}
                  {link.blockIds.join("、")}
                </p>
              ))}
              {!mappingKnown && (
                <p role="alert" className={styles.c3}>
                  {copyText(
                    "app/features/production/EpisodeScriptRevisionPanel.19",
                  )}
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
                {copyText(
                  "app/features/production/EpisodeScriptRevisionPanel.20",
                )}
              </Button>
            </details>
          )}
          {history.data?.length ? (
            <details open>
              <summary>
                {copyText(
                  "app/features/production/EpisodeScriptRevisionPanel.21",
                )}
              </summary>
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
                  {copyText(
                    "app/features/production/EpisodeScriptRevisionPanel.22",
                  )}
                  {value.document.version} ·{" "}
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
            <article
              aria-label={copyText(
                "app/features/production/EpisodeScriptRevisionPanel.23",
              )}
              className={styles.c6}
            >
              <h4 className={styles.c11}>
                {selected.title}
                {copyText(
                  "app/features/production/EpisodeScriptRevisionPanel.24",
                )}
                {selected.document.version} · {selected.status}
              </h4>
              <p className={styles.c12}>
                {copyText(
                  "app/features/production/EpisodeScriptRevisionPanel.25",
                )}
                {selected.sourceResult.id}
                {copyText(
                  "app/features/production/EpisodeScriptRevisionPanel.26",
                )}
                {selected.sourceResult.version}
                {copyText(
                  "app/features/production/EpisodeScriptRevisionPanel.27",
                )}{" "}
                {selected.contentHash}
              </p>
              <p>
                {copyText(
                  "app/features/production/EpisodeScriptRevisionPanel.28",
                )}
              </p>
              <pre className={styles.c13}>
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
                <p key={reason} role="alert" className={styles.c3}>
                  {reason}
                </p>
              ))}
              {selected.content.blocks.map((block) => (
                <p key={block.id} className={styles.c14}>
                  {block.type} · {"text" in block ? block.text : "分页"}
                </p>
              ))}
              {selected.content.sceneLinks.map((link) => (
                <p key={link.sceneId} className={styles.c12}>
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
                    <label key={label} className={styles.c4}>
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
                    {copyText(
                      "app/features/production/EpisodeScriptRevisionPanel.29",
                    )}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void action("discard")}
                  >
                    {copyText(
                      "app/features/production/EpisodeScriptRevisionPanel.30",
                    )}
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
