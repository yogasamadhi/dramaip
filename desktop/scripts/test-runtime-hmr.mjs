import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
if (process.versions.node !== "24.18.0" || process.versions.bun)
  throw new Error("HMR integration requires Node 24.18.0");
const source = fileURLToPath(new URL("../build/runtime/", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "dramaip-detached-runtime-"));
const electron = process.argv.includes("--electron");
const electronDirectory = fileURLToPath(
  new URL("../apps/desktop/node_modules/electron/", import.meta.url),
);
const executable = electron
  ? join(
      electronDirectory,
      "dist",
      (await readFile(join(electronDirectory, "path.txt"), "utf8")).trim(),
    )
  : process.execPath;
let child;
try {
  await cp(source, directory, { recursive: true, verbatimSymlinks: true });
  const worker = join(directory, "integration-worker.mjs");
  await writeFile(
    worker,
    `
import { bootRuntime, loadProfile } from './packages/runtime/src/index.js';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runMigrationPlanInWorker } from './packages/database/src/migration-worker.js';
import { openDatabase } from './packages/database/src/index.js';
const migrationOptions = {
 runtimeKind: process.versions.electron ? 'electron-node' : 'node', executable: process.execPath,
 workerEntry: fileURLToPath(new URL('./packages/runtime/src/migration-worker-process.js', import.meta.url)),
 databasePath: fileURLToPath(new URL('./migration-timeout.db', import.meta.url)),
 backupDirectory: fileURLToPath(new URL('./backups/', import.meta.url)),
 dryRun: false,
};
await assert.rejects(runMigrationPlanInWorker({...migrationOptions, migrationTimeoutMs:50, totalTimeoutMs:2000, migrations:[{
 id:'worker-test.timeout', pluginId:'worker-test', version:'1.0.0', dependsOn:[],
 sql:'CREATE TABLE worker_timeout(value INTEGER); INSERT INTO worker_timeout(value) WITH RECURSIVE values_forever(value) AS (VALUES(1) UNION ALL SELECT value + 1 FROM values_forever) SELECT value FROM values_forever;',
}]}), /migration timed out/);
const recovery = await runMigrationPlanInWorker({...migrationOptions, migrations:[]});
assert.equal(recovery.integrity, 'ok');
const recoveryDatabase = openDatabase(migrationOptions.databasePath);
assert.equal(recoveryDatabase.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name = 'worker_timeout'").get(), undefined);
recoveryDatabase.close();

const send = message => process.parentPort ? process.parentPort.postMessage(message) : process.send(message);
for (const name of ['studio','server','safe','test','e2e']) {
 const check = await bootRuntime({databasePath:':memory:',profile:loadProfile(new URL('./profiles/'+name+'.json',import.meta.url)),runtimeKind:process.versions.electron?'electron-node':'node',mode:name==='server'?'server':'headless'});
 const expected = ['safe','test'].includes(name)?3:14;
 if(check.kernel.diagnostics().plugins.length!==expected || check.kernel.diagnostics().services.length===0)throw new Error('Incomplete '+name+' graph');
 await check.stop();
}
const runtime = await bootRuntime({databasePath: ':memory:' ,profile:loadProfile(new URL('./profiles/safe.json',import.meta.url)),runtimeKind:process.versions.electron?'electron-node':'node',accessToken:'integration-token',development:{onRestart: reason => send({type:'restart',reason:reason.message})}});
const serviceIds = new WeakMap(); let serviceId = 0;
const workspaceServiceId = () => { const value=runtime.kernel.context.get('workspace.projects.v1'); if(!serviceIds.has(value))serviceIds.set(value,++serviceId); return serviceIds.get(value); };
send({type:'ready'});
const handle = async message => {
 try {
  if(message.type==='stop') {await runtime.stop(); process.exit(0);}
  if(message.type==='inspect') {
   const response = await runtime.fetch(new Request('http://localhost/api/v2/system/host/credentials/status',{headers:{Authorization:'Bearer integration-token'}}));
   send({type:'state',id:message.id,workspaceServiceId:workspaceServiceId(),title:(await response.json()).title,revision:runtime.runtimeInfo.graphRevision,routes:runtime.kernel.diagnostics().routes,services:runtime.kernel.diagnostics().services,effects:runtime.kernel.diagnostics().effects.length});
  }
 } catch(error) {send({type:'error',error:error.stack});}
};
if (process.parentPort) process.parentPort.on('message',event=>void handle(event.data)); else process.on('message',handle);
`,
  );
  const launcher = join(directory, "electron-main.cjs");
  if (electron)
    await writeFile(
      launcher,
      `
const { app, utilityProcess } = require('electron');
const { join } = require('node:path');
app.whenReady().then(() => {
  const child = utilityProcess.fork(join(__dirname,'integration-worker.mjs'),[],{execArgv:['--expose-internals'],stdio:'pipe'});
  child.on('message',message=>process.send(message));
  process.on('message',message=>child.postMessage(message));
  child.stderr.on('data',chunk=>process.stderr.write(chunk));
  child.stdout.on('data',chunk=>process.stdout.write(chunk));
  child.on('exit',code=>app.exit(code));
});
`,
    );
  const messages = [];
  let stderr = "";
  function launch() {
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    child = fork(electron ? launcher : worker, [], {
      cwd: directory,
      execPath: executable,
      execArgv: electron ? [] : ["--expose-internals"],
      env: environment,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.stdout.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("message", (message) => messages.push(message));
  }
  launch();
  async function until(predicate, timeout = 20000) {
    const start = Date.now();
    for (;;) {
      const found = messages.find(predicate);
      if (found) return found;
      if (child.exitCode !== null) throw new Error(`Runtime exited: ${stderr}`);
      if (Date.now() - start > timeout)
        throw new Error(
          `HMR timeout: ${stderr}\n${JSON.stringify(messages.slice(-3))}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  let requestId = 0;
  async function state() {
    const id = ++requestId;
    child.send({ type: "inspect", id });
    return until((message) => message.type === "state" && message.id === id);
  }
  await until((message) => message.type === "ready");
  const before = await state();
  const modulePath = join(directory, "plugins/system/src/index.js");
  const original = await readFile(modulePath, "utf8");
  for (let i = 1; i <= 3; i++) {
    await writeFile(
      modulePath,
      original.replace("Desktop Host is unavailable", `Hot reload ${i}`),
    );
    const deadline = Date.now() + 10000;
    let current;
    do {
      await new Promise((resolve) => setTimeout(resolve, 100));
      current = await state();
    } while (current.title !== `Hot reload ${i}` && Date.now() < deadline);
    assert.equal(
      current.title,
      `Hot reload ${i}`,
      JSON.stringify(messages.slice(-3)),
    );
    assert.notEqual(current.revision, before.revision);
    assert.deepEqual(
      current.routes.slice().sort(),
      before.routes.slice().sort(),
    );
    assert.equal(current.services.length, before.services.length);
    assert.equal(current.effects, before.effects);
  }
  const foundationPath = join(directory, "plugins/foundation/src/index.js");
  const foundationSource = await readFile(foundationPath, "utf8");
  const beforeProvider = await state();
  await writeFile(
    foundationPath,
    foundationSource + "\nexport const hmrDependencyProbe = true;\n",
  );
  let afterProvider;
  const providerDeadline = Date.now() + 10000;
  do {
    await new Promise((resolve) => setTimeout(resolve, 100));
    afterProvider = await state();
  } while (
    afterProvider.workspaceServiceId === beforeProvider.workspaceServiceId &&
    Date.now() < providerDeadline
  );
  assert.notEqual(
    afterProvider.workspaceServiceId,
    beforeProvider.workspaceServiceId,
    "Provider reload must recreate the dependent Workspace service",
  );
  assert.deepEqual(afterProvider.routes, beforeProvider.routes);
  assert.equal(afterProvider.effects, beforeProvider.effects);
  // Repeated file events must not accumulate routes, consumers, timers or watchers.
  const repeatedSource = await readFile(modulePath, "utf8");
  for (let index = 0; index < 3; index++)
    await writeFile(modulePath, repeatedSource);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal((await state()).effects, before.effects);
  const profilePatch = join(directory, "profiles/safe/cordis.patch.yml");
  let previous = await state();
  for (const value of [1, 2]) {
    await writeFile(
      profilePatch,
      `- id: system\n  config: { reloadProbe: ${value} }\n`,
    );
    const deadline = Date.now() + 10000;
    let current;
    do {
      await new Promise((resolve) => setTimeout(resolve, 100));
      current = await state();
    } while (current.revision === previous.revision && Date.now() < deadline);
    assert.notEqual(
      current.revision,
      previous.revision,
      `Profile patches must publish a new graph: ${JSON.stringify(messages.slice(-3))}\n${stderr}`,
    );
    assert.equal(current.title, "Hot reload 3");
    assert.deepEqual(current.routes, previous.routes);
    previous = current;
  }
  const lastGoodPatch = await readFile(profilePatch, "utf8");
  await writeFile(profilePatch, "[");
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(
    (await state()).revision,
    previous.revision,
    "Invalid configuration must keep the successful graph",
  );
  await writeFile(profilePatch, "- id: system\n  config: { reloadProbe: 2 }\n");
  await new Promise((resolve) => setTimeout(resolve, 300));
  const lastGood = await state();
  await writeFile(modulePath, "this is invalid ESM !!!");
  await new Promise((resolve) => setTimeout(resolve, 400));
  const recovered = await state();
  assert.match(
    await readFile(modulePath, "utf8"),
    /Hot reload 3/,
    "Rejected code must not poison later snapshots",
  );
  assert.equal(recovered.title, lastGood.title);
  assert.equal(recovered.revision, lastGood.revision);
  assert.equal(
    messages.some((message) => message.type === "restart"),
    false,
    JSON.stringify(messages),
  );
  // Async activation failure must request a supervisor rebuild and retain last-good code.
  await writeFile(
    modulePath,
    original.replace(
      "apply: (ctx, config) => {",
      'apply: async (ctx, config) => { await Promise.resolve(); throw new Error("integration activation failure");',
    ),
  );
  await until((message) => message.type === "restart");
  assert.match(await readFile(modulePath, "utf8"), /Hot reload 3/);
  child.send({ type: "stop" });
  await new Promise((resolve) => child.once("exit", resolve));
  messages.length = 0;
  launch();
  await until((message) => message.type === "ready");
  assert.equal(
    (await state()).title,
    "Hot reload 3",
    "Supervisor must boot the last successful module in a fresh process",
  );
  const sharedContract = join(directory, "packages/contracts/src/writing.js");
  const stable = await state();
  await writeFile(
    sharedContract,
    (await readFile(sharedContract, "utf8")) +
      "\nexport const restartContractProbe = true;\n",
  );
  await until((message) => message.type === "restart");
  assert.equal(
    (await state()).revision,
    stable.revision,
    "Shared contract changes must request a full restart without publishing a partial graph",
  );
  child.send({ type: "stop" });
  await new Promise((resolve) => child.once("exit", resolve));
  console.log(
    `Detached ${electron ? "Electron utility process" : "Node"} Runtime: migration timeout recovery, module/config HMR, stable resources, import/config recovery and fresh-process async-failure recovery passed`,
  );
} finally {
  child?.kill("SIGKILL");
  await rm(directory, { recursive: true, force: true });
}
