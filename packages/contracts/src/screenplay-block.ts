import { z } from "zod";

const location = z.object({
  line: z.number().int().positive(),
  column: z.number().int().positive().default(1),
});
const base = z.object({
  id: z.string().uuid(),
  sourceLocation: location.optional(),
});
export const ScreenplayBlockSchema = z.discriminatedUnion("type", [
  base.extend({
    type: z.literal("scene_heading"),
    text: z.string(),
    sceneNumber: z.string().optional(),
  }),
  base.extend({ type: z.literal("action"), text: z.string() }),
  base.extend({ type: z.literal("character"), text: z.string() }),
  base.extend({ type: z.literal("dialogue"), text: z.string() }),
  base.extend({ type: z.literal("parenthetical"), text: z.string() }),
  base.extend({ type: z.literal("transition"), text: z.string() }),
  base.extend({ type: z.literal("note"), text: z.string() }),
  base.extend({ type: z.literal("page_break") }),
]);
export type ScreenplayBlock = z.infer<typeof ScreenplayBlockSchema>;

/** Saved-source reads are exact: no default column and no undeclared metadata. */
const savedBase = z
  .object({
    id: z.string().uuid(),
    sourceLocation: z
      .object({
        line: z.number().int().positive(),
        column: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const SavedScreenplayBlockSchema = z.discriminatedUnion("type", [
  savedBase.extend({
    type: z.literal("scene_heading"),
    text: z.string(),
    sceneNumber: z.string().optional(),
  }),
  savedBase.extend({ type: z.literal("action"), text: z.string() }),
  savedBase.extend({ type: z.literal("character"), text: z.string() }),
  savedBase.extend({ type: z.literal("dialogue"), text: z.string() }),
  savedBase.extend({ type: z.literal("parenthetical"), text: z.string() }),
  savedBase.extend({ type: z.literal("transition"), text: z.string() }),
  savedBase.extend({ type: z.literal("note"), text: z.string() }),
  savedBase.extend({ type: z.literal("page_break") }),
]);
