import { z } from "zod";

export const EpisodeSourceChoiceSchema = z
  .object({
    episodeId: z.string().uuid(),
    sourceScript: z
      .object({
        id: z.string().uuid(),
        version: z.number().int().nonnegative(),
        documentVersion: z.number().int().nonnegative().nullable(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type EpisodeSourceChoice = z.infer<typeof EpisodeSourceChoiceSchema>;
export const episodeSourceChoiceKey = (projectId: string) =>
  `dramaip-episode-source-choice:${projectId}`;
export function parseEpisodeSourceChoice(
  raw: string | null,
): EpisodeSourceChoice | undefined {
  try {
    return raw ? EpisodeSourceChoiceSchema.parse(JSON.parse(raw)) : undefined;
  } catch {
    return undefined;
  }
}
export function episodeSourceChoiceMatches(
  choice: EpisodeSourceChoice,
  actual: {
    episodeId: string;
    sourceScript?: {
      id: string;
      version: number;
      documentVersion: number | null;
    };
  },
) {
  return (
    choice.episodeId === actual.episodeId &&
    ((!choice.sourceScript && !actual.sourceScript) ||
      (choice.sourceScript?.id === actual.sourceScript?.id &&
        choice.sourceScript?.version === actual.sourceScript?.version &&
        choice.sourceScript?.documentVersion ===
          actual.sourceScript?.documentVersion))
  );
}
