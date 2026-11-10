import { expect, test } from "vitest";
import {
  ChapterTextSelection,
  EventEnvelope,
  ProjectInput,
  Task,
  TaskInput,
  TimelineEditCommand,
} from "./product-contracts";

test("project creation preserves title limits, modes and unknown-field stripping", () => {
  expect(
    ProjectInput.parse({ title: "雨夜", mode: "single_season", extra: true }),
  ).toEqual({ title: "雨夜", mode: "single_season" });
  expect(ProjectInput.safeParse({ title: "字".repeat(160) }).success).toBe(
    true,
  );
  for (const input of [
    {},
    { title: "" },
    { title: "字".repeat(161) },
    { title: "雨夜", mode: "unsupported" },
    { title: "雨夜", targetEpisodeCount: 1.5 },
  ]) {
    expect(ProjectInput.safeParse(input).success).toBe(false);
  }
});

test("optional keys may be absent but retain their value constraints when present", () => {
  const input = { kind: "generate_chapter", title: "续写" };
  expect(TaskInput.parse(input)).toEqual(input);
  expect(TaskInput.safeParse({ ...input, projectId: undefined }).success).toBe(
    false,
  );
  expect(TaskInput.safeParse({ ...input, projectId: null }).success).toBe(
    false,
  );
  // An opaque payload explicitly permits undefined as well as other values.
  expect(TaskInput.parse({ ...input, payload: undefined })).toEqual({
    ...input,
    payload: undefined,
  });
});

test("events require the payload key even though its value is opaque", () => {
  const event = { id: 1, type: "task.updated", occurredAt: "2026-11-05" };
  expect(EventEnvelope.safeParse(event).success).toBe(false);
  for (const payload of [undefined, null, { status: "running" }]) {
    expect(EventEnvelope.parse({ ...event, payload })).toEqual({
      ...event,
      payload,
    });
  }
});

test("text selections require content and safe integer positions", () => {
  expect(ChapterTextSelection.parse({ text: "雨", from: 0, to: 1 })).toEqual({
    text: "雨",
    from: 0,
    to: 1,
  });
  for (const input of [
    { text: "" },
    { text: "雨", from: 0.5 },
    { text: "雨", to: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    expect(ChapterTextSelection.safeParse(input).success).toBe(false);
  }
});

test("timeline commands validate their selected operation and frame counts", () => {
  const move = { type: "move", clipId: "clip-1", startFrame: 24 };
  expect(TimelineEditCommand.parse(move)).toEqual(move);
  expect(
    TimelineEditCommand.safeParse({ ...move, startFrame: 1.5 }).success,
  ).toBe(false);
  expect(TimelineEditCommand.safeParse({ ...move, type: "trim" }).success).toBe(
    false,
  );
  expect(
    TimelineEditCommand.safeParse({ ...move, type: "unknown" }).success,
  ).toBe(false);
});

test("transitional number fields retain their existing JavaScript number domain", () => {
  for (const progress of [0, 0.5, NaN, Infinity, -Infinity]) {
    expect(Object.is(Task.shape.progress.parse(progress), progress)).toBe(true);
  }
  expect(Task.shape.progress.safeParse("0.5").success).toBe(false);
});
