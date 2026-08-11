import { expect, test } from "bun:test";
import { assertTransition, canTransition } from "./index";

test("task state machine only permits declared transitions", () => {
  expect(canTransition("queued", "running")).toBe(true);
  expect(canTransition("running", "succeeded")).toBe(true);
  expect(canTransition("succeeded", "running")).toBe(false);
  expect(() => assertTransition("failed", "succeeded")).toThrow(
    "Invalid task transition",
  );
});
