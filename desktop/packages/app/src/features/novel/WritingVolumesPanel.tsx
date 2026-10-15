import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Input,
  Textarea,
  confirmDialog,
  NativeSelect,
} from "@dramaip/ui-shared";
import { StudioClientError } from "@dramaip/client";
import {
  ChapterSchema,
  WritingVolumeAssignmentInputSchema,
  type WritingVolume,
} from "@dramaip/contracts/writing";
import { message, useStudio } from "../../studio-shared";
import {
  readVolumeRequest,
  writeVolumeRequest,
  type WritingVolumeRequest,
} from "../../writing-volume-request";

/** Actual Writing volumes, not the numeric planning fields of a story arc. */
export function WritingVolumesPanel({
  projectId,
  onChanged,
}: {
  projectId: string;
  onChanged: () => Promise<void>;
}) {
  const client = useStudio(),
    queries = useQueryClient();
  const [saved, setSaved] = useState(() =>
    readVolumeRequest(projectId, () => localStorage),
  );
  const [title, setTitle] = useState(""),
    [outline, setOutline] = useState("");
  const [target, setTarget] = useState(""),
    [selection, setSelection] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  const [rejected, setRejected] = useState(false),
    [receipt, setReceipt] = useState<unknown>();
  const data = useQuery({
    queryKey: ["writing-volume-editor", projectId],
    queryFn: async () => {
      const volumes: WritingVolume[] = [],
        seen = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < 20; page++) {
        const current = await client.writingVolumes.list(projectId, {
          cursor,
          limit: 100,
        });
        for (const item of current.items) {
          if (seen.has(item.id))
            throw new Error("卷分页重复，未把不完整目录用于确认。");
          seen.add(item.id);
          volumes.push(item);
        }
        if (current.nextCursor === undefined) {
          const chapters = (await client.chapters.list(projectId)).map((raw) =>
            ChapterSchema.parse(raw),
          );
          if (
            chapters.some((item) => item.projectId !== projectId) ||
            new Set(chapters.map((item) => item.id)).size !== chapters.length
          )
            throw new Error("当前章节归属无法核对，未采用缓存或其他项目。");
          return { volumes, chapters };
        }
        cursor = current.nextCursor;
      }
      throw new Error("当前卷目录超过本次完整读取上限，未截断后当作全量。");
    },
  });
  const refresh = async () => {
    await Promise.all([
      queries.invalidateQueries({
        queryKey: ["writing-volume-editor", projectId],
      }),
      queries.invalidateQueries({ queryKey: ["chapters", projectId] }),
      onChanged(),
    ]);
  };
  const replay = async (request: WritingVolumeRequest, raw: string) => {
    setBusy(true);
    setError(undefined);
    setRejected(false);
    try {
      // Never mint another key or substitute current directory versions here.
      if (readVolumeRequest(projectId, () => localStorage).raw !== raw)
        throw new Error("原请求已变化，未发送旧窗口决定。");
      const result =
        request.kind === "create"
          ? await client.writingVolumes.create(
              projectId,
              request.input,
              request.key,
            )
          : await client.writingVolumes.assign(
              projectId,
              request.input,
              request.key,
            );
      setReceipt(result);
      writeVolumeRequest(projectId, null, raw, () => localStorage);
      setSaved({ raw: null });
      setSelection([]);
      setTitle("");
      setOutline("");
      setTarget("");
    } catch (cause) {
      setError(message(cause));
      setRejected(
        cause instanceof StudioClientError &&
          ((cause.status === 400 && cause.body.code === "VALIDATION_ERROR") ||
            (cause.status === 409 && cause.body.code === "CONFLICT")),
      );
    } finally {
      setBusy(false);
      await refresh().catch((cause) => setError(message(cause)));
    }
  };
  const submit = async (request: WritingVolumeRequest) => {
    try {
      const raw = writeVolumeRequest(
        projectId,
        request,
        saved.raw,
        () => localStorage,
      )!;
      setSaved({ raw, request });
      await replay(request, raw);
    } catch (cause) {
      setError(`原请求未能安全保存或发送：${message(cause)}`);
    }
  };
  const create = async () => {
    if (!title.trim() || busy || saved.request || saved.error) return;
    const input = { title: title.trim(), outline };
    if (
      await confirmDialog({
        title: "确认创建实际卷",
        description: `创建「${input.title}」及明确规划；不会自动移动章节，也不证明叙事内容已发生。`,
        confirmLabel: "确认创建实际卷",
      })
    )
      await submit({
        kind: "create",
        projectId,
        key: crypto.randomUUID(),
        input,
        confirmedAt: new Date().toISOString(),
      });
  };
  const assign = async () => {
    if (
      busy ||
      saved.request ||
      saved.error ||
      data.error ||
      !data.data ||
      !target
    )
      return;
    const source = data.data,
      volume = source.volumes.find((item) => item.id === target);
    const input = WritingVolumeAssignmentInputSchema.safeParse({
      chapters: source.chapters
        .filter((item) => selection.includes(item.id))
        .map((item) => ({
          chapterId: item.id,
          version: item.version,
          volumeId: target === "remove" ? null : target,
        })),
      volumes: volume ? [{ id: volume.id, version: volume.version }] : [],
    });
    if (!input.success || input.data.chapters.length !== selection.length) {
      setError("请明确完整章节和当前目标卷，不自动替换缺失选择。");
      return;
    }
    const label =
      target === "remove"
        ? "明确移出卷"
        : `归入「${volume!.title}」v${volume!.version}`;
    if (
      !(await confirmDialog({
        title: "确认实际卷归属",
        description: `${input.data.chapters.length} 章将${label}。各章将产生新版本并保留历史，不改正文、不重排、不删除未选章节；旧摘要和下游引用可能失效，须另行审阅。`,
        confirmLabel: "确认整批归属",
      }))
    )
      return;
    await submit({
      kind: "assign",
      projectId,
      key: crypto.randomUUID(),
      input: input.data,
      confirmedAt: new Date().toISOString(),
    });
  };
  const disabled = busy || !!saved.request || !!saved.error;
  return (
    <details className="rounded border border-line p-3">
      <summary className="cursor-pointer font-semibold">
        管理实际卷与章节归属
      </summary>
      <section aria-label="实际卷与章节归属" className="mt-3 space-y-3">
        <p className="text-sm text-muted">
          实际卷与规划故事弧分别管理；不按章节数字猜范围。只有你明确选择并确认的章节改变归属，正文保持；小说、改编和媒体均不因此成为强制步骤。
        </p>
        {(saved.error || error || data.error) && (
          <p role="alert">{saved.error ?? error ?? message(data.error)}</p>
        )}
        {saved.request && (
          <section
            aria-label="原卷请求恢复"
            className="space-y-2 rounded border border-line p-3"
          >
            <p>
              已保存原{saved.request.kind === "create" ? "卷创建" : "整批归属"}
              请求。只恢复原键／原输入，不采用当前最新版本；不会因刷新或重启自动提交。
            </p>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">
              {JSON.stringify(saved.request, null, 2)}
            </pre>
            <Button
              disabled={busy}
              onClick={() => void replay(saved.request!, saved.raw!)}
            >
              恢复原卷请求
            </Button>
            {rejected && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={async () => {
                  if (
                    !(await confirmDialog({
                      title: "解除已拒绝的本地卷请求",
                      description:
                        "服务器已明确拒绝此请求；仅移除本地恢复记录，不撤销正式版本或删除章节。下一次须重新明确选择。",
                      confirmLabel: "解除已拒绝请求",
                    }))
                  )
                    return;
                  try {
                    writeVolumeRequest(
                      projectId,
                      null,
                      saved.raw,
                      () => localStorage,
                    );
                    setSaved({ raw: null });
                    setRejected(false);
                    setError(undefined);
                    setSelection([]);
                  } catch (cause) {
                    setError(message(cause));
                  }
                }}
              >
                解除已拒绝请求
              </Button>
            )}
          </section>
        )}
        {receipt !== undefined && (
          <details>
            <summary>本次原卷操作回执（不是摘要或质量证明）</summary>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">
              {JSON.stringify(receipt, null, 2)}
            </pre>
          </details>
        )}
        <label className="block">
          实际卷名称
          <Input
            aria-label="实际卷名称"
            value={title}
            maxLength={160}
            disabled={disabled}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </label>
        <label className="block">
          实际卷规划
          <Textarea
            aria-label="实际卷规划"
            value={outline}
            disabled={disabled}
            onChange={(event) => setOutline(event.currentTarget.value)}
          />
        </label>
        <Button
          disabled={disabled || !title.trim()}
          onClick={() => void create()}
        >
          创建实际卷
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void refresh()}
        >
          刷新实际卷与章节
        </Button>
        <label className="block">
          目标卷
          <NativeSelect
            aria-label="目标实际卷"
            value={target}
            disabled={disabled || !!data.error}
            onChange={(event) => setTarget(event.currentTarget.value)}
            className="ml-2 w-auto"
          >
            <option value="">请明确选择目标</option>
            <option value="remove">明确移出卷（不删除章节）</option>
            {!data.error &&
              data.data?.volumes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} · v{item.version}
                </option>
              ))}
          </NativeSelect>
        </label>
        {!data.error &&
          data.data?.chapters.map((item) => (
            <label key={item.id} className="block text-sm">
              <input
                aria-label={`卷归属章节 ${item.title}`}
                type="checkbox"
                disabled={disabled}
                checked={selection.includes(item.id)}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setSelection((previous) =>
                    checked
                      ? [...previous, item.id]
                      : previous.filter((id) => id !== item.id),
                  );
                }}
              />{" "}
              {item.title} · v{item.version} ·{" "}
              {item.volumeId
                ? (data.data?.volumes.find(
                    (volume) => volume.id === item.volumeId,
                  )?.title ?? "当前归属无法核对")
                : "尚未归卷"}
            </label>
          ))}
        <Button
          disabled={disabled || !!data.error || !target || !selection.length}
          onClick={() => void assign()}
        >
          确认所选章节归属
        </Button>
      </section>
    </details>
  );
}
