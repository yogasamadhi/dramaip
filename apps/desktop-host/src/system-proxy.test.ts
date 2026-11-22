import { expect, test } from "vitest";
import {
  macSystemProxyEnvironment,
  withDesktopSystemProxy,
} from "./system-proxy.ts";

test("reads macOS HTTP and HTTPS proxies and the system bypass list", () => {
  const output = `<dictionary> {
  ExceptionsList : <array> {
    0 : localhost
    1 : *.internal.example
  }
  HTTPEnable : 1
  HTTPProxy : 127.0.0.1
  HTTPPort : 7897
  HTTPSEnable : 1
  HTTPSProxy : ::1
  HTTPSPort : 7898
  ProxyAutoConfigEnable : 0
  __SCOPED__ : <dictionary> {
    en0 : <dictionary> {
      HTTPSProxy : ignored.example
    }
  }
}
`;
  expect(macSystemProxyEnvironment(output)).toEqual({
    HTTP_PROXY: "http://127.0.0.1:7897",
    HTTPS_PROXY: "http://[::1]:7898",
    NO_PROXY: "localhost,*.internal.example",
  });
  expect(
    macSystemProxyEnvironment(
      output.replace("ProxyAutoConfigEnable : 0", "ProxyAutoConfigEnable : 1"),
    ),
  ).toEqual({});
});

test("an explicitly configured proxy takes priority over macOS settings", async () => {
  const explicit = {
    value: "http://proxy.example:3128",
    source: "user-env" as const,
  };
  const environment = {
    get: (name: string) => (name === "https_proxy" ? explicit : undefined),
    getFrom: () => undefined,
  };
  await expect(withDesktopSystemProxy(environment)).resolves.toBe(environment);
});
