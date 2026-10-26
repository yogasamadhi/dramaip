import { expect, test } from "vitest";
import { projectProgressReadiness } from "./project-progress-readiness";

test("requires every real owner read before deriving a next action", () => {
  for (const data of [undefined, null])
    expect(
      projectProgressReadiness([
        { data: { projectId: "actual" }, error: null },
        { data, error: null },
      ]),
    ).toEqual({ state: "loading" });
});

test("an actual read error wins over its old cache and other pending reads", () => {
  const failure = new Error("actual GET failed");
  expect(
    projectProgressReadiness([
      { data: undefined, error: null },
      { data: { adopted: true }, error: failure },
    ]),
  ).toEqual({ state: "failed", error: failure });
});

test("real empty records are valid but do not fabricate a failed read", () => {
  expect(
    projectProgressReadiness([
      { data: [], error: null },
      { data: { items: [] }, error: undefined },
    ]),
  ).toEqual({ state: "ready" });
});

test("only the caller's required reads decide readiness", () => {
  const irrelevant = {
    data: { items: [] },
    error: new Error("optional stage disabled"),
  };
  const required = { data: { current: null }, error: null };
  expect(projectProgressReadiness([required])).toEqual({ state: "ready" });
  expect(projectProgressReadiness([required, irrelevant])).toEqual({
    state: "failed",
    error: irrelevant.error,
  });
});
