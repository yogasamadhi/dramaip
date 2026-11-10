import {
  StorySourceWithdrawInputSchema,
  StorySourceReplaceInputSchema,
  type StorySourceLifecycle,
  type StorySourceWithdrawInput,
  type StorySourceReplaceInput,
  type StoryDeclaration,
  type StoryAssertion,
} from "@dramaip/contracts/knowledge";

type LifecycleMetadata = Omit<StorySourceLifecycle, "transitions"> & {
  transitions?: StorySourceLifecycle["transitions"];
};
export function validSourceLifecycle(
  status: string,
  id: string,
  binding: StorySourceLifecycle["record"] | undefined,
  lifecycle: LifecycleMetadata | undefined,
): boolean {
  if (!lifecycle) return true; // Historical responses from older runtimes remain readable.
  if (
    status !== "adopted" ||
    !binding ||
    lifecycle.record.id !== binding.id ||
    lifecycle.record.kind !== binding.kind
  )
    return false;
  const active = lifecycle.state === "active";
  if (
    active
      ? lifecycle.version !== 0 ||
        lifecycle.record.version !== binding.version ||
        lifecycle.replacementId !== undefined
      : lifecycle.version < 1 ||
        lifecycle.record.version !== binding.version + 1
  )
    return false;
  if (
    lifecycle.state === "withdrawn" &&
    (lifecycle.version !== 1 || lifecycle.replacementId !== undefined)
  )
    return false;
  if (
    lifecycle.state === "replaced" &&
    (!lifecycle.replacementId || lifecycle.replacementId === id)
  )
    return false;
  const history = lifecycle.transitions;
  if (
    history &&
    (history.length !== lifecycle.version ||
      history.some(
        (item, index) =>
          item.version !== index + 1 ||
          (index < history.length - 1 && item.action === "replace") ||
          (item.action === "withdraw"
            ? item.version !== 1 || item.replacementId !== undefined
            : !item.replacementId || item.replacementId === id),
      ) ||
      (history.length > 0 &&
        (history.at(-1)!.action !==
          (lifecycle.state === "replaced" ? "replace" : "withdraw") ||
          history.at(-1)!.replacementId !== lifecycle.replacementId)))
  )
    return false;
  return true;
}
export function createSourceLifecycleActions<
  T extends StoryDeclaration | StoryAssertion,
>(
  request: <R>(path: string, init?: RequestInit) => Promise<R>,
  path: (projectId: string) => string,
  read: (raw: unknown, projectId: string, id?: string) => T,
  write: (body: unknown, key: string, etag?: string) => RequestInit,
) {
  const act = async (
    projectId: string,
    original: T,
    action: "withdraw" | "replace",
    input: StorySourceWithdrawInput | StorySourceReplaceInput,
    key: string,
    replacement?: T,
  ) => {
    const candidate = read(original, projectId, original.id);
    const parsed =
      action === "replace"
        ? StorySourceReplaceInputSchema.parse(input)
        : StorySourceWithdrawInputSchema.parse(input);
    if (
      candidate.status !== "adopted" ||
      !candidate.lifecycle ||
      candidate.lifecycle.state === "replaced" ||
      (action === "withdraw" && candidate.lifecycle.state !== "active") ||
      candidate.lifecycle.version !== parsed.lifecycleVersion ||
      JSON.stringify(candidate.lifecycle.record) !==
        JSON.stringify(parsed.record)
    )
      throw new Error(
        "须核对原已采用声明的当前生命周期及实际记录，不重新激活旧内容。",
      );
    if (action === "replace") {
      const next = replacement
        ? read(replacement, projectId, replacement.id)
        : undefined;
      const confirmed = StorySourceReplaceInputSchema.parse(parsed).replacement;
      if (
        !next ||
        next.id === candidate.id ||
        next.status !== "pending" ||
        next.sourceStatus.state !== "current" ||
        next.input.kind !== candidate.input.kind ||
        next.id !== confirmed.id ||
        next.etag !== confirmed.etag ||
        next.basis.fingerprint !== confirmed.sourceFingerprint
      )
        throw new Error(
          "必须单独审阅本项目同类的新候选及其完整冻结来源，不自动换源。",
        );
    }
    const result = read(
      await request(
        `${path(projectId)}/${encodeURIComponent(candidate.id)}/${action}`,
        write(parsed, key, candidate.etag),
      ),
      projectId,
      candidate.id,
    );
    const receipt = result.lifecycle?.transitions.find(
      (item) => item.version === parsed.lifecycleVersion + 1,
    );
    if (
      result.status !== "adopted" ||
      result.version !== candidate.version ||
      result.basis.fingerprint !== candidate.basis.fingerprint ||
      JSON.stringify(result.input) !== JSON.stringify(candidate.input) ||
      !receipt ||
      receipt.action !== action ||
      receipt.reason !== parsed.reason ||
      (action === "replace" &&
        receipt.replacementId !==
          StorySourceReplaceInputSchema.parse(parsed).replacement.id)
    )
      throw new Error(
        "生命周期回执未保留原采用记录或本次明确决定；请重查原 ID。",
      );
    return result;
  };
  return {
    withdraw: (
      projectId: string,
      original: T,
      input: StorySourceWithdrawInput,
      key: string,
    ) => act(projectId, original, "withdraw", input, key),
    replace: (
      projectId: string,
      original: T,
      replacement: T,
      input: StorySourceReplaceInput,
      key: string,
    ) => act(projectId, original, "replace", input, key, replacement),
  };
}
