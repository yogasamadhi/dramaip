export type CodexConnectionProtocol = "responses" | "chat_completions";

export function recommendedCodexConnectionProtocol(
  providerPreset: unknown,
): CodexConnectionProtocol {
  const preset = String(providerPreset ?? "")
    .trim()
    .toLowerCase();
  return preset && preset !== "openai" && preset !== "other"
    ? "chat_completions"
    : "responses";
}
