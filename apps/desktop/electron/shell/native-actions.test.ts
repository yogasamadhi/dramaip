import { expect, test, vi } from "vitest";

const osStorage = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => {
    throw new Error("OS keychain accessed");
  }),
  encryptString: vi.fn(() => {
    throw new Error("OS keychain accessed");
  }),
  decryptString: vi.fn(() => {
    throw new Error("OS keychain accessed");
  }),
}));

vi.mock("electron", () => ({
  BrowserWindow: {},
  Notification: {},
  dialog: {},
  nativeImage: {},
  shell: {},
  safeStorage: osStorage,
}));

import { nativeActions } from "./native-actions";

test("旧安全存储接口保持停用，状态查询与加解密均不触碰系统钥匙串", () => {
  const handlers = nativeActions({
    background: true,
    mainWindow: () => undefined,
    credentialCapture: { open: async () => {}, close: () => {} },
  });
  expect(handlers["safeStorage.status"](null)).toEqual({
    available: false,
    secure: false,
    backend: "disabled",
  });
  expect(() =>
    handlers["safeStorage.encrypt"]({ base64: "fake-value" }),
  ).toThrow("系统钥匙串已停用");
  expect(() =>
    handlers["safeStorage.decrypt"]({ base64: "fake-value" }),
  ).toThrow("系统钥匙串已停用");
  for (const method of Object.values(osStorage))
    expect(method).not.toHaveBeenCalled();
});
