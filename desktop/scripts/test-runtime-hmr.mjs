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
  await cp(source, directory, {
    recursive: true,
    verbatimSymlinks: true,
    // Shared development runtimes atomically replace their recovery journal.
    // A detached test starts its own journal; these are not build inputs.
    filter: (path) =>
      path !== join(source, ".last-good.json") &&
      path !== join(source, ".last-good.json.tmp"),
  });
  // An explicit source Profile is outside the recovery profile directory, as
  // in the actual Desktop launcher; code/patches still belong to the artifact.
  await cp(join(directory, "profiles"), join(directory, "profile-source"), {
    recursive: true,
  });
  const worker = join(directory, "integration-worker.mjs");
  await writeFile(
    worker,
    `
import { bootRuntime, loadProfile } from './packages/runtime/src/index.js';
import { RuntimeDevelopment } from './packages/runtime/src/development.js';
import { createHash } from 'node:crypto';
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
// Test-only scheduling instrumentation: hold a successful module batch before
// its artifact snapshot while the real native config callback queues behind it.
// Neither Kernel nor Runtime receives a production diagnostic/test hook.
let snapshotProbe = false, probeHolding = false, recordProbe = false, releaseProbe;
const coordinatedRun = RuntimeDevelopment.prototype.run;
// Test-only control of an earlier real parser rejection waiting on the actual
// coordinator. Production receives no timing hook and the original native
// watcher, profiles, route/effect and import recovery assertions remain.
let configRejectionArmed = false, configRejectionHolding = false, releaseConfigRejection;
const originalConfigRejection = RuntimeDevelopment.prototype.rejectConfig;
RuntimeDevelopment.prototype.rejectConfig = function(error) {
 if (!configRejectionArmed) return originalConfigRejection.call(this,error);
 configRejectionArmed = false;
 configRejectionHolding = true;
 const gate = new Promise(resolve => { releaseConfigRejection = resolve; });
 this.queue = this.queue.then(() => gate);
 const rejected = originalConfigRejection.call(this,error);
 send({type:'config-rejection-queued',reason:error.message});
 return rejected.finally(() => {configRejectionHolding=false;send({type:'config-rejection-finished'});});
};

const wrappedPublication = new WeakSet();
RuntimeDevelopment.prototype.run = function(task,configuration,unchanged) {
 if(configRejectionHolding)send({type:'later-config-queued'});
 if (!wrappedPublication.has(this)) {
  wrappedPublication.add(this);
  const publish = this.options.publish;
  this.options.publish = revision => {
   publish(revision);
   if (!recordProbe) return;
   const system = [...this.options.kernel().context.loader.entries()].find(entry => entry.options.id === 'system');
   if (!system) throw new Error('Actual native System entry is required');
   send({type:'probe-publication', revision, activeConfig:createHash('sha256').update(JSON.stringify(system.options.config)).digest('hex')});
  };
 }
 if (probeHolding) send({type:'probe-config-queued'});
 return coordinatedRun.call(this, async () => {
  const changed = await task();
  if (changed && snapshotProbe) {
   snapshotProbe = false;
   probeHolding = true;
   await new Promise(resolve => { releaseProbe = resolve; send({type:'snapshot-boundary'}); });
   probeHolding = false;
  }
  return changed;
 },configuration,unchanged);
};
for (const name of ['studio','server','safe','test','e2e']) {
 const check = await bootRuntime({databasePath:':memory:',profile:loadProfile(new URL('./profile-source/'+name+'.json',import.meta.url)),runtimeKind:process.versions.electron?'electron-node':'node',mode:name==='server'?'server':'headless'});
 const expected = ['safe','test'].includes(name)?3:14;
 if(check.kernel.diagnostics().plugins.length!==expected || check.kernel.diagnostics().services.length===0)throw new Error('Incomplete '+name+' graph');
 await check.stop();
}
const runtime = await bootRuntime({databasePath: ':memory:' ,profile:loadProfile(new URL('./profile-source/safe.json',import.meta.url)),runtimeKind:process.versions.electron?'electron-node':'node',accessToken:'integration-token',development:{onRestart: reason => send({type:'restart',reason:reason.message})}});
const serviceIds = new WeakMap(); let serviceId = 0;
const workspaceServiceId = () => { const value=runtime.kernel.context.get('workspace.projects.v1'); if(!serviceIds.has(value))serviceIds.set(value,++serviceId); return serviceIds.get(value); };
send({type:'ready'});
const handle = async message => {
 try {
  if(message.type==='arm-snapshot-probe') { snapshotProbe = true; recordProbe = true; send({type:'probe-armed'}); }
  if(message.type==='release-snapshot-probe') releaseProbe();
  if(message.type==='finish-snapshot-probe') recordProbe = false;
  if(message.type==='arm-config-rejection') {configRejectionArmed=true;send({type:'config-rejection-armed'});}
  if(message.type==='release-config-rejection') releaseConfigRejection();
  if(message.type==='stop') {await runtime.stop(); process.exit(0);}
  if(message.type==='inspect') {
   const response = await runtime.fetch(new Request('http://localhost/api/v2/system/host/credentials/status',{headers:{Authorization:'Bearer integration-token'}}));
   const diagnosticsResponse = await runtime.fetch(new Request('http://localhost/api/v2/system/diagnostics',{headers:{Authorization:'Bearer integration-token'}}));
   const diagnostics = await diagnosticsResponse.json();
   send({type:'state',id:message.id,httpStatus:response.status,workspaceServiceId:workspaceServiceId(),title:(await response.json()).title,configProbe:[...runtime.kernel.context.loader.entries()].find(entry=>entry.options.id==='system')?.options.config?.reloadProbe,revision:runtime.runtimeInfo.graphRevision,routes:runtime.kernel.diagnostics().routes,services:runtime.kernel.diagnostics().services,effects:runtime.kernel.diagnostics().effects.length,hmr:diagnostics.hmr,router:diagnostics.router,pendingFibers:[...runtime.kernel.context.registry.values()].flatMap(entry=>[...entry.fibers].filter(fiber=>fiber.inertia).map(fiber=>({name:entry.name,state:fiber.state}))) });
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
if (process.platform === 'darwin') app.setActivationPolicy('prohibited');
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
  async function readyState(title, revision, expectedStatus) {
    const deadline = Date.now() + 10000;
    let current;
    do {
      await new Promise((resolve) => setTimeout(resolve, 100));
      current = await state();
    } while (
      (current.httpStatus !== expectedStatus ||
        current.router?.reloading !== false ||
        current.title !== title ||
        current.revision !== revision) &&
      Date.now() < deadline
    );
    assert.equal(
      current.httpStatus,
      expectedStatus,
      `Recovery must finish, not expose a reloading response as success: ${JSON.stringify(current)}\n${stderr}`,
    );
    assert.equal(current.router?.reloading, false);
    assert.equal(current.title, title);
    assert.equal(
      current.revision,
      revision,
      "Recovery must retain the exact last successful graph",
    );
    return current;
  }
  await until((message) => message.type === "ready");
  const initialJournal = JSON.parse(
    await readFile(join(directory, ".last-good.json"), "utf8"),
  );
  assert.equal(
    Buffer.from(
      initialJournal.files.find(([path]) => path === "profiles/safe.json")[1],
      "base64",
    ).toString("utf8"),
    await readFile(join(directory, "profile-source/safe.json"), "utf8"),
    "Original parsed source Profile bytes must bind the exact logical recovery Profile",
  );
  assert.equal(
    initialJournal.files.some(
      ([path]) => path.startsWith("profile-source/") || path.startsWith("../"),
    ),
    false,
    "No external/source Profile paths enter the recovery journal",
  );
  child.send({ type: "arm-snapshot-probe" });
  await until((message) => message.type === "probe-armed");
  const raceModule = join(directory, "plugins/system/src/index.js");
  await writeFile(
    raceModule,
    (await readFile(raceModule, "utf8")) +
      "\nexport const snapshotRace = true;\n",
  );
  await until((message) => message.type === "snapshot-boundary");
  await writeFile(
    join(directory, "profiles/safe/cordis.patch.yml"),
    "- id: system\n  config: { reloadProbe: 7 }\n",
  );
  await until((message) => message.type === "probe-config-queued");
  child.send({ type: "release-snapshot-probe" });
  await until(
    () =>
      messages.filter((message) => message.type === "probe-publication")
        .length >= 2,
  );
  const publications = messages
    .filter((message) => message.type === "probe-publication")
    .slice(0, 2);
  assert.notEqual(
    publications[0].activeConfig,
    publications[1].activeConfig,
    "Probe must activate different actual native configurations",
  );
  assert.notEqual(
    publications[0].revision,
    publications[1].revision,
    "A pending disk snapshot must not merge distinct native graph activations",
  );
  child.send({ type: "finish-snapshot-probe" });
  const before = await state();
  // Headless Host routes deliberately return 503. Recovery must preserve that
  // owner response and finish router publication, not require an invented 200.
  assert.equal(before.httpStatus, 503);
  assert.equal(before.router?.reloading, false);
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
  child.send({ type: "arm-config-rejection" });
  await until((message) => message.type === "config-rejection-armed");
  const rejectedConfigPath = join(directory, "profiles/safe/cordis.patch.yml");
  const beforeQueuedRejection = await state();
  await writeFile(rejectedConfigPath, "");
  const earlierRejected = await until(
    (message) => message.type === "config-rejection-queued",
  );
  assert.match(earlierRejected.reason, /invalid patch list/u);
  const completeLaterConfig = "- id: system\n  config: { reloadProbe: 9 }\n";
  await writeFile(rejectedConfigPath, completeLaterConfig);
  child.send({ type: "release-config-rejection" });
  await until((message) => message.type === "config-rejection-finished");
  assert.equal(
    await readFile(rejectedConfigPath, "utf8"),
    completeLaterConfig,
    "An earlier parse rejection must not overwrite the complete later native configuration",
  );
  const newerDeadline = Date.now() + 10000;
  let newerConfiguration;
  do {
    await new Promise((resolve) => setTimeout(resolve, 100));
    newerConfiguration = await state();
  } while (
    (newerConfiguration.configProbe !== 9 ||
      newerConfiguration.router.reloading !== false ||
      newerConfiguration.hmr.lastError !== undefined) &&
    Date.now() < newerDeadline
  );
  assert.equal(
    newerConfiguration.configProbe,
    9,
    "The exact later native config must actually activate",
  );
  assert.notEqual(newerConfiguration.revision, beforeQueuedRejection.revision);
  assert.equal(newerConfiguration.hmr.lastError, undefined);
  const acceptedJournal = JSON.parse(
    await readFile(join(directory, ".last-good.json"), "utf8"),
  );
  assert.equal(
    Buffer.from(
      acceptedJournal.files.find(
        ([path]) => path === "profiles/safe/cordis.patch.yml",
      )[1],
      "base64",
    ).toString("utf8"),
    completeLaterConfig,
    "Journal must preserve the exact actually accepted config input, not a pending/restored disk read",
  );

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
  await writeFile(profilePatch, lastGoodPatch);
  const lastGood = await readyState(
    "Hot reload 3",
    previous.revision,
    before.httpStatus,
  );
  await writeFile(modulePath, "this is invalid ESM !!!");
  // First prove the rejected file was restored; an early old response before
  // the watcher observes corruption cannot satisfy the recovery assertion.
  const restoreDeadline = Date.now() + 10000;
  while (
    !/Hot reload 3/u.test(await readFile(modulePath, "utf8")) &&
    Date.now() < restoreDeadline
  )
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert.match(
    await readFile(modulePath, "utf8"),
    /Hot reload 3/,
    "Rejected code must not poison later snapshots",
  );
  const recovered = await readyState(
    lastGood.title,
    lastGood.revision,
    before.httpStatus,
  );
  assert.equal(recovered.title, lastGood.title);
  assert.equal(recovered.revision, lastGood.revision);
  assert.deepEqual(recovered.routes, lastGood.routes);
  assert.deepEqual(recovered.services, lastGood.services);
  assert.equal(recovered.effects, lastGood.effects);
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
