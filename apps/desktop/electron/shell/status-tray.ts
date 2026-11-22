import { Menu, Tray, nativeImage } from "electron";

interface StatusTrayOptions {
  readonly background: boolean;
  readonly iconPath: string;
  readonly showWindow: () => void;
  readonly quit: () => void;
}

/** Desktop tray entry; background tests must not add system UI. */
export function createStatusTray(
  options: StatusTrayOptions,
  platform: NodeJS.Platform = process.platform,
): Tray | undefined {
  if (options.background || !["darwin", "win32"].includes(platform))
    return undefined;

  const image = nativeImage.createFromPath(options.iconPath);
  if (image.isEmpty()) throw new Error("无法加载 DramaIP 托盘图标");
  if (platform === "darwin") image.setTemplateImage(true);
  const tray = new Tray(image);
  tray.setToolTip("DramaIP");
  tray.on("click", options.showWindow);
  const menu = Menu.buildFromTemplate([
    { label: "显示 DramaIP", click: options.showWindow },
    { type: "separator" },
    { label: "退出 DramaIP", click: options.quit },
  ]);
  if (platform === "darwin")
    tray.on("right-click", () => tray.popUpContextMenu(menu));
  else tray.setContextMenu(menu);
  return tray;
}
