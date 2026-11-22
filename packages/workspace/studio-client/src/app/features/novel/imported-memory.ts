import { useEffect } from "react";
import type { CreationWorkflow } from "@dramaip/contracts/creation";
import type { Chapter } from "@dramaip/contracts/product";
import type { StudioClient } from "../../../facade/index";
import { ACTIVE_CREATION_STAGES } from "./novel-planning";

/** How many imported chapters are sent for memory at a time. */
const BATCH = 8;

/**
 * The chapters that still need their memory recorded: chapters with text
 * that no AI chapter draft wrote and no memory run has covered yet.
 */
export function chaptersWithoutMemory(
  chapters: readonly Chapter[],
  runs: readonly CreationWorkflow[],
): Chapter[] {
  const covered = new Set(
    runs
      .filter(
        (run) =>
          run.input.operation === "chapter" ||
          (run.input.operation === "chapter-memory" &&
            run.stage !== "failed" &&
            run.stage !== "canceled"),
      )
      .map((run) => run.input.targetId),
  );
  return [...chapters]
    .filter((chapter) => chapter.content.trim() && !covered.has(chapter.id))
    .sort((a, b) => a.orderIndex - b.orderIndex);
}

/**
 * Records the story memory of the author's own chapters (an imported book)
 * a few at a time, the same way memory follows an adopted AI chapter.
 * It starts only once the author asked for it (`requested`); after that,
 * later calls carry on with the rest. Returns how many chapters are still
 * waiting; call again until it is 0.
 */
export async function recordImportedChapterMemory(
  client: StudioClient,
  projectId: string,
  chapters: readonly Chapter[],
  requested = false,
): Promise<number> {
  const runs = (await client.creation.list(projectId)).items;
  const imported = runs.filter(
    (run) =>
      run.input.operation === "chapter-memory" &&
      run.input.memoryTrigger === "imported",
  );
  if (!requested && !imported.length) return 0;
  const waiting = chaptersWithoutMemory(chapters, runs);
  if (!waiting.length) return 0;
  const busy = imported.some((run) => ACTIVE_CREATION_STAGES.has(run.stage));
  if (busy) return waiting.length;
  const settings = await client.agentEngines.getProjectSettings(projectId);
  const batch = waiting.slice(0, BATCH);
  for (const chapter of batch)
    await client.creation.start(
      {
        projectId,
        operation: "chapter-memory",
        targetId: chapter.id,
        baseVersion: chapter.version,
        instruction:
          "从作者导入的正文提取摘要、事件、人物状态与伏笔，仅记录有原文证据的事实。",
        engineKind: settings.defaultEngineKind,
        ...(settings.defaultModel
          ? { model: { ...settings.defaultModel } }
          : {}),
        sourceIds: [],
        memoryTrigger: "imported",
      },
      `memory:import:${chapter.id}:${chapter.version}`,
    );
  return waiting.length - batch.length;
}

/**
 * While mounted, records the story memory of `chapters` in the background,
 * a batch at a time, until every chapter is covered. Nothing starts until
 * the author asks (`requested`) or an earlier request is still unfinished.
 */
export function useImportedChapterMemory(
  client: StudioClient,
  projectId: string,
  chapters: readonly Chapter[],
  requested: boolean,
): void {
  const key = chapters
    .filter((chapter) => chapter.content.trim())
    .map((chapter) => `${chapter.id}:${chapter.version}`)
    .join(",");
  useEffect(() => {
    if (!key) return;
    let stopped = false;
    let timer: number | undefined;
    const step = async () => {
      const left = await recordImportedChapterMemory(
        client,
        projectId,
        chapters,
        requested,
      ).catch(() => 0);
      if (!stopped && left > 0)
        timer = window.setTimeout(() => void step(), 15_000);
    };
    void step();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [client, projectId, key, requested]);
}
