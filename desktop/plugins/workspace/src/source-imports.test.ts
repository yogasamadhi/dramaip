import { describe, expect, test } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  parseImportedDocument,
  sourceImportMigrations,
} from "./source-imports";

describe("source import document parsing", () => {
  test("turns normalized DOCX and EPUB markdown into chapters", () => {
    for (const format of ["docx", "epub"] as const) {
      const preview = parseImportedDocument({
        name: `story.${format}`,
        format,
        size: 100,
        content: "# 故事标题\n\n## 第一章\n正文一\n\n## 第二章\n正文二",
      });
      expect(preview.sourceType).toBe(format);
      expect(preview.contentKind).toBe("novel");
      expect(preview.chapters.map((chapter) => chapter.title)).toEqual([
        "第一章",
        "第二章",
      ]);
    }
  });

  test("normalizes structured script episodes and scene fallbacks", () => {
    const preview = parseImportedDocument({
      name: "script.json",
      format: "script-json",
      size: 200,
      content: JSON.stringify({
        title: "雨夜归来",
        episodes: [
          {
            episodeNumber: 1,
            scenes: [{ location: "门外", content: "主角敲门。" }],
          },
        ],
      }),
    });
    expect(preview.contentKind).toBe("script");
    expect(preview.episodes[0]).toMatchObject({
      episodeNumber: 1,
      title: "第 1 集",
      scenes: [{ title: "场景 1", content: "主角敲门。" }],
    });
  });

  test("rejects duplicate episode numbers and empty episodes", () => {
    expect(() =>
      parseImportedDocument({
        name: "duplicate.json",
        format: "script-json",
        size: 100,
        content: JSON.stringify({
          episodes: [
            { episodeNumber: 1, content: "A" },
            { episodeNumber: 1, content: "B" },
          ],
        }),
      }),
    ).toThrow(/重复/u);
    expect(() =>
      parseImportedDocument({
        name: "empty.json",
        format: "script-json",
        size: 100,
        content: JSON.stringify({
          episodes: [{ episodeNumber: 1, scenes: [] }],
        }),
      }),
    ).toThrow(/正文/u);
  });

  test("forward migration preserves bound previews and permits projectless previews", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("CREATE TABLE projects(id TEXT PRIMARY KEY)");
      database.exec(sourceImportMigrations[0].sql);
      database.prepare("INSERT INTO projects(id) VALUES (?)").run("project-1");
      database
        .prepare(
          "INSERT INTO workspace_source_imports VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          "import-1",
          "project-1",
          "story.txt",
          "{}",
          "2026-08-28T00:00:00.000Z",
          "2026-08-27T00:00:00.000Z",
        );

      database.exec(sourceImportMigrations[1].sql);
      expect(
        Object.assign(
          {},
          database
            .prepare(
              "SELECT project_id FROM workspace_source_imports WHERE id = ?",
            )
            .get("import-1"),
        ),
      ).toEqual({ project_id: "project-1" });
      database
        .prepare(
          "INSERT INTO workspace_source_imports VALUES (?, NULL, ?, ?, ?, ?)",
        )
        .run(
          "import-2",
          "new.txt",
          "{}",
          "2026-08-28T00:00:00.000Z",
          "2026-08-27T00:00:00.000Z",
        );
      expect(
        Object.assign(
          {},
          database
            .prepare(
              "SELECT project_id FROM workspace_source_imports WHERE id = ?",
            )
            .get("import-2"),
        ),
      ).toEqual({ project_id: null });
    } finally {
      database.close();
    }
  });
});
