import {
  NarrativeContextRequestSchema,
  NarrativeSourceBasisSchema,
  narrativeSourceIdentity,
  narrativeSourceSelection,
  type NarrativeContextRequest,
  type NarrativeSourceBasis,
} from "@dramaip/contracts/creation";

type Ref = { id: string; version: number };
/** Read-only comparison of the original provided expressions. The complete
 * original parent membership remains verified, but omitted chapters are not
 * reread as if they had been inputs to this episode. Shared formal constraints
 * are checked separately by the caller, including their stale/read failures.
 * Never use this observer for generation, adoption or source reconfirmation. */
export function observeFrozenEpisodeNarrativeSources(
  projectId: string,
  originalParentScope: readonly Ref[],
  rawBasis: NarrativeSourceBasis,
  rawRequest: NarrativeContextRequest,
  compile: (
    scope: readonly Ref[],
    request: NarrativeContextRequest,
  ) => {
    basis: NarrativeSourceBasis;
  },
) {
  const frozen = NarrativeSourceBasisSchema.parse(rawBasis);
  const request = NarrativeContextRequestSchema.parse(rawRequest);
  const selection = narrativeSourceSelection(frozen);
  const identity = (value: NarrativeContextRequest) =>
    JSON.stringify({
      chapters: value.chapters,
      summaries: value.summaries ?? [],
      story: value.story ?? [],
    });
  if (
    frozen.projectId !== projectId ||
    identity(selection) !== identity(request)
  )
    throw Error("Original episode selection or project differs");
  const parents = new Map(
    originalParentScope.map((ref) => [ref.id, ref.version]),
  );
  if (!parents.size || parents.size !== originalParentScope.length)
    throw Error("Original parent membership is incomplete or repeated");
  const expression = new Map<string, number>();
  const used = new Map<string, number>();
  const add = (map: Map<string, number>, ref: Ref) => {
    if (
      parents.get(ref.id) !== ref.version ||
      (map.has(ref.id) && map.get(ref.id) !== ref.version)
    )
      throw Error("Original dependency does not belong to the frozen parent");
    map.set(ref.id, ref.version);
  };
  for (const ref of frozen.chapters) {
    add(expression, ref);
    add(used, ref);
  }
  for (const summary of frozen.summaries ?? [])
    for (const ref of summary.chapters) {
      add(expression, ref);
      add(used, ref);
    }
  for (const source of frozen.story ?? []) {
    if (source.sourceScripts.length)
      throw Error("Novel episode observer does not invent a script scope");
    for (const ref of source.sourceChapters) add(used, ref);
  }
  const omitted = new Set<string>();
  for (const ref of frozen.omitted) {
    if (
      parents.get(ref.id) !== ref.version ||
      omitted.has(ref.id) ||
      expression.has(ref.id)
    )
      throw Error("Original omitted membership differs");
    omitted.add(ref.id);
  }
  if (
    expression.size + omitted.size !== parents.size ||
    [...parents.keys()].some((id) => !expression.has(id) && !omitted.has(id))
  )
    throw Error("Original complete allowed membership was not recorded");
  const scope = originalParentScope.filter((ref) => used.has(ref.id));
  const observed = NarrativeSourceBasisSchema.parse(
    scope.length
      ? compile(scope, request).basis
      : {
          kind: "author-selected-narrative-sources",
          projectId,
          chapters: [],
          omitted: [],
          references: [],
        },
  );
  if (observed.projectId !== projectId)
    throw Error("Observed owner returned another project");
  // Only for identity comparison: retain the original omission receipt. This
  // is not a current-directory projection, changed history or an exported basis.
  const matches =
    narrativeSourceIdentity({ ...observed, omitted: frozen.omitted }) ===
    narrativeSourceIdentity(frozen);
  const covered = new Set([
    ...observed.chapters.map((ref) => ref.id),
    ...(observed.summaries ?? []).flatMap((summary) =>
      summary.chapters.map((ref) => ref.id),
    ),
  ]);
  return { matches, covered };
}
