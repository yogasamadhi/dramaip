import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  image: { isEmpty: vi.fn(() => false), setTemplateImage: vi.fn() },
  tray: {
    on: vi.fn(),
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    popUpContextMenu: vi.fn(),
  },
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

describe("desktop status tray", () => {
  it("uses a macOS template icon and opens the menu on right-click", () => {
    const actions = options();
    expect(createStatusTray(actions, "darwin")).toBe(mocks.tray);
    expect(mocks.createFromPath).toHaveBeenCalledWith(actions.iconPath);
    expect(mocks.image.setTemplateImage).toHaveBeenCalledWith(true);
    expect(mocks.tray.setToolTip).toHaveBeenCalledWith("DramaIP");
    const menu = mocks.buildFromTemplate.mock.results[0]!.value;
    expect(mocks.tray.on).toHaveBeenCalledWith("click", actions.showWindow);
    const rightClick = mocks.tray.on.mock.calls.find(
      ([event]) => event === "right-click",
    )?.[1];
    rightClick();
    expect(mocks.tray.popUpContextMenu).toHaveBeenCalledWith(menu);
    expect(mocks.tray.setContextMenu).not.toHaveBeenCalled();
  });

  it("uses a Windows icon and routes single click and menu actions through the shell", () => {
    const actions = { ...options(), iconPath: "/app/tray/icon.ico" };
    expect(createStatusTray(actions, "win32")).toBe(mocks.tray);
    expect(mocks.createFromPath).toHaveBeenCalledWith(actions.iconPath);
    expect(mocks.image.setTemplateImage).not.toHaveBeenCalled();
    const click = mocks.tray.on.mock.calls.find(
      ([event]) => event === "click",
    )?.[1];
    click();
    const menu = mocks.buildFromTemplate.mock.results[0]!.value;
    expect(mocks.tray.setContextMenu).toHaveBeenCalledWith(menu);
    menu[0].click();
    menu[2].click();
    expect(actions.showWindow).toHaveBeenCalledTimes(2);
    expect(actions.quit).toHaveBeenCalledOnce();
  });

  it("does not create a tray on Linux", () => {
    expect(createStatusTray(options(), "linux")).toBeUndefined();
    expect(mocks.createTray).not.toHaveBeenCalled();
    expect(mocks.createFromPath).not.toHaveBeenCalled();
  });

  it("keeps background runs free of menu bar UI", () => {
    expect(
      createStatusTray({ ...options(), background: true }, "darwin"),
    ).toBeUndefined();
    expect(mocks.createTray).not.toHaveBeenCalled();
  });

  it("reports missing image resources instead of creating an invisible icon", () => {
    mocks.image.isEmpty.mockReturnValue(true);
    expect(() => createStatusTray(options(), "darwin")).toThrow(
      "无法加载 DramaIP 托盘图标",
    );
    expect(mocks.createTray).not.toHaveBeenCalled();
  });
});
