/**
 * The Host-owned media library (D8): EXIF-stripped portraits, archived
 * provider videos, verified renderer sidecars, timeline renders and NLE
 * copies. Media bytes stay under the Host's data directory; business plugins
 * see opaque media references only.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  HostManagedMediaReadError,
  type HostArchiveRemoteMediaInput,
  type HostArchivedMedia,
  type HostCapabilityDescriptor,
  type HostManagedMedia,
  type HostManagedMediaReadInput,
  type HostTimelineRenderInput,
  type HostTimelineRenderJob,
  type NleCopyInput,
  type NleCopyJob,
} from "@dramaip/host-contracts";
import type { ShellBridge } from "@dramaip/host-shell-bridge";
import type { HostCredentials } from "./credentials.ts";
import { HOST_GENERATION, type HostFiles } from "./files.ts";
import {
  loadVerifiedFfmpeg,
  loadVerifiedFfprobe,
} from "./media/ffprobe-sidecar.ts";
import { archiveRemoteVideo } from "./media/media-archive.ts";
import { ManagedMediaReader } from "./media/managed-media-reader.ts";
import { NleCopySupervisor } from "./media/nle-copy-supervisor.ts";
import { RenderSupervisor } from "./media/render-supervisor.ts";
import { loadVerifiedRendererFonts } from "./media/renderer-fonts.ts";

/** Largest portrait source the Host decodes. */
const MAXIMUM_PORTRAIT_BYTES = 20 * 1024 * 1024;

/** Where the verified sidecars and fonts are looked up, and their signing keys. */
export interface MediaOptions {
  readonly dataDir: string;
  readonly rendererManifestPublicKeyPem?: string | undefined;
  readonly rendererFontPublicKeyPem?: string | undefined;
}

function warning(subject: string): (cause: unknown) => undefined {
  return (cause) => {
    console.warn(
      `${subject} failed: ${cause instanceof Error ? cause.message : "unknown error"}`,
    );
    return undefined;
  };
}

/** One Host's media library and the renderer capabilities it verified. */
export class HostMedia {
  private readonly root: string;
  private readonly reader: ManagedMediaReader;
  private readonly copies: NleCopySupervisor;
  private readonly portraits = new Map<string, string>();
  private readonly archived = new Map<string, string>();
  private ffprobe: Awaited<ReturnType<typeof loadVerifiedFfprobe>> | undefined;
  private renderer: RenderSupervisor | undefined;

  /**
   * @param options - data directory and signing keys.
   * @param shell - the shell bridge (image re-encoding, reveal).
   * @param files - the grants a portrait import or NLE copy names.
   * @param credentials - provider credentials for archived downloads.
   */
  constructor(
    private readonly options: MediaOptions,
    private readonly shell: ShellBridge,
    private readonly files: HostFiles,
    private readonly credentials: HostCredentials,
  ) {
    this.root = join(options.dataDir, "media-library");
    this.reader = new ManagedMediaReader(this.root);
    this.copies = new NleCopySupervisor({
      journalRoot: join(options.dataDir, "nle-copy-jobs"),
      hostGeneration: HOST_GENERATION,
      reader: this.reader,
      resolveWriteGrant: async (ref) => this.files.writeDirectory(ref),
    });
  }

  /** Verify the signed renderer sidecars and fonts, when installed. */
  async start(): Promise<void> {
    const sidecars = join(this.options.dataDir, "renderer-sidecars", "active");
    const publicKeyPem = this.options.rendererManifestPublicKeyPem;
    this.ffprobe = await loadVerifiedFfprobe({
      root: sidecars,
      ...(publicKeyPem ? { publicKeyPem } : {}),
    }).catch(warning("Renderer sidecar verification"));
    const ffmpeg = await loadVerifiedFfmpeg({
      root: sidecars,
      ...(publicKeyPem ? { publicKeyPem } : {}),
    }).catch(warning("FFmpeg sidecar verification"));
    const rendererFonts =
      (await loadVerifiedRendererFonts({
        root: join(this.options.dataDir, "renderer-fonts", "active"),
        ...(this.options.rendererFontPublicKeyPem
          ? { publicKeyPem: this.options.rendererFontPublicKeyPem }
          : {}),
      }).catch(warning("Renderer font verification"))) ?? [];
    if (this.ffprobe && ffmpeg) {
      this.renderer = new RenderSupervisor({
        ffmpegPath: ffmpeg.executablePath,
        rendererVersion: ffmpeg.version,
        mediaRoot: this.root,
        probe: this.ffprobe.probe,
        probeAudio: this.ffprobe.probeAudio,
        audioMixAvailable: ffmpeg.audioMixAvailable,
        probeVideo: this.ffprobe.probeVideo,
        videoProofAvailable: ffmpeg.videoProofAvailable,
        rendererFonts,
      });
      await this.renderer
        .verifySubtitleCapability()
        .catch(warning("Renderer subtitle capability verification"));
    }
  }

  /** @returns the media capability descriptors this Host offers. */
  capabilities(): HostCapabilityDescriptor[] {
    const renderer = this.renderer;
    return [
      { id: "media-library", available: true },
      { id: "media-playback", available: true },
      {
        id: "media-archive",
        available: Boolean(this.ffprobe),
        ...(this.ffprobe ? { version: this.ffprobe.version } : {}),
      },
      {
        id: "renderer.ffmpeg-x264",
        available: Boolean(renderer),
        ...(renderer ? { version: renderer.rendererVersion } : {}),
      },
      {
        id: "renderer.ffmpeg-audio-mix-v1",
        available: renderer?.audioMixAvailable === true,
        ...(renderer?.audioMixAvailable
          ? { version: renderer.rendererVersion }
          : {}),
      },
      {
        id: "renderer.ffmpeg-subtitles-v1",
        available: renderer?.subtitleBurnInAvailable === true,
        ...(renderer?.subtitleBurnInAvailable
          ? {
              version: renderer.rendererVersion,
              fonts: renderer.subtitleFonts,
            }
          : {}),
      },
    ];
  }

  async importPortraitMedia(grantId: string): Promise<HostManagedMedia> {
    const path = this.files.grantedPath(
      grantId,
      "file",
      "照片文件授权无效或已过期",
    );
    const source = await readFile(path);
    if (source.byteLength > MAXIMUM_PORTRAIT_BYTES)
      throw new Error("照片超过 20MB 安全上限");
    // Re-encoding is intentional: EXIF and the original byte stream never
    // enter the Host's tree, the browser, diagnostics or the project database.
    const image = await this.shell.request("image.toPng", { path });
    if (image === null) throw new Error("照片格式无效或无法解码");
    const { width, height } = image;
    if (width < 16 || height < 16 || width > 8192 || height > 8192)
      throw new Error("照片尺寸不在允许范围内");
    const cleaned = Buffer.from(image.pngBase64, "base64");
    const mediaRef = randomUUID();
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const target = join(this.root, `${mediaRef}.png`);
    await writeFile(target, cleaned, { mode: 0o600, flag: "wx" });
    this.portraits.set(mediaRef, target);
    return {
      mediaRef,
      sha256: createHash("sha256").update(cleaned).digest("hex"),
      mimeType: "image/png",
      width,
      height,
      size: cleaned.byteLength,
    };
  }

  /**
   * The bytes of portraits a provider request references.
   * @param mediaRef - a portrait reference.
   * @returns the PNG bytes.
   */
  async portraitBytes(mediaRef: string): Promise<Buffer> {
    const path = this.portraits.get(mediaRef);
    if (path === undefined) throw new Error("受控照片引用不可用或已被删除");
    return readFile(path);
  }

  async archiveRemoteMedia(
    input: HostArchiveRemoteMediaInput,
  ): Promise<HostArchivedMedia> {
    const ffprobe = this.ffprobe;
    if (ffprobe === undefined) throw new Error("媒体存档能力不可用");
    let authorization = "";
    if (input.credentialRef) {
      const secret = await this.credentials.resolve(input.credentialRef, {
        purpose: "provider-authentication",
        origin: new URL(input.url).origin,
      });
      if (!secret) throw new Error("服务商安全凭据不可用");
      authorization = `Bearer ${secret}`;
    }
    const archived = await archiveRemoteVideo(
      {
        url: input.url,
        authorization,
        maximumBytes: input.maximumBytes ?? 512 * 1024 * 1024,
        timeoutMs: 10 * 60_000,
        ...(input.expectedSha256
          ? { expectedSha256: input.expectedSha256 }
          : {}),
      },
      { root: this.root, probe: ffprobe.probe },
    );
    this.archived.set(
      archived.mediaRef,
      join(this.root, `${archived.mediaRef}${archived.extension}`),
    );
    return archived;
  }

  /**
   * Stream one archived file, answered as the media route answered.
   * @param input - the reference and the integrity facts it must match.
   * @param signal - the caller's cancellation.
   * @returns the bytes, or a problem response.
   */
  async readManagedMedia(
    input: HostManagedMediaReadInput,
    signal: AbortSignal,
  ): Promise<Response> {
    try {
      const body = await this.reader.read(input, signal);
      return new Response(body, {
        headers: {
          "Content-Type": input.mimeType,
          "Content-Length": String(input.sizeBytes),
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          ETag: `"${input.sha256}"`,
        },
      });
    } catch (cause) {
      const error =
        cause instanceof HostManagedMediaReadError
          ? cause
          : new HostManagedMediaReadError(
              503,
              "MANAGED_MEDIA_READ_UNAVAILABLE",
            );
      return new Response(
        JSON.stringify({
          type: "about:blank",
          title: "存档文件不可安全读取。",
          status: error.status,
          code: error.code,
          traceId: randomUUID(),
        }),
        {
          status: error.status,
          headers: { "Content-Type": "application/problem+json" },
        },
      );
    }
  }

  async removeManagedMedia(mediaRef: string): Promise<void> {
    const target = this.portraits.get(mediaRef) ?? this.archived.get(mediaRef);
    if (target === undefined) return;
    this.portraits.delete(mediaRef);
    this.archived.delete(mediaRef);
    try {
      await unlink(target);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
  }

  /** Whether a verified renderer is available. */
  get rendering(): boolean {
    return this.renderer !== undefined;
  }

  /** Whether the remote media archive can probe what it downloads. */
  get archiving(): boolean {
    return this.ffprobe !== undefined;
  }

  private requireRenderer(): RenderSupervisor {
    if (this.renderer === undefined) throw new Error("时间线渲染能力不可用");
    return this.renderer;
  }

  async startTimelineRender(
    input: HostTimelineRenderInput,
  ): Promise<HostTimelineRenderJob> {
    return this.requireRenderer().start(input);
  }

  async getTimelineRender(
    jobId: string,
  ): Promise<HostTimelineRenderJob | undefined> {
    const value = this.requireRenderer().get(jobId);
    if (value?.output)
      this.archived.set(
        value.output.mediaRef,
        join(this.root, `${value.output.mediaRef}${value.output.extension}`),
      );
    return value;
  }

  async cancelTimelineRender(
    jobId: string,
  ): Promise<HostTimelineRenderJob | undefined> {
    return this.requireRenderer().cancel(jobId);
  }

  startNleMediaCopy(
    id: string,
    input: NleCopyInput,
    writeGrantRef: string,
  ): Promise<NleCopyJob> {
    return this.copies.start(id, input, writeGrantRef);
  }

  getNleMediaCopy(
    id: string,
    projectId: string,
  ): Promise<NleCopyJob | undefined> {
    return this.copies.get(id, projectId);
  }

  cancelNleMediaCopy(
    id: string,
    projectId: string,
  ): Promise<NleCopyJob | undefined> {
    return this.copies.cancel(id, projectId);
  }

  async revealNleMediaCopy(
    id: string,
    projectId: string,
    artifactRef: string,
  ): Promise<boolean> {
    const path = await this.copies.resolveArtifact(id, projectId, artifactRef);
    if (!path) return false;
    await this.shell.request("shell.showItemInFolder", { path });
    return true;
  }

  /** Stop renders, copies and open reads. */
  async dispose(): Promise<void> {
    await this.copies.dispose();
    await this.renderer?.dispose();
    await this.reader.dispose();
  }
}
