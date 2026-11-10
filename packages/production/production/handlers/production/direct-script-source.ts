import {
  ScreenplayBlockSchema,
  ScreenplayDocumentSchema,
  ScreenplayLossReportSchema,
  type ScreenplayBlock,
} from "@dramaip/contracts/production";
import { exportFountain } from "./screenplay-codec.js";

export interface DirectScriptSourceDocument {
  version: number;
  blocks_json: string;
  source_format: string;
  loss_report_json: string;
}

/** Read saved content only: never initialize a document, reparse text or mint IDs. */
export function directScriptSourceContent(
  body: unknown,
  document?: DirectScriptSourceDocument,
) {
  let blocks: ScreenplayBlock[] | undefined;
  try {
    if (document) {
      const raw: unknown = JSON.parse(document.blocks_json);
      const parsed = ScreenplayBlockSchema.array().safeParse(raw);
      if (
        !parsed.success ||
        new Set(parsed.data.map((block) => block.id)).size !==
          parsed.data.length
      )
        return undefined;
      // Validation must not normalize the already-frozen legacy reference shape.
      blocks = raw as ScreenplayBlock[];
    }
    if (typeof body === "string" && body.trim())
      return { content: body, ...(blocks ? { blocks } : {}) };
    if (
      !document ||
      !blocks?.some(
        (block) =>
          (block.type === "action" || block.type === "dialogue") &&
          block.text.trim(),
      )
    )
      return undefined;
    const format = ScreenplayDocumentSchema.shape.sourceFormat.safeParse(
      document.source_format,
    );
    const loss = ScreenplayLossReportSchema.safeParse(
      JSON.parse(document.loss_report_json),
    );
    if (!format.success || !loss.success) return undefined;
    return {
      content: exportFountain(blocks),
      blocks,
      // This is a readable representation of the saved AST, not original bytes.
      contentRepresentation: "saved-screenplay-ast-fountain" as const,
      sourceFormat: format.data,
      lossReport: loss.data,
    };
  } catch {
    return undefined;
  }
}
