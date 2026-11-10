import {
  NarrativeContextRequestSchema,
  type NarrativeContextRequest,
} from "@dramaip/contracts/creation";
import { ContinueChapterAgentRunStartSchema } from "@dramaip/contracts/writing";
import { sameFrozenOwnerSnapshot } from "./current-owner-read";

// The continue owner starts the actual new target. Carry the author's submitted
// selection, not a guessed default or text reconstructed from a model result.
// This draft is not an adoption, successful workflow GET or source certificate.
export function rememberContinuedChapterContext(
  storage: Pick<Storage, "getItem" | "setItem">,
  input: {
    projectId: string;
    sourceChapterId: string;
    result: unknown;
    request: NarrativeContextRequest;
  },
) {
  const result = ContinueChapterAgentRunStartSchema.parse(input.result);
  if (
    result.chapter.projectId !== input.projectId ||
    result.chapter.id === input.sourceChapterId ||
    result.run.chapterId !== result.chapter.id ||
    result.run.autoCommitWhenReady
  )
    throw new Error("续章实际回执的项目／新章／运行绑定不符，未替换原选择。");
  const request = NarrativeContextRequestSchema.parse(input.request);
  const key = `dramaip-novel-context:${input.projectId}:${result.chapter.id}`;
  const existing = storage.getItem(key);
  if (existing !== null) {
    const prior = NarrativeContextRequestSchema.parse(JSON.parse(existing));
    if (!sameFrozenOwnerSnapshot(prior, request))
      throw new Error("新章已有不同的本机来源选择，未覆盖或自动刷新它。");
  }
  const encoded = JSON.stringify(request);
  storage.setItem(key, encoded);
  if (storage.getItem(key) !== encoded)
    throw new Error("原续章来源选择未能保存，不能按空范围恢复该运行。");
  return result;
}
