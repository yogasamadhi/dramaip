import { useEffect, useState } from "react";
import { useSearchParams } from "../../router";
import { useQuery, useQueryClient } from "../../query";
import { Button, NativeSelect } from "@dramaip/infra-ui-primitives";
import { confirmDialog } from "../../controls";
import {
  EpisodeOutlineContentSchema,
  EpisodeScriptContentSchema,
  type EpisodeDevelopmentResult,
  type EpisodeOutlineContent,
  type EpisodeTopologyRevision,
  type ScreenplayDocument,
} from "@dramaip/contracts/production";
import { message, useStudio } from "../../studio-shared";
import styles from "./EpisodeTopologyRevisionPanel.module.css";
import { copyText } from "../../copy";

type Draft = {
  outline: EpisodeOutlineContent;
  document: ScreenplayDocument;
  links: { sceneId: string; blockIds: string[] }[];
  unsaved: boolean;
};
type TopologyIdentity = Pick<
  EpisodeTopologyRevision,
  "id" | "projectId" | "episodeId" | "sourceScript" | "sourceOutline"
>;
export function currentAuthorTopologyRevision<T extends TopologyIdentity>(
  query: { data?: T; error?: unknown; isFetching: boolean; status: string },
  expected: {
    id: string;
    projectId: string;
    episodeId: string;
    script: { id: string; version: number };
    outline?: { id: string; version: number };
  },
): T | undefined {
  const value = query.data;
  return query.status === "success" &&
    !query.isFetching &&
    !query.error &&
    value?.id === expected.id &&
    value.projectId === expected.projectId &&
    value.episodeId === expected.episodeId &&
    value.sourceScript.id === expected.script.id &&
    value.sourceScript.version === expected.script.version &&
    value.sourceOutline.id === expected.outline?.id &&
    value.sourceOutline.version === expected.outline.version
    ? value
    : undefined;
}
/** Explicit author operations. Actual save and immutable dual-head confirmation
 * are separate; a mapping/confirmation is not semantic or quality verification. */
export function EpisodeTopologyRevisionPanel({
  result,
}: {
  result: EpisodeDevelopmentResult;
}) {
  const client = useStudio(),
    cache = useQueryClient(),
    [params] = useSearchParams();
  const requestedId = params.get("topologyRevisionId")?.trim() || undefined;
  const [opened, setOpened] = useState(Boolean(requestedId)),
    [draft, setDraft] = useState<Draft>();
  const [selected, setSelected] = useState<EpisodeTopologyRevision>(),
    [reviewed, setReviewed] = useState([false, false, false, false]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>(),
    [previewKey, setPreviewKey] = useState<string>();
  const [actionKey, setActionKey] = useState<{
    id: string;
    version: number;
    kind: "adopt" | "discard";
    key: string;
  }>();
  const outlineRef = result.basis.request.outline;
  const outline = useQuery({
    queryKey: ["author-topology-outline", result.projectId, outlineRef?.id],
    enabled: opened && Boolean(outlineRef),
    queryFn: async () => {
      const value = await client.episodeDevelopments.get(outlineRef!.id);
      if (
        value.projectId !== result.projectId ||
        value.episodeId !== result.episodeId ||
        value.version !== outlineRef!.version ||
        value.content.kind !== "episode-outline"
      )
        throw new Error("原正式大纲归属或版本未核全，不使用最新大纲。");
      return value;
    },
  });
  const document = useQuery({
    queryKey: ["author-topology-document", result.projectId, result.scriptId],
    enabled: opened && Boolean(result.scriptId),
    queryFn: async () => {
      const value = await client.screenplays.get(result.scriptId!);
      if (
        value.projectId !== result.projectId ||
        value.scriptId !== result.scriptId
      )
        throw new Error("实际剧本归属不符，不读取其他文档。");
      return value;
    },
  });
  const requested = useQuery({
    queryKey: [
      "author-topology-requested",
      result.projectId,
      result.id,
      requestedId,
    ],
    enabled: Boolean(requestedId),
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const value = await client.episodeDevelopments.getTopologyRevision(
        requestedId!,
      );
      if (
        value.projectId !== result.projectId ||
        value.episodeId !== result.episodeId ||
        value.sourceScript.id !== result.id ||
        value.sourceScript.version !== result.version ||
        value.sourceOutline.id !== outlineRef?.id ||
        value.sourceOutline.version !== outlineRef.version
      )
        throw new Error("指定拓扑预览不属于原正式剧本／大纲，不回退最新预览。");
      return value;
    },
  });
  useEffect(() => {
    setDraft(undefined);
    setSelected(undefined);
    setReviewed([false, false, false, false]);
    setPreviewKey(undefined);
    setActionKey(undefined);
    setError(undefined);
  }, [result.id, requestedId]);
  const value = requestedId
    ? currentAuthorTopologyRevision(requested, {
        id: requestedId,
        projectId: result.projectId,
        episodeId: result.episodeId,
        script: { id: result.id, version: result.version },
        outline: outlineRef,
      })
    : selected;
  const ownedValue =
    value?.projectId === result.projectId &&
    value.episodeId === result.episodeId &&
    value.sourceScript.id === result.id
      ? value
      : undefined;
  const start = () => {
    if (
      outline.data?.content.kind !== "episode-outline" ||
      !document.data ||
      result.content.kind !== "episode-script"
    )
      return;
    const links = document.data.blocks.reduce<Draft["links"]>(
      (groups, block) => {
        if (block.type === "scene_heading")
          groups.push({
            sceneId:
              result.content.kind === "episode-script"
                ? (result.content.value.sceneLinks.find(
                    (link) => link.blockIds[0] === block.id,
                  )?.sceneId ?? "")
                : "",
            blockIds: [block.id],
          });
        else groups.at(-1)?.blockIds.push(block.id);
        return groups;
      },
      [],
    );
    setDraft({
      outline: structuredClone(outline.data.content.value),
      document: structuredClone(document.data),
      links,
      unsaved: false,
    });
    setSelected(undefined);
    setPreviewKey(undefined);
  };
  const change = (work: (next: Draft) => void, writesDocument = false) => {
    if (!draft) return;
    const next = structuredClone(draft);
    work(next);
    if (writesDocument) next.unsaved = true;
    setDraft(next);
    setPreviewKey(undefined);
    setSelected(undefined);
    setReviewed([false, false, false, false]);
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
  const addScene = (existingGroup?: number) =>
    change((next) => {
      const base = next.outline.scenes[0]!;
      const id = crypto.randomUUID(),
        headingId = crypto.randomUUID(),
        actionId = crypto.randomUUID();
      const heading =
        existingGroup === undefined
          ? "INT. 作者新场景 - DAY"
          : next.document.blocks.find(
              (block) => block.id === next.links[existingGroup]?.blockIds[0],
            );
      const scene = {
        ...structuredClone(base),
        id,
        orderIndex: next.outline.scenes.length,
        location:
          typeof heading === "object" && "text" in heading
            ? heading.text
            : "作者新场景",
        goal: "请明确新场景目标",
        conflict: "请明确新场景冲突",
        outcome: "请明确新场景结果",
        durationSeconds: 1,
        beats: [
          {
            id: crypto.randomUUID(),
            action: "请明确新场景行动",
            causalLink: "请明确实际因果",
          },
        ],
        ...(base.sourceEvidence
          ? {
              sourceEvidence: base.sourceEvidence.map((item) => ({
                ...item,
                id: crypto.randomUUID(),
              })),
            }
          : {}),
      };
      next.outline.scenes.push(scene);
      if (existingGroup !== undefined) next.links[existingGroup]!.sceneId = id;
      else {
        next.document.blocks.push(
          {
            id: headingId,
            type: "scene_heading",
            text: "INT. 作者新场景 - DAY",
          },
          {
            id: actionId,
            type: "action",
            text: "请填写实际新场景行动或对白。",
          },
        );
        next.links.push({ sceneId: id, blockIds: [headingId, actionId] });
      }
    }, existingGroup === undefined);
  const remove = (index: number) =>
    change((next) => {
      const scene = next.outline.scenes[index]!;
      const links = next.links.filter((link) => link.sceneId === scene.id),
        removed = new Set(links.flatMap((link) => link.blockIds));
      next.document.blocks = next.document.blocks.filter(
        (block) => !removed.has(block.id),
      );
      next.links = next.links.filter((link) => link.sceneId !== scene.id);
      next.outline.scenes.splice(index, 1);
      next.outline.scenes.forEach((item, orderIndex) => {
        item.orderIndex = orderIndex;
      });
    }, true);
  const move = (index: number, delta: number) =>
    change((next) => {
      const target = index + delta;
      if (
        target < 0 ||
        target >= next.outline.scenes.length ||
        next.links.length !== next.outline.scenes.length ||
        next.links.some(
          (link, i) => link.sceneId !== next.outline.scenes[i]?.id,
        )
      )
        throw new Error("先明确每个实际块组与场景的一一映射，再重排完整场景。");
      const [scene] = next.outline.scenes.splice(index, 1),
        [link] = next.links.splice(index, 1);
      next.outline.scenes.splice(target, 0, scene!);
      next.links.splice(target, 0, link!);
      next.outline.scenes.forEach((item, orderIndex) => {
        item.orderIndex = orderIndex;
      });
      next.document.blocks = next.links.flatMap((group) =>
        group.blockIds.map((id) =>
          next.document.blocks.find((block) => block.id === id)!,
        ),
      );
    }, true);
  const mappingReady = Boolean(
    draft &&
    draft.links.length === draft.outline.scenes.length &&
    draft.links.every(
      (link, index) => link.sceneId === draft.outline.scenes[index]?.id,
    ) &&
    new Set(draft.links.flatMap((link) => link.blockIds)).size ===
      draft.document.blocks.length &&
    draft.links.flatMap((link) => link.blockIds).length ===
      draft.document.blocks.length,
  );
  const save = () =>
    perform(async () => {
      if (!draft?.unsaved || !result.scriptId) return;
      if (
        !(await confirmDialog({
          title: "保存实际场景结构和正文？",
          description:
            "仅保存实际剧本文档，旧正式快照与原分镜保留并可能失效。不会采用新大纲或剧本，不自动重做分镜。删除场景将移除实际文档中的对应块，请先审阅。",
        }))
      )
        return;
      const saved = await client.episodeDevelopments.saveScriptDocument(
        result.scriptId,
        {
          version: draft.document.version,
          title: draft.document.title,
          blocks: draft.document.blocks,
        },
      );
      setDraft({ ...draft, document: saved, unsaved: false });
      setPreviewKey(undefined);
      cache.setQueryData(
        ["author-topology-document", result.projectId, result.scriptId],
        saved,
      );
      await cache.invalidateQueries();
    });
  const preview = () =>
    perform(async () => {
      if (!draft || draft.unsaved || !mappingReady || !outlineRef) return;
      const outlineContent = EpisodeOutlineContentSchema.parse(draft.outline),
        content = EpisodeScriptContentSchema.parse({
          blocks: draft.document.blocks,
          sceneLinks: draft.links,
        });
      const key = previewKey ?? crypto.randomUUID();
      setPreviewKey(key);
      setSelected(
        await client.episodeDevelopments.previewTopologyRevision(
          result.id,
          {
            sourceVersion: result.version,
            outline: outlineRef,
            documentVersion: draft.document.version,
            outlineContent,
            sceneLinks: content.sceneLinks,
          },
          key,
        ),
      );
      setReviewed([false, false, false, false]);
      await cache.invalidateQueries();
    });
  const action = (kind: "adopt" | "discard") =>
    perform(async () => {
      if (!ownedValue || ownedValue.status !== "pending") return;
      if (
        !(await confirmDialog({
          title:
            kind === "adopt"
              ? "一起确认新正式大纲与剧本？"
              : "撤回场景拓扑预览？",
          description:
            kind === "adopt"
              ? "两份正式结果和两条采用头一起提交，失败则全部回滚。保留原快照和实际正文；不调用模型、不自动重做分镜、迁移媒体或确认权利。语义正确性仅由作者声明，未独立验证。"
              : "仅撤回原待确认预览；已保存的实际正文不回退。",
        }))
      )
        return;
      const key =
        actionKey?.id === ownedValue.id &&
        actionKey.version === ownedValue.stateVersion &&
        actionKey.kind === kind
          ? actionKey.key
          : crypto.randomUUID();
      setActionKey({
        id: ownedValue.id,
        version: ownedValue.stateVersion,
        kind,
        key,
      });
      const changed =
        kind === "adopt"
          ? await client.episodeDevelopments.adoptTopologyRevision(
              ownedValue.id,
              ownedValue.stateVersion,
              {
                actualDocumentReviewed: true,
                outlineTopologyReviewed: true,
                sceneMappingReviewed: true,
                authorIntentAndSourcesRetained: true,
              },
              key,
            )
          : await client.episodeDevelopments.discardTopologyRevision(
              ownedValue.id,
              ownedValue.stateVersion,
              key,
            );
      setSelected(changed);
      await cache.invalidateQueries();
    });
  if (!opened)
    return (
      <Button variant="ghost" onClick={() => setOpened(true)}>
        {copyText("app/features/production/EpisodeTopologyRevisionPanel.1")}
      </Button>
    );
  return (
    <section
      aria-label={copyText(
        "app/features/production/EpisodeTopologyRevisionPanel.2",
      )}
      className={styles.c1}
    >
      <h4 className={styles.c2}>
        {copyText("app/features/production/EpisodeTopologyRevisionPanel.3")}
      </h4>
      <p className={styles.c3}>
        {copyText("app/features/production/EpisodeTopologyRevisionPanel.4")}
      </p>
      {[
        error,
        outline.error && message(outline.error),
        document.error && message(document.error),
        requested.error && message(requested.error),
      ]
        .filter(Boolean)
        .map((text, index) => (
          <p role="alert" className={styles.c4} key={index}>
            {text}
          </p>
        ))}
      {!requestedId && !draft && (
        <Button
          disabled={
            busy || !result.isCurrent || !outline.data || !document.data
          }
          onClick={start}
        >
          {copyText("app/features/production/EpisodeTopologyRevisionPanel.5")}
        </Button>
      )}
      {!requestedId && draft && (
        <>
          <label className={styles.c5}>
            {copyText("app/features/production/EpisodeTopologyRevisionPanel.6")}
            <input
              aria-label={copyText(
                "app/features/production/EpisodeTopologyRevisionPanel.7",
              )}
              className={styles.c6}
              value={draft.document.title}
              disabled={busy}
              onChange={(event) =>
                change((next) => {
                  next.document.title = event.target.value;
                }, true)
              }
            />
          </label>
          <p className={styles.c7}>
            {copyText("app/features/production/EpisodeTopologyRevisionPanel.8")}
            {draft.outline.scenes.length}
            {copyText(
              "app/features/production/EpisodeTopologyRevisionPanel.9",
            )}{" "}
            {draft.outline.scenes.reduce(
              (sum, scene) => sum + scene.durationSeconds,
              0,
            )}{" "}
            {copyText(
              "app/features/production/EpisodeTopologyRevisionPanel.10",
            )}
            {result.basis.episode.durationSeconds}
            {copyText(
              "app/features/production/EpisodeTopologyRevisionPanel.11",
            )}{" "}
            {draft.unsaved
              ? "实际文档尚未保存"
              : `实际文档 v${draft.document.version}`}
          </p>
          {draft.outline.scenes.map((scene, index) => (
            <article
              key={scene.id}
              aria-label={copyText(
                "app/features/production/EpisodeTopologyRevisionPanel.40",
                { p1: index + 1 },
              )}
              className={styles.c8}
            >
              <p className={styles.c7}>
                {copyText(
                  "app/features/production/EpisodeTopologyRevisionPanel.8",
                )}
                {index + 1} · {scene.id}
              </p>
              {(
                [
                  "location",
                  "timeOfDay",
                  "goal",
                  "conflict",
                  "outcome",
                ] as const
              ).map((field) => (
                <label className={styles.c5} key={field}>
                  {
                    {
                      location: "地点",
                      timeOfDay: "时间",
                      goal: "目标",
                      conflict: "冲突",
                      outcome: "结果",
                    }[field]
                  }
                  <input
                    aria-label={copyText(
                      "app/features/production/EpisodeTopologyRevisionPanel.41",
                      { p1: index + 1, p2: field },
                    )}
                    className={styles.c6}
                    value={scene[field]}
                    disabled={busy}
                    onChange={(event) =>
                      change((next) => {
                        next.outline.scenes[index]![field] = event.target.value;
                      })
                    }
                  />
                </label>
              ))}
              <label className={styles.c5}>
                {copyText(
                  "app/features/production/EpisodeTopologyRevisionPanel.12",
                )}
                <input
                  aria-label={copyText(
                    "app/features/production/EpisodeTopologyRevisionPanel.42",
                    { p1: index + 1 },
                  )}
                  type="number"
                  min={1}
                  max={1800}
                  value={scene.durationSeconds}
                  disabled={busy}
                  onChange={(event) =>
                    change((next) => {
                      next.outline.scenes[index]!.durationSeconds = Number(
                        event.target.value,
                      );
                    })
                  }
                />
              </label>
              {scene.beats.map((beat, beatIndex) => (
                <div key={beat.id} className={styles.c9}>
                  <input
                    aria-label={copyText(
                      "app/features/production/EpisodeTopologyRevisionPanel.43",
                      { p1: index + 1, p2: beatIndex + 1 },
                    )}
                    className={styles.c6}
                    value={beat.action}
                    disabled={busy}
                    onChange={(event) =>
                      change((next) => {
                        next.outline.scenes[index]!.beats[beatIndex]!.action =
                          event.target.value;
                      })
                    }
                  />
                  <input
                    aria-label={copyText(
                      "app/features/production/EpisodeTopologyRevisionPanel.44",
                      { p1: index + 1, p2: beatIndex + 1 },
                    )}
                    className={styles.c6}
                    value={beat.causalLink}
                    disabled={busy}
                    onChange={(event) =>
                      change((next) => {
                        next.outline.scenes[index]!.beats[
                          beatIndex
                        ]!.causalLink = event.target.value;
                      })
                    }
                  />
                </div>
              ))}
              <p className={styles.c3}>
                {copyText(
                  "app/features/production/EpisodeTopologyRevisionPanel.13",
                )}
              </p>
              <details>
                <summary>
                  {copyText(
                    "app/features/production/EpisodeTopologyRevisionPanel.14",
                  )}
                </summary>
                <pre className={styles.c10}>
                  {JSON.stringify(
                    {
                      sourceChapters: scene.sourceChapters,
                      sourceReferences: scene.sourceReferences,
                      sourceEvidence: scene.sourceEvidence,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
              <div className={styles.c11}>
                <Button
                  variant="ghost"
                  disabled={busy || index === 0 || !mappingReady}
                  onClick={() => move(index, -1)}
                >
                  {copyText(
                    "app/features/production/EpisodeTopologyRevisionPanel.15",
                  )}
                </Button>
                <Button
                  variant="ghost"
                  disabled={
                    busy ||
                    index === draft.outline.scenes.length - 1 ||
                    !mappingReady
                  }
                  onClick={() => move(index, 1)}
                >
                  {copyText(
                    "app/features/production/EpisodeTopologyRevisionPanel.16",
                  )}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy || draft.outline.scenes.length <= 1}
                  onClick={() => remove(index)}
                >
                  {copyText(
                    "app/features/production/EpisodeTopologyRevisionPanel.17",
                  )}
                </Button>
              </div>
            </article>
          ))}
          <Button variant="ghost" disabled={busy} onClick={() => addScene()}>
            {copyText(
              "app/features/production/EpisodeTopologyRevisionPanel.18",
            )}
          </Button>
          <Button
            variant="ghost"
            disabled={
              busy ||
              new Set(draft.links.map((link) => link.sceneId)).size !==
                draft.outline.scenes.length ||
              draft.links.length !== draft.outline.scenes.length ||
              draft.links.some(
                (link) =>
                  !draft.outline.scenes.some(
                    (scene) => scene.id === link.sceneId,
                  ),
              )
            }
            onClick={() =>
              change((next) => {
                next.outline.scenes = next.links.map((link, orderIndex) => ({
                  ...next.outline.scenes.find(
                    (scene) => scene.id === link.sceneId,
                  )!,
                  orderIndex,
                }));
              })
            }
          >
            {copyText(
              "app/features/production/EpisodeTopologyRevisionPanel.19",
            )}
          </Button>
          {draft.links.map((link, groupIndex) => (
            <div key={link.blockIds[0]} className={styles.c8}>
              <label className={styles.c5}>
                {copyText(
                  "app/features/production/EpisodeTopologyRevisionPanel.20",
                )}
                {groupIndex + 1}
                {copyText(
                  "app/features/production/EpisodeTopologyRevisionPanel.21",
                )}
                <NativeSelect
                  className={styles.c12}
                  aria-label={copyText(
                    "app/features/production/EpisodeTopologyRevisionPanel.45",
                    { p1: groupIndex + 1 },
                  )}
                  value={link.sceneId}
                  disabled={busy}
                  onChange={(event) =>
                    change((next) => {
                      next.links[groupIndex]!.sceneId = event.target.value;
                    })
                  }
                >
                  <option value="">
                    {copyText(
                      "app/features/production/EpisodeTopologyRevisionPanel.22",
                    )}
                  </option>
                  {draft.outline.scenes.map((scene) => (
                    <option key={scene.id} value={scene.id}>
                      {scene.orderIndex + 1} · {scene.location} · {scene.id}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              {!link.sceneId && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => addScene(groupIndex)}
                >
                  {copyText(
                    "app/features/production/EpisodeTopologyRevisionPanel.23",
                  )}
                </Button>
              )}
              {link.blockIds.map((id) => {
                const block = draft.document.blocks.find(
                  (item) => item.id === id,
                );
                return block && "text" in block ? (
                  <textarea
                    key={id}
                    aria-label={copyText(
                      "app/features/production/EpisodeTopologyRevisionPanel.46",
                      { p1: id },
                    )}
                    className={styles.c13}
                    value={block.text}
                    disabled={busy}
                    onChange={(event) =>
                      change((next) => {
                        const actual = next.document.blocks.find(
                          (item) => item.id === id,
                        )!;
                        if ("text" in actual) actual.text = event.target.value;
                      }, true)
                    }
                  />
                ) : null;
              })}
            </div>
          ))}
          {!mappingReady && (
            <p role="status" className={styles.c4}>
              {copyText(
                "app/features/production/EpisodeTopologyRevisionPanel.24",
              )}
            </p>
          )}
          <div className={styles.c14}>
            <Button disabled={busy || !draft.unsaved} onClick={save}>
              {copyText(
                "app/features/production/EpisodeTopologyRevisionPanel.25",
              )}
            </Button>
            <Button
              disabled={
                busy || draft.unsaved || !mappingReady || !result.isCurrent
              }
              onClick={preview}
            >
              {copyText(
                "app/features/production/EpisodeTopologyRevisionPanel.26",
              )}
            </Button>
          </div>
        </>
      )}
      {ownedValue && (
        <article
          aria-label={copyText(
            "app/features/production/EpisodeTopologyRevisionPanel.27",
          )}
          className={styles.c8}
        >
          <p className={styles.c7}>
            {copyText(
              "app/features/production/EpisodeTopologyRevisionPanel.28",
            )}
            {ownedValue.id} · {ownedValue.status}
            {copyText(
              "app/features/production/EpisodeTopologyRevisionPanel.29",
            )}
            {ownedValue.document.version}
            {copyText(
              "app/features/production/EpisodeTopologyRevisionPanel.30",
            )}
            {ownedValue.sourceOutline.id}@{ownedValue.sourceOutline.version}
            {copyText(
              "app/features/production/EpisodeTopologyRevisionPanel.31",
            )}{" "}
            {ownedValue.sourceScript.id}@{ownedValue.sourceScript.version}
          </p>
          {ownedValue.staleReasons.map((reason) => (
            <p key={reason} className={styles.c4}>
              {reason}
            </p>
          ))}
          <details open>
            <summary>
              {copyText(
                "app/features/production/EpisodeTopologyRevisionPanel.32",
              )}
            </summary>
            <pre className={styles.c10}>
              {JSON.stringify(
                {
                  outline: ownedValue.outlineContent,
                  script: ownedValue.scriptContent,
                },
                null,
                2,
              )}
            </pre>
          </details>
          <p className={styles.c15}>
            {copyText(
              "app/features/production/EpisodeTopologyRevisionPanel.33",
            )}
            {ownedValue.outlineContentHash}
            {copyText(
              "app/features/production/EpisodeTopologyRevisionPanel.34",
            )}{" "}
            {ownedValue.scriptContentHash}
          </p>
          {ownedValue.results && (
            <p className={styles.c7}>
              {copyText(
                "app/features/production/EpisodeTopologyRevisionPanel.35",
              )}
              {ownedValue.results.outline.id}@
              {ownedValue.results.outline.version}
              {copyText(
                "app/features/production/EpisodeTopologyRevisionPanel.36",
              )}{" "}
              {ownedValue.results.script.id}@{ownedValue.results.script.version}
              {copyText(
                "app/features/production/EpisodeTopologyRevisionPanel.37",
              )}
            </p>
          )}
          {ownedValue.status === "pending" && (
            <>
              {[
                "已审阅实际保存正文",
                "已审阅新完整大纲的身份、顺序和时长",
                "已审阅全部实际连续块映射",
                "作者意图与原故事来源保留；语义仅由我声明",
              ].map((label, index) => (
                <label className={styles.c5} key={label}>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={reviewed[index]}
                    onChange={(event) =>
                      setReviewed(
                        reviewed.map((item, i) =>
                          i === index ? event.target.checked : item,
                        ),
                      )
                    }
                  />{" "}
                  {label}
                </label>
              ))}
              <div className={styles.c14}>
                <Button
                  disabled={
                    busy ||
                    ownedValue.sourceState !== "current" ||
                    !reviewed.every(Boolean)
                  }
                  onClick={() => action("adopt")}
                >
                  {copyText(
                    "app/features/production/EpisodeTopologyRevisionPanel.38",
                  )}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => action("discard")}
                >
                  {copyText(
                    "app/features/production/EpisodeTopologyRevisionPanel.39",
                  )}
                </Button>
              </div>
            </>
          )}
        </article>
      )}
    </section>
  );
}
