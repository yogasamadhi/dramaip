import { describe, expect, it } from "bun:test";
import {
  parseEpisodeSourceChoice,
  episodeSourceChoiceMatches,
  episodeSourceChoiceKey,
} from "./episode-source-choice";
const episodeId = crypto.randomUUID();
const sourceScript = {
  id: crypto.randomUUID(),
  version: 2,
  documentVersion: 0,
};
describe("unconfirmed original source selection", () => {
  it("restores exact identity/version without declaring adopted intent, confirmed basis or file consent", () => {
    const choice = { episodeId, sourceScript };
    expect(parseEpisodeSourceChoice(JSON.stringify(choice))).toEqual(choice);
    expect(episodeSourceChoiceKey("project-a")).not.toBe(
      episodeSourceChoiceKey("project-b"),
    );
    expect(
      parseEpisodeSourceChoice(JSON.stringify({ ...choice, confirmed: true })),
    ).toBeUndefined();
  });
  it("keeps explicit brief-only choices distinct from an absent initial selection", () => {
    expect(parseEpisodeSourceChoice(JSON.stringify({ episodeId }))).toEqual({
      episodeId,
    });
    expect(parseEpisodeSourceChoice(null)).toBeUndefined();
    expect(episodeSourceChoiceMatches({ episodeId }, { episodeId })).toBe(true);
    expect(
      episodeSourceChoiceMatches({ episodeId }, { episodeId, sourceScript }),
    ).toBe(false);
  });
  it("requires the same actual episode/record/document versions, including exact historical null", () => {
    const choice = { episodeId, sourceScript };
    expect(episodeSourceChoiceMatches(choice, choice)).toBe(true);
    for (const patch of [
      { id: crypto.randomUUID() },
      { version: 3 },
      { documentVersion: null },
      { documentVersion: 1 },
    ])
      expect(
        episodeSourceChoiceMatches(choice, {
          episodeId,
          sourceScript: { ...sourceScript, ...patch },
        }),
      ).toBe(false);
    expect(
      episodeSourceChoiceMatches(choice, {
        episodeId: crypto.randomUUID(),
        sourceScript,
      }),
    ).toBe(false);
    expect(
      episodeSourceChoiceMatches(
        { episodeId, sourceScript: { ...sourceScript, documentVersion: null } },
        { episodeId, sourceScript: { ...sourceScript, documentVersion: null } },
      ),
    ).toBe(true);
  });
  it("rejects malformed storage, invalid identities/versions, body, grants and checked consent", () => {
    for (const raw of [
      "{",
      "null",
      "{}",
      JSON.stringify({ episodeId: "wrong" }),
      JSON.stringify({
        episodeId,
        sourceScript: { ...sourceScript, version: -1 },
      }),
      JSON.stringify({
        episodeId,
        sourceScript: { ...sourceScript, grantId: crypto.randomUUID() },
      }),
      JSON.stringify({ episodeId, rightsDeclared: true }),
    ])
      expect(parseEpisodeSourceChoice(raw)).toBeUndefined();
  });
});
