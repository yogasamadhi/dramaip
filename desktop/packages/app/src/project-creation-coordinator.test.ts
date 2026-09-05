import { expect, test } from "bun:test";
import type { Project } from "@dramaip/contracts/product";
import { projectInitializationPlan } from "./project-creation-coordinator";

function project(mode: Project["mode"]): Project {
  return {
    id: crypto.randomUUID(),
    title: mode,
    mode,
    modeConfig:
      mode === "series_longform"
        ? { mode }
        : mode === "single_season"
          ? { mode, entryPath: "novel" }
          : mode === "personal_theater"
            ? {
                mode,
                storyMethod: "freeform",
                episodeCount: 1,
                episodeDurationMinutes: 3,
              }
            : { mode, topic: "从零创作" },
    lifecycleStatus: "ready",
    synopsis: "",
    version: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

test("所有创建入口共享四模式初始化计划", () => {
  expect(projectInitializationPlan(project("series_longform"))).toEqual([
    "series-materials",
  ]);
  expect(projectInitializationPlan(project("single_season"))).toEqual([
    "season-materials",
  ]);
  expect(projectInitializationPlan(project("personal_theater"))).toEqual([
    "theater-opening",
  ]);
  expect(projectInitializationPlan(project("creator_channel"))).toEqual([
    "creator-workspace",
  ]);
});
