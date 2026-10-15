import { useEffect, useRef, useState } from "react";
import type { NovelRevisionEffortResult } from "@dramaip/client";
import type { NovelRevisionConfiguration } from "@dramaip/contracts/insights";
import { Button } from "@dramaip/ui-shared";
import { useStudio, message } from "../../studio-shared";
export function NovelRevisionEffortView({
  value,
}: {
  value: NovelRevisionEffortResult;
}) {
  return (
    <div
      aria-label="首次章节采用前修订结果"
      className="space-y-2 text-xs leading-5"
    >
      <p>
        检查点 {value.projection.checkpoint} · 已记录章节目标{" "}
        {value.totalTargets}
      </p>
      {value.projection.state !== "healthy" && (
        <p role="status">投影尚未追平或异常；不是完整业务历史。</p>
      )}
      {!value.items.length && <p>没有已记录章节请求，不等于历史没有修订。</p>}
      {value.items.map((row) => (
        <section
          key={row.targetKey}
          className="space-y-1 rounded border border-line p-2"
        >
          <p className="break-all">原目标 {row.targetKey}</p>
          <p>
            已观察正文修改 {row.observedContentUpdates} 次 · 显式合并{" "}
            {row.observedRebases} 次（正文变化{" "}
            {row.observedContentChangingRebases} 次）
          </p>
          <p>
            {row.state === "pending"
              ? "尚无可关联的正式采用；总数未建立"
              : row.state === "unknown"
                ? "已正式采用，但历史不完整；总数未知"
                : `首次正式采用前局部正文修订 ${row.localRevisionCount} 次`}
          </p>
          {row.adoption && (
            <p className="break-all">
              原采用事件 {row.adoption.eventId} · 章节 {row.adoption.chapterId}{" "}
              v{row.adoption.version} · 原工作流{" "}
              {row.adoption.workflowId ?? "未记录"}
            </p>
          )}
          <details>
            <summary>全部原请求身份</summary>
            <p className="break-all">{row.workflowIds.join("、")}</p>
          </details>
        </section>
      ))}
      <p className="text-muted">
        只统计首次已记录正式采用事件之前实际保存的正文变化，保留放弃、失败及重试
        AI 草稿；采用后的变化不并入。
        相同保存不多计，缺旧历史不补零。模型修订阶段、未保存操作及人工工作量不包含，不证明文学质量。
        当前为小说章节，可另行读取按最初请求配置分组的修订统计；改编／规划修订另行推进。
      </p>
    </div>
  );
}
export function NovelRevisionConfigurationView({
  value,
}: {
  value: NovelRevisionConfiguration;
}) {
  return (
    <section
      aria-label="原配置章节修订结果"
      className="space-y-2 text-xs leading-5"
    >
      <p>
        检查点 {value.projection.checkpoint} · 章节目标 {value.recordedTargets}{" "}
        · 原尝试 {value.recordedWorkflows}
      </p>
      {value.projection.state !== "healthy" && (
        <p role="status">投影尚未追平或异常；不是完整业务历史。</p>
      )}
      {!value.groups.length && <p>没有已记录章节目标；不是历史零修订。</p>}
      {value.groups.map((g, i) => (
        <section
          key={i}
          aria-label={`原配置章节修订组 ${i + 1}`}
          className="space-y-1 rounded border border-line p-2"
        >
          <p>
            最初生成配置：
            {g.configuration.state === "recorded"
              ? `引擎 ${g.configuration.engineKind} · 请求模型 ${g.configuration.model.status === "recorded" ? `${g.configuration.model.modelId} · 服务 ${g.configuration.model.providerId ?? "未记录"} · 配置档 ${g.configuration.model.profileId ?? "未记录"}` : g.configuration.model.status === "invalid" ? "原配置无效" : "原配置未记录"}`
              : `配置未知（${g.configuration.state}）`}
          </p>
          <p>
            已可核采用 {g.summary.measuredTargets} / 目标 {g.summary.targets} ·
            已采用历史未知 {g.summary.unknownAdoptedTargets} · 尚未采用{" "}
            {g.summary.pendingTargets}
          </p>
          <p>
            {g.summary.mean
              ? `可核采用目标修订范围 ${g.summary.minimum}–${g.summary.maximum} 次 · 均值 ${g.summary.mean.numerator}/${g.summary.mean.denominator} 次（精确分数）`
              : "可核修订均值未建立；未知及未采用不补零"}
          </p>
          <details>
            <summary>本组原目标与尝试／采用身份</summary>
            {g.items.map((r) => (
              <p key={r.targetKey} className="break-all">
                原目标 {r.targetKey} · 原工作流 {r.workflowIds.join("、")} ·
                原采用 {r.adoption?.eventId ?? "尚未记录"} · 总修订{" "}
                {r.localRevisionCount ?? "未知"}
              </p>
            ))}
          </details>
        </section>
      ))}
      <p className="text-muted">
        按每目标最初生成请求字段归组；换模型重试仍留原组，不表示所有尝试均使用本组模型。仅完整已采用历史参加均值，未知与未采用独列，不是模型质量、实际远端版本、完整超参数、人工工作量或账单。模型修订阶段不包含；改编／规划另行推进。
      </p>
    </section>
  );
}
export function NovelRevisionEffortPanel({ projectId }: { projectId: string }) {
  const client = useStudio(),
    active = useRef(projectId),
    request = useRef<AbortController | undefined>(undefined);
  active.current = projectId;
  const [value, setValue] = useState<NovelRevisionEffortResult>(),
    [grouped, setGrouped] = useState<NovelRevisionConfiguration>(),
    [error, setError] = useState<string>(),
    [pending, setPending] = useState(false);
  useEffect(() => {
    setValue(undefined);
    setGrouped(undefined);
    setError(undefined);
    setPending(false);
    return () => request.current?.abort();
  }, [projectId]);
  const read = async (configurationGroups = false) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setValue(undefined);
    setGrouped(undefined);
    setError(undefined);
    setPending(true);
    try {
      if (configurationGroups) {
        const result = await client.novelRevisionEffort.configurationGroups(
          projectId,
          controller.signal,
        );
        if (!controller.signal.aborted && active.current === projectId)
          setGrouped(result);
      } else {
        const result = await client.novelRevisionEffort.read(
          projectId,
          controller.signal,
        );
        if (!controller.signal.aborted && active.current === projectId)
          setValue(result);
      }
    } catch (cause) {
      if (!controller.signal.aborted && active.current === projectId)
        setError(message(cause));
    } finally {
      if (!controller.signal.aborted && active.current === projectId)
        setPending(false);
    }
  };
  return (
    <section
      className="space-y-2 rounded border border-line p-3"
      aria-label="首次章节采用前实际修订"
    >
      <h3 className="font-medium">首次章节采用前实际修订</h3>
      <Button disabled={pending} onClick={() => void read()}>
        {pending ? "正在核对完整原修订分页…" : "读取首次章节采用前修订"}
      </Button>
      <Button disabled={pending} onClick={() => void read(true)}>
        读取按原配置分组的章节修订
      </Button>
      {pending && (
        <Button
          onClick={() => {
            request.current?.abort();
            setValue(undefined);
            setGrouped(undefined);
            setPending(false);
          }}
        >
          停止本次修订读取
        </Button>
      )}
      {error && (
        <p role="alert">{error} 原读取失败，不显示部分分页、旧结果或推定零。</p>
      )}
      {value && value.projectId === projectId && (
        <NovelRevisionEffortView value={value} />
      )}
      {grouped && grouped.projectId === projectId && (
        <NovelRevisionConfigurationView value={grouped} />
      )}
    </section>
  );
}
