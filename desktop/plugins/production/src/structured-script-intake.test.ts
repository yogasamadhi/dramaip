import { describe, expect, it } from "vitest";
import { parseStructuredScriptIntake } from "./structured-script-intake.js";

describe("structured screenplay intake", () => {
  it("keeps all episodes in file order, original bodies, stable AST and scene metadata without a merged root", () => {
    const body = "  INT. 房间 - NIGHT\r\n\r\n林晚核对号码。\r\n";
    const scene = {
      title: "原场景",
      content: "姐姐拒绝交易。",
      location: "码头",
      time: "夜",
      characters: ["姐姐"],
      custom: { 手稿标记: "不作分镜采用" },
    };
    const parsed = parseStructuredScriptIntake(
      "作者.json",
      JSON.stringify({
        title: "来源书名",
        unknown: "不转换",
        episodes: [
          {
            episodeNumber: 4,
            title: "追查",
            content: body,
            scenes: [scene],
            ignored: true,
          },
          {
            episodeNumber: 2,
            scenes: [scene, { title: "后场", content: "林晚拒绝交换线索。" }],
          },
        ],
      }),
    );
    expect(parsed.blocks).toEqual([]);
    expect(parsed.sourceTitle).toBe("来源书名");
    expect(parsed.lossReport.unsupported).toEqual([
      "document:unknown",
      "episodes[0]:ignored",
    ]);
    expect(parsed.episodes.map((episode) => episode.episodeNumber)).toEqual([
      4, 2,
    ]);
    expect(parsed.episodes[0]).toMatchObject({
      content: body,
      contentSource: "episode-content",
      scenes: [scene],
    });
    expect(parsed.episodes[1]).toMatchObject({
      content: "姐姐拒绝交易。\n\n林晚拒绝交换线索。",
      contentSource: "scene-content",
      title: "第 2 集",
    });
    expect(
      parsed.episodes.every((episode) =>
        episode.blocks.some((block) => block.type === "action"),
      ),
    ).toBe(true);
    const ids = parsed.episodes.flatMap((episode) => [
      episode.id,
      ...episode.blocks.map((block) => block.id),
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("never manufactures Action from scene labels or note-only content", () => {
    for (const content of [undefined, "[[仅备注，不是动作。]]"]) {
      const parsed = parseStructuredScriptIntake(
        "作者.json",
        JSON.stringify({
          episodes: [
            { episodeNumber: 1, scenes: [{ title: "只有场景标题", content }] },
          ],
        }),
      );
      expect(
        parsed.episodes[0]!.blocks.some(
          (block) => block.type === "action" || block.type === "dialogue",
        ),
      ).toBe(false);
      expect(parsed.episodes[0]!.scenes[0]!.title).toBe("只有场景标题");
    }
  });
  it("rejects invalid documents as a whole rather than truncating or dropping episodes/scenes", () => {
    for (const raw of [
      "{",
      "null",
      JSON.stringify({ chapters: [{ content: "小说" }] }),
      JSON.stringify({
        episodes: [
          { episodeNumber: 1, content: "动作" },
          { episodeNumber: 1, content: "重复集" },
        ],
      }),
      JSON.stringify({
        episodes: [{ episodeNumber: 1, content: "动作", scenes: [{}] }],
      }),
      JSON.stringify({
        episodes: [{ episodeNumber: 1, content: "动作" }, { episodeNumber: 2 }],
      }),
    ])
      expect(() => parseStructuredScriptIntake("作者.json", raw)).toThrow();
  });
});
