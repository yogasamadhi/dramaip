import { describe, expect, it } from "bun:test";
import { EpisodeDevelopmentRequestSchema } from "@dramaip/contracts/production";
import { seasonNarrativeRequestMatches } from "./episode-narrative-inheritance";

const plan = { id: crypto.randomUUID(), version: 2 };
const request = { seasonPlan: plan, episodeId: "actual-episode" };
describe("explicit complete season narrative inheritance", () => {
  it("preserves original historical scopes but does not silently upgrade them to mixed input", () => {
    expect(seasonNarrativeRequestMatches(plan, false, request)).toBe(true);
    expect(seasonNarrativeRequestMatches(plan, true, request)).toBe(false);
    expect(
      seasonNarrativeRequestMatches(plan, true, {
        ...request,
        inheritSeasonNarrative: true,
      }),
    ).toBe(true);
    expect(
      seasonNarrativeRequestMatches(plan, false, {
        ...request,
        inheritSeasonNarrative: true,
      }),
    ).toBe(false);
  });
  it("requires the same adopted plan identity and version, not merely an unchanged episode key", () => {
    for (const current of [
      undefined,
      { ...plan, id: crypto.randomUUID() },
      { ...plan, version: 3 },
    ])
      expect(
        seasonNarrativeRequestMatches(current, true, {
          ...request,
          inheritSeasonNarrative: true,
        }),
      ).toBe(false);
  });
  it("accepts only explicit true and rejects made-up scope/representation and direct-source mixing", () => {
    expect(
      EpisodeDevelopmentRequestSchema.safeParse({
        ...request,
        inheritSeasonNarrative: true,
      }).success,
    ).toBe(true);
    for (const value of [false, "true", "episode-only", {}])
      expect(
        EpisodeDevelopmentRequestSchema.safeParse({
          ...request,
          inheritSeasonNarrative: value,
        }).success,
      ).toBe(false);
    const direct = {
      entryPath: "inspiration",
      project: { id: crypto.randomUUID(), version: 0 },
      authorIntent: { id: crypto.randomUUID(), version: 1 },
      episode: { id: crypto.randomUUID(), version: 0 },
      durationSeconds: 90,
    };
    expect(
      EpisodeDevelopmentRequestSchema.safeParse({
        episodeId: direct.episode.id,
        direct,
      }).success,
    ).toBe(true);
    expect(
      EpisodeDevelopmentRequestSchema.safeParse({
        episodeId: direct.episode.id,
        direct,
        inheritSeasonNarrative: true,
      }).success,
    ).toBe(false);
  });
  it("separates an explicit independent episode selection from inheritance without changing the adopted plan", () => {
    const context = {
      format: "narrative-context-v1" as const,
      chapters: [
        {
          id: crypto.randomUUID(),
          version: 0,
          representation: "original" as const,
        },
      ],
      summaries: [],
    };
    const selected = { ...request, episodeNarrativeContext: context };
    expect(EpisodeDevelopmentRequestSchema.safeParse(selected).success).toBe(
      true,
    );
    expect(seasonNarrativeRequestMatches(plan, true, selected)).toBe(true);
    expect(seasonNarrativeRequestMatches(plan, false, selected)).toBe(true);
    expect(
      seasonNarrativeRequestMatches(
        { ...plan, version: plan.version + 1 },
        true,
        selected,
      ),
    ).toBe(false);
    for (const changed of [
      { ...selected, inheritSeasonNarrative: true },
      { ...selected, episodeNarrativeContext: { ...context, chapters: [] } },
      {
        ...selected,
        episodeNarrativeContext: {
          ...context,
          chapters: [context.chapters[0], context.chapters[0]],
        },
      },
      {
        ...selected,
        episodeNarrativeContext: {
          ...context,
          chapters: [
            { ...context.chapters[0], text: "client body cannot be a source" },
          ],
        },
      },
    ])
      expect(EpisodeDevelopmentRequestSchema.safeParse(changed).success).toBe(
        false,
      );
    const direct = {
      entryPath: "inspiration",
      project: { id: crypto.randomUUID(), version: 0 },
      authorIntent: { id: crypto.randomUUID(), version: 1 },
      episode: { id: crypto.randomUUID(), version: 0 },
      durationSeconds: 90,
    };
    expect(
      EpisodeDevelopmentRequestSchema.safeParse({
        direct,
        episodeId: direct.episode.id,
        episodeNarrativeContext: context,
      }).success,
    ).toBe(false);
  });
});
