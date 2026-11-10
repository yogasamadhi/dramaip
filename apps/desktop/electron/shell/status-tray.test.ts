import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  image: { isEmpty: vi.fn(() => false), setTemplateImage: vi.fn() },
  tray: { setToolTip: vi.fn(), setContextMenu: vi.fn() },
  createFromPath: vi.fn(),
  buildFromTemplate: vi.fn((items) => items),
  createTray: vi.fn(),
}));

vi.mock("electron", () => ({
  nativeImage: { createFromPath: mocks.createFromPath },
  Menu: { buildFromTemplate: mocks.buildFromTemplate },
  Tray: class {
    constructor(image: unknown) {
      mocks.createTray(image);
      return mocks.tray;
    }
  },
}));

import { createStatusTray } from "./status-tray";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.image.isEmpty.mockReturnValue(false);
  mocks.createFromPath.mockReturnValue(mocks.image);
});

const options = () => ({
  background: false,
  iconPath: "/app/tray/iconTemplate.png",
  showWindow: vi.fn(),
  quit: vi.fn(),
});

describe("macOS status tray", () => {
  it("uses a template icon and routes show/quit through the shell", () => {
    const actions = options();
    expect(createStatusTray(actions, "darwin")).toBe(mocks.tray);
    expect(mocks.createFromPath).toHaveBeenCalledWith(actions.iconPath);
    expect(mocks.image.setTemplateImage).toHaveBeenCalledWith(true);
    expect(mocks.tray.setToolTip).toHaveBeenCalledWith("尽意 DramaIP");
    const menu = mocks.buildFromTemplate.mock.results[0]!.value;
    menu[0].click();
    menu[2].click();
    expect(actions.showWindow).toHaveBeenCalledOnce();
    expect(actions.quit).toHaveBeenCalledOnce();
    expect(mocks.tray.setContextMenu).toHaveBeenCalledWith(menu);
  });

  it.each(["win32", "linux"] as const)(
    "does not create a macOS tray on %s",
    (platform) => {
      expect(createStatusTray(options(), platform)).toBeUndefined();
      expect(mocks.createTray).not.toHaveBeenCalled();
      expect(mocks.createFromPath).not.toHaveBeenCalled();
    },
  );

  it("keeps background runs free of menu bar UI", () => {
    expect(
      createStatusTray({ ...options(), background: true }, "darwin"),
    ).toBeUndefined();
    expect(mocks.createTray).not.toHaveBeenCalled();
  });

  it("reports missing image resources instead of creating an invisible icon", () => {
    mocks.image.isEmpty.mockReturnValue(true);
    expect(() => createStatusTray(options(), "darwin")).toThrow(
      "无法加载尽意 DramaIP 菜单栏图标",
    );
    expect(mocks.createTray).not.toHaveBeenCalled();
  });
});
