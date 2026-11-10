// Generate the Typert artifacts of the DSH-architecture packages: every
// explicit contributor's `lib/typert.host.*` and `lib/typert.remote-client.*`
// (packages whose manifest exports `./typert`). The pass reads workspace
// packages only from source and runs the generator's own checks; TypeScript
// diagnostics belong to scripts/typecheck-infra.mjs.
//
//   node --import tsx scripts/generate-typert.mjs
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeWorkspaceArtifacts } from "../packages/infra/typert-generator/src/artifact-files.ts";
import { WorkspaceTypertGenerator } from "../packages/infra/typert-generator/src/workspace.ts";

const desktop = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** The Host face alone emits Host reflection and the Client Remote projection. */
const FACES = ["host"];

const started = performance.now();
const artifacts = new WorkspaceTypertGenerator(desktop, {
  checkDiagnostics: false,
  rejectBuildOutputs: true,
}).generateContributors(FACES);
writeWorkspaceArtifacts(desktop, artifacts);
for (const artifact of artifacts) {
  console.log(
    `typert: ${artifact.package} (${artifact.face}${artifact.remote === undefined ? "" : " + remote"})`,
  );
}
console.log(
  `typert: ${artifacts.length} artifact(s) in ${Math.round(performance.now() - started)} ms`,
);
