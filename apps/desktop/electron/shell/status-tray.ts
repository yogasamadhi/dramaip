import { Menu, Tray, nativeImage } from "electron";

interface StatusTrayOptions {
  readonly background: boolean;
  readonly iconPath: string;
  readonly showWindow: () => void;
  readonly quit: () => void;
}

/** macOS menu bar entry; background tests must not add system UI. */
export function createStatusTray(
  options: StatusTrayOptions,
  platform: NodeJS.Platform = process.platform,
): Tray | undefined {
  if (platform !== "darwin" || options.background) return undefined;

  // The Template PNG and its @2x companion adapt to light/dark menu bars.
  const image = nativeImage.createFromPath(options.iconPath);
  if (image.isEmpty()) throw new Error("无法加载尽意 DramaIP 菜单栏图标");
  image.setTemplateImage(true);
  const tray = new Tray(image);
  tray.setToolTip("尽意 DramaIP");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示尽意 DramaIP", click: options.showWindow },
      { type: "separator" },
      { label: "退出尽意 DramaIP", click: options.quit },
    ]),
  );
  return tray;
}
