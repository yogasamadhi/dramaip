/**
 * Native recovery (baseline §5.4): the crash report written before the first
 * recovery window, the shell-owned recovery document, and the Profile patch
 * backup one of its choices performs. The document lives on
 * `dramaip-app://shell/` and never contacts the Host.
 */
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { HostFailure } from "./host-process";

/** The Profile this application owns exclusively (D6). */
const DESKTOP_PROFILE = "desktop";

/** What a reset Profile patch contains: no user layer entries. */
const EMPTY_PATCH = `# Reset by DramaIP recovery; the previous patch was backed up beside this file.
[]
`;

/** Upper bound of the diagnostic shown in the recovery document. */
const SHOWN_DIAGNOSTIC_CHARS = 4_000;

/** Credentials and launch tokens never reach a report. */
function redact(text: string): string {
  return text
    .replace(/([?&]token=)[^\s&"']+/giu, "$1<redacted>")
    .replace(/(Bearer\s+)[\w.~+/-]+=*/giu, "$1<redacted>")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/gu, "<redacted>");
}

/**
 * Write one crash report.
 * @param directory - the platform log directory.
 * @param failure - what failed.
 * @returns the report's path.
 */
export async function writeCrashReport(
  directory: string,
  failure: HostFailure,
): Promise<string> {
  await mkdir(directory, { recursive: true });
  const path = join(
    directory,
    `crash-${new Date().toISOString().replace(/[:.]/gu, "-")}.log`,
  );
  await writeFile(
    path,
    `${redact(failure.message)}\n\n${redact(failure.diagnostic)}\n`,
    { mode: 0o600 },
  );
  return path;
}

/**
 * Back up the desktop Profile's patch layer and reset it, so a patch that
 * keeps the Host from starting no longer applies on the next launch.
 * @param home - the DramaIP home.
 * @returns the backup's path, or undefined when the Profile has no patch.
 */
export async function backupProfilePatch(
  home: string,
): Promise<string | undefined> {
  const patch = join(home, "profiles", DESKTOP_PROFILE, "cordis.patch.yml");
  if (!existsSync(patch)) return undefined;
  const backup = `${patch}.${new Date().toISOString().replace(/[:.]/gu, "-")}.bak`;
  await copyFile(patch, backup);
  await writeFile(patch, EMPTY_PATCH);
  return backup;
}

function escape(text: string): string {
  return text.replace(
    /[<>&"']/gu,
    (character) => `&#${character.charCodeAt(0)};`,
  );
}

/**
 * The recovery document.
 * @param failure - what failed.
 * @param report - the crash report's path, when it was written.
 * @returns HTML for `dramaip-app://shell/recovery`.
 */
export function recoveryDocument(
  failure: HostFailure,
  report: string | undefined,
): string {
  const diagnostic = redact(failure.diagnostic).slice(-SHOWN_DIAGNOSTIC_CHARS);
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>尽意 DramaIP 需要恢复</title><style>
body{margin:0;background:#f7f6f2;color:#252420;font:14px system-ui;padding:28px}h1{font-size:18px;margin:0 0 8px}p{color:#67635b;line-height:1.6;margin:0 0 12px}pre{background:#fff;border:1px solid #d8d4ca;border-radius:8px;padding:10px;max-height:160px;overflow:auto;font-size:12px;white-space:pre-wrap}div{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}button{padding:9px 14px;border:1px solid #bbb6aa;border-radius:8px;background:white;cursor:pointer}button[data-choice=restart]{background:#252420;color:white;border-color:#252420}
</style></head><body>
<h1>本地服务意外停止</h1>
<p data-testid="recovery-message">${escape(redact(failure.message))}</p>
${report ? `<p>崩溃报告已写入：${escape(report)}</p>` : ""}
<pre>${escape(diagnostic)}</pre>
<div>
<button data-choice="restart">重启</button>
<button data-choice="safe">以安全模式启动</button>
<button data-choice="backup">备份 Profile patch 并重启</button>
<button data-choice="quit">退出</button>
</div>
<script>
for (const button of document.querySelectorAll('button[data-choice]'))
  button.onclick = () => { for (const b of document.querySelectorAll('button')) b.disabled = true; window.dramaipRecovery.choose(button.dataset.choice); };
</script></body></html>`;
}
