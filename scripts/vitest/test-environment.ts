/**
 * Give every infra suite one known starting environment. An ambient proxy
 * would route local fixture requests through the developer's proxy, and an
 * ambient `NoDefaultCurrentDirectoryInExePath` changes Windows executable
 * search, which the subprocess suites assert from process.env.
 */
import { PROXY_ENV_NAMES } from "../../packages/infra/http-proxy/src/policy.ts";

for (const name of [...PROXY_ENV_NAMES, "NoDefaultCurrentDirectoryInExePath"])
  delete process.env[name];
