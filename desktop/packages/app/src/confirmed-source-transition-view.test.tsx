import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EpisodeConfirmedSourceTransitionSchema } from "@dramaip/contracts/production";
import { ConfirmedSourceTransitionView } from "./features/production/ConfirmedSourceTransitionView";

describe("body-free actual source confirmation observation", () => {
  test("missing historical proof never invents a confirmation or author approval", () => {
    expect(
      renderToStaticMarkup(<ConfirmedSourceTransitionView value={undefined} />),
    ).toBe("");
  });
  test("shows exact original and current formal identities without certifying semantic safety or automatic redo", () => {
    const ref = () => ({ id: crypto.randomUUID(), version: 1 });
    const value = EpisodeConfirmedSourceTransitionSchema.parse({
      format: "verified-formal-source-transition-v1",
      originalOutline: ref(),
      originalScript: ref(),
      currentOutline: ref(),
      currentScript: ref(),
      document: {
        id: crypto.randomUUID(),
        scriptId: crypto.randomUUID(),
        version: 3,
        contentHash: "a".repeat(64),
      },
      confirmationPreviews: [ref()],
      completeAuthorReviewRequired: true,
      semanticVerification: "unverified",
    });
    const html = renderToStaticMarkup(
      <ConfirmedSourceTransitionView value={value} />,
    );
    for (const identity of [
      value.originalOutline.id,
      value.originalScript.id,
      value.currentOutline.id,
      value.currentScript.id,
      value.document.id,
      value.document.scriptId,
      value.confirmationPreviews[0]!.id,
      value.document.contentHash,
    ])
      expect(html).toContain(identity);
    expect(html).toContain("不自动改为当前稿");
    expect(html).toContain("不等于语义安全");
    expect(html).toContain("未知范围继续拒绝");
    expect(html).not.toContain("PRIVATE");
    expect(
      EpisodeConfirmedSourceTransitionSchema.safeParse({
        ...value,
        completeAuthorReviewRequired: false,
      }).success,
    ).toBe(false);
    expect(
      EpisodeConfirmedSourceTransitionSchema.safeParse({
        ...value,
        confirmationPreviews: [],
      }).success,
    ).toBe(false);
  });
});
