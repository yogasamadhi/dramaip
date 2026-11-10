/**
 * Browser entry for the web client: the shell boots the module system and
 * renders the root slot. In the desktop window the page is served by the
 * Electron shell rather than the Host, so it first asks the shell for the
 * Host's index injections and applies them before the client starts.
 */
import "@dramaip/infra-ui-theme/brand-font.css";
import { AppWebEntry, applyIndexInjections } from "@dramaip/infra-client-web";

/** What the desktop shell's preload exposes to `dramaip-app://app` (baseline §5.2). */
interface DesktopBoot {
  connect(): Promise<{
    readonly injections: Parameters<typeof applyIndexInjections>[0];
    readonly streamBaseUrl: string;
  }>;
  fatal(message: string): void;
}

const root = document.getElementById("root");
if (root === null) throw new Error("web app: missing #root");

const desktop = (globalThis as { dramaipDesktopBoot?: DesktopBoot })
  .dramaipDesktopBoot;

/** Execute one script row on the page origin, which the shell forwards to the Host. */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const element = document.createElement("script");
    element.src = new URL(src, document.baseURI).href;
    element.async = false;
    element.onload = () => resolve();
    element.onerror = () =>
      reject(new Error(`web boot: failed to load ${src}`));
    document.head.append(element);
  });
}

async function bootDesktop(boot: DesktopBoot): Promise<void> {
  const gate = (
    globalThis as { __DRAMAIP_BOOT_READY__?: PromiseWithResolvers<void> }
  ).__DRAMAIP_BOOT_READY__;
  try {
    const payload = await boot.connect();
    (globalThis as { __DRAMAIP_TRANSPORT__?: unknown }).__DRAMAIP_TRANSPORT__ =
      {
        streamBaseUrl: payload.streamBaseUrl,
        ownsHost: true,
      };
    await applyIndexInjections(payload.injections, loadScript);
    gate?.resolve();
  } catch (reason) {
    boot.fatal(reason instanceof Error ? reason.message : String(reason));
    gate?.reject(reason);
  }
}

if (desktop !== undefined) void bootDesktop(desktop);
void new AppWebEntry(root).run();
