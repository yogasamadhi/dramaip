import { expect, test } from "bun:test";
import { defaultProductionBrief } from "../../project-intake";
import { projectModeConfigFromDraft } from "./impl";

test("四种创建模式从草稿生成可持久化配置", () => {
  const draft = defaultProductionBrief("inspiration");
  draft.targetChapterCount = "360";
  draft.targetSeasonCount = "6";
  draft.targetEpisodesPerSeason = "72";
  expect(
    projectModeConfigFromDraft("series_longform", "inspiration", draft, ""),
  ).toEqual({
    mode: "series_longform",
    targetChapterCount: 360,
    targetSeasonCount: 6,
    targetEpisodesPerSeason: 72,
  });

  draft.targetEpisodeCount = "24";
  expect(
    projectModeConfigFromDraft("single_season", "script", draft, ""),
  ).toEqual({
    mode: "single_season",
    entryPath: "script",
    targetEpisodeCount: 24,
  });
  expect(
    projectModeConfigFromDraft(
      "personal_theater",
      "inspiration",
      { ...draft, episodeDuration: "7 分钟" },
      "",
    ),
  ).toMatchObject({
    mode: "personal_theater",
    episodeCount: 24,
    episodeDurationMinutes: 7,
  });
  expect(
    projectModeConfigFromDraft(
      "creator_channel",
      "inspiration",
      draft,
      "科技解读",
    ),
  ).toMatchObject({ mode: "creator_channel", topic: "科技解读" });
});

test("非正整数规模与空博主主题不会生成配置", () => {
  const draft = defaultProductionBrief("inspiration");
  draft.targetChapterCount = "0";
  expect(
    projectModeConfigFromDraft("series_longform", "inspiration", draft, ""),
  ).toBeUndefined();
  expect(
    projectModeConfigFromDraft("creator_channel", "inspiration", draft, ""),
  ).toBeUndefined();
});
