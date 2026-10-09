import { createHash } from "node:crypto";
import {
  CreativeOutcomeFactSchema,
  CreativeOutcomeKindSchema,
  CreativeOutcomeRecordSchema,
  type CreativeOutcomeFact,
} from "@dramaip/contracts/insights";

/** Controlled owner-shaped receipts, never real participants, model quality or authorization. */
export function creativeDeliveryLedgerFixture(projectId: string) {
  const ids = Array.from({ length: 6 }, () => crypto.randomUUID()),
    records: ReturnType<typeof CreativeOutcomeRecordSchema.parse>[] = [];
  const add = (
    kind: CreativeOutcomeFact["kind"],
    formalVersions: CreativeOutcomeFact["formalVersions"],
  ) => {
    const saved = kind.endsWith("exported"),
      cursor = records.length + 1,
      occurredAt = `2026-10-07T00:00:${String(cursor).padStart(2, "0")}.000Z`,
      fact = CreativeOutcomeFactSchema.parse({
        eventVersion: 1,
        kind,
        projectId,
        workflowPath: kind.split(".")[0],
        objectId: saved ? crypto.randomUUID() : formalVersions[0]!.id,
        formalVersions,
        sourceVersions: [],
        evidenceKind: saved ? "rule" : "human",
        modelEvidence: "unknown",
        qualityState: "unverified",
        resultStatus: saved ? "saved" : "adopted",
        ...(saved
          ? {
              receipt: {
                artifactRef: crypto.randomUUID(),
                sha256: "a".repeat(64),
                byteSize: 3,
                savedAt: occurredAt,
              },
            }
          : {}),
      }),
      unitKey = createHash("sha256")
        .update(
          JSON.stringify([
            kind,
            formalVersions
              .map((v) => JSON.stringify([v.kind, v.id, v.version]))
              .sort(),
          ]),
        )
        .digest("hex");
    records.push(
      CreativeOutcomeRecordSchema.parse({
        ...fact,
        eventId: crypto.randomUUID(),
        cursor,
        occurredAt,
        unitKey,
      }),
    );
  };
  const a = { kind: "chapter" as const, id: ids[0]!, version: 1 },
    b = { ...a, id: ids[1]! },
    c = { ...a, id: ids[2]!, version: 0 },
    script = { kind: "episode-script" as const, id: ids[3]!, version: 1 },
    pilot = [
      script,
      { kind: "episode-outline" as const, id: ids[4]!, version: 1 },
      { kind: "storyboard" as const, id: ids[5]!, version: 1 },
      { kind: "script-document" as const, id: crypto.randomUUID(), version: 1 },
    ];
  add("novel.chapter-adopted", [a]);
  add("novel.chapter-adopted", [b]);
  add("novel.manuscript-exported", [a, b]);
  add("novel.manuscript-exported", [b, a]);
  add("novel.chapter-adopted", [{ ...a, version: 2 }]);
  add("novel.manuscript-exported", [c]);
  add("adaptation.script-adopted", [script]);
  add("adaptation.pilot-package-exported", pilot);
  add("adaptation.pilot-package-exported", pilot);
  records.reverse();
  return {
    projectId,
    records,
    projection: { state: "healthy" as const, checkpoint: 50 },
    counts: CreativeOutcomeKindSchema.options.map((kind) => ({
      kind,
      total: new Set(
        records.filter((r) => r.kind === kind).map((r) => r.unitKey),
      ).size,
      lastSevenDays: 0,
    })),
    pages: [{ projectId, items: records }],
  };
}
