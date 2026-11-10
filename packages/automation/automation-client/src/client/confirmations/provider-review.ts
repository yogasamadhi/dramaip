import { value } from "../creation/remote.ts";
import {
  fields,
  MismatchError,
  type ConfirmationRemotes,
  type ProviderActionPreview,
  type Task,
  type Translate,
} from "./remote.ts";

/**
 * The status of a provider call preview, in the author's words.
 * @param t - the confirmation copy.
 * @param status - the preview's status.
 */
export function providerStatusText(
  t: Translate,
  status: ProviderActionPreview["status"],
): string {
  return t(`provider.state.${status}`);
}

/**
 * The recorded estimate of a provider call, known only with a finite,
 * non-negative amount and a currency.
 * @param preview - the preview's estimate.
 * @param t - the confirmation copy.
 */
export function providerEstimate(
  preview: Pick<ProviderActionPreview, "estimatedCost" | "currency">,
  t: Translate,
): { known: boolean; label: string } {
  const amount = preview.estimatedCost;
  const currency = preview.currency?.trim();
  return typeof amount === "number" &&
    Number.isFinite(amount) &&
    amount >= 0 &&
    currency
    ? { known: true, label: `${amount.toFixed(4)} ${currency}` }
    : { known: false, label: t("provider.estimate.unknown") };
}

/**
 * A memory-only identity of a preview, never persisted as navigation,
 * consent or a quote.
 * @param preview - the preview as read.
 */
export function providerIdentity(preview: ProviderActionPreview): string {
  const ordered = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(ordered)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([key, child]) => [key, ordered(child)]),
          )
        : item;
  return JSON.stringify(ordered(preview));
}

type ProviderRemotes = Pick<ConfirmationRemotes, "automation" | "workspace">;

/**
 * Read a provider call preview through the task whose result binds it.
 * Executing rewrites the preview's `taskId` to the accepted provider task;
 * the original task's result pointer still binds this preview, so the two
 * task identities are never made equal.
 * @param remotes - the `automation` namespace.
 * @param binding - the preview, its project and the task naming it.
 */
export async function readTaskProviderReview(
  remotes: Pick<ConfirmationRemotes, "automation">,
  binding: { id: string; projectId: string; task: Task },
): Promise<ProviderActionPreview> {
  const preview = await value<ProviderActionPreview>(
    remotes.automation.providerActionPreviewsGet(binding.id),
  );
  if (
    preview.id !== binding.id ||
    preview.projectId !== binding.projectId ||
    binding.task.projectId !== binding.projectId ||
    (preview.status !== "executed" &&
      preview.taskId &&
      preview.taskId !== binding.task.id)
  )
    throw new MismatchError("mismatch.providerOwner");
  const result = fields(binding.task.result);
  const embeddedId = fields(result.providerActionPreview).id;
  if (
    (result.providerActionPreviewId !== undefined &&
      result.providerActionPreviewId !== binding.id) ||
    (embeddedId !== undefined && embeddedId !== binding.id) ||
    (result.providerActionPreviewId !== binding.id && embeddedId !== binding.id)
  )
    throw new MismatchError("mismatch.providerUnbound");
  return preview;
}

/**
 * Read a standalone provider call preview, its project read and matched
 * every time.
 * @param remotes - the `automation` and `workspace` namespaces.
 * @param binding - the preview and its project.
 */
export async function readProjectProviderReview(
  remotes: ProviderRemotes,
  binding: { id: string; projectId: string },
): Promise<ProviderActionPreview> {
  const [project, preview] = await Promise.all([
    value<{ id: string }>(remotes.workspace.projectsGet(binding.projectId)),
    value<ProviderActionPreview>(
      remotes.automation.providerActionPreviewsGet(binding.id),
    ),
  ]);
  if (
    project.id !== binding.projectId ||
    preview.id !== binding.id ||
    preview.projectId !== binding.projectId
  )
    throw new MismatchError("mismatch.providerProject");
  return preview;
}

/**
 * Refuse a confirmation when the preview read again is no longer the one
 * reviewed, no longer pending, or its estimate is unknown.
 * @param current - the preview read just now.
 * @param reviewed - the preview the author reviewed.
 * @param t - the confirmation copy.
 */
export function requireUnchangedProviderReview(
  current: ProviderActionPreview,
  reviewed: ProviderActionPreview,
  t: Translate,
): void {
  if (
    current.status !== "pending" ||
    !providerEstimate(current, t).known ||
    providerIdentity(current) !== providerIdentity(reviewed)
  )
    throw new MismatchError("mismatch.providerChanged");
}
