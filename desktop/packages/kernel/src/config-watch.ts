import { watch } from "chokidar";
import { stat, realpath } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

/**
 * DSH 0.2 removed HMR's exact config-file watch (`registerConfig`), so the
 * Kernel owns Profile assembly inputs itself. Module HMR stays DSH-native.
 *
 * Semantics preserved from the pinned callback contract:
 * - one exact path, which may not exist yet (the nearest existing ancestor is
 *   watched with a bounded depth);
 * - add/change/unlink all refresh, including once for the initial scan so a
 *   patch layer present at registration applies;
 * - refreshes are serialized and coalesced: an edit during a running refresh
 *   schedules exactly one more pass, which reads the then-current bytes;
 * - a failed refresh is reported and never retried or restored;
 * - the returned disposer closes the watch and joins the running refresh.
 */
export async function watchConfigFile(
  filename: string,
  refresh: () => Promise<void> | void,
  report: (filename: string, error: Error) => void,
): Promise<() => Promise<void>> {
  const target = await findWatchRoot(filename);
  const watcher = watch(target.root, {
    depth: target.depth,
    ignoreInitial: false,
  });
  let dirty = false;
  let closed = false;
  let running: Promise<void> | undefined;
  const schedule = () => {
    if (closed) return;
    dirty = true;
    if (running) return;
    running = (async () => {
      do {
        dirty = false;
        try {
          await refresh();
        } catch (reason) {
          report(
            filename,
            reason instanceof Error
              ? reason
              : new Error(String(reason), { cause: reason }),
          );
        }
      } while (dirty && !closed);
    })().finally(() => {
      running = undefined;
    });
  };
  const onChange = (path: string) => {
    const observed = resolve(path);
    if (observed === filename || observed === target.filename) schedule();
  };
  watcher.on("add", onChange);
  watcher.on("change", onChange);
  watcher.on("unlink", onChange);

  const ready = Promise.withResolvers<void>();
  let settled = false;
  watcher.once("ready", () => {
    settled = true;
    ready.resolve();
  });
  watcher.on("error", (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    if (settled) report(filename, error);
    else {
      settled = true;
      ready.reject(error);
    }
  });
  try {
    await ready.promise;
  } catch (error) {
    closed = true;
    await watcher.close();
    throw error;
  }
  return async () => {
    closed = true;
    await watcher.close();
    await running;
  };
}

async function findWatchRoot(
  filename: string,
): Promise<{ filename: string; root: string; depth: number }> {
  let root = dirname(filename);
  let depth = 0;
  for (;;) {
    try {
      if (!(await stat(root)).isDirectory())
        throw new Error(`Config watch parent is not a directory: ${root}`);
      const canonical = await realpath(root);
      return {
        filename: resolve(canonical, relative(root, filename)),
        root: canonical,
        depth,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(root);
      if (parent === root) throw error;
      root = parent;
      depth += 1;
    }
  }
}
