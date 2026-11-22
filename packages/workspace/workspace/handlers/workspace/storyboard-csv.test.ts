import { describe, expect, it } from "vitest";
import { storyboardCsv } from "./maintenance.js";

const scene = (id: string, title: string) => ({
  id,
  kind: "scenes",
  title,
  payload: {},
});
const shot = (
  id: string,
  parentId: string,
  payload: Record<string, unknown>,
) => ({
  id,
  kind: "shots",
  parentId,
  title: `镜头${id}`,
  payload,
});

describe("storyboardCsv", () => {
  it("lists shots by scene, numbered within each scene", () => {
    const csv = storyboardCsv([
      scene("s1", "书店"),
      scene("s2", "街道"),
      shot("b", "s2", { 镜头描述: "雨夜街道" }),
      shot("a", "s1", { 镜头描述: "推门", 运镜: "推", 时长: 3 }),
      shot("c", "s1", { 镜头描述: '她说："有人吗"' }),
    ]);
    expect(csv.startsWith("﻿场景,镜号,镜头,镜头描述")).toBe(true);
    const rows = csv.trim().split("\r\n");
    expect(rows[1]).toBe("书店,1,镜头a,推门,,,推,3,,,");
    expect(rows[2]).toBe('书店,2,镜头c,"她说：""有人吗""",,,,,,,');
    expect(rows[3]!.startsWith("街道,1,镜头b")).toBe(true);
  });

  it("keeps a spreadsheet from running a cell as a formula", () => {
    const csv = storyboardCsv([
      scene("s1", "场景"),
      shot("a", "s1", { 镜头描述: "=HYPERLINK(1)" }),
    ]);
    expect(csv).toContain("'=HYPERLINK(1)");
  });
});
