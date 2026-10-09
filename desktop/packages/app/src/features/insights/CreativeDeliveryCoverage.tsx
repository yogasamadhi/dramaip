import { useEffect, useRef, useState } from "react";
import type {
  CreativeDeliveryCoverage,
  CreativeDeliveryWindow,
} from "@dramaip/contracts/insights";
import { Button } from "@dramaip/ui-shared";
import { useStudio, message } from "../../studio-shared";

export function CreativeDeliveryCoverageView({
  value,
}: {
  value: CreativeDeliveryCoverage;
}) {
  return (
    <div
      aria-label="正式采用版本交付覆盖结果"
      className="space-y-2 text-xs leading-5"
    >
      <p>原检查点 {value.projection.checkpoint}</p>
      {value.groups.map((g) => (
        <section
          key={g.workflowPath}
          aria-label={
            g.workflowPath === "novel" ? "小说章节版本交付" : "改编剧本版本交付"
          }
          className="space-y-1 rounded border border-line p-2"
        >
          <p>
            {g.workflowPath === "novel"
              ? "小说章节版本 → 已保存稿件"
              : "改编剧本版本 → 已保存内部试制包"}
          </p>
          <p>
            已记录正式采用 {g.adoptedVersions} · 同版本采用后保存{" "}
            {g.deliveredVersions} · 尚无匹配保存 {g.notSavedVersions}
          </p>
          <p>
            {g.ratio
              ? `采用版本交付覆盖 ${g.ratio.numerator}/${g.ratio.denominator}（精确分数）`
              : "没有已记录采用版本；覆盖率未建立，不补零"}
          </p>
          <p>
            已保存但缺此前采用关联的版本{" "}
            {g.savedVersionsWithoutEarlierAdoption.length}（不加入成功分子）
          </p>
          <details>
            <summary>原版本与采用／保存回执</summary>
            {g.items.map((r) => (
              <p
                key={`${r.formalVersion.id}:${r.formalVersion.version}`}
                className="break-all"
              >
                原版本 {r.formalVersion.id} v{r.formalVersion.version} · 采用{" "}
                {r.adoption.eventId} · 保存 {r.firstSaved?.eventId ?? "未记录"}{" "}
                · 独立保存版本集合 {r.savedUnits}
              </p>
            ))}
          </details>
        </section>
      ))}
      <p className="text-muted">
        仅按已记录owner事件顺序关联同一正式版本；重复保存、换格式不增加采用版本分子。旧版保存不能替代新版，保存时缺此前采用不补关联。不是当前有效性、质量、授权、实际投稿或发行通过；小说不要求改编／媒体，改编试制包不要求媒体。
      </p>
    </div>
  );
}
export function CreativeDeliveryWindowView({
  value,
}: {
  value: CreativeDeliveryWindow;
}) {
  return (
    <div
      aria-label="七天交付与采用后保存耗时"
      className="space-y-2 text-xs leading-5"
    >
      <p>
        固定UTC观察窗 {value.window.from} → {value.window.to}
        （含边界，不是自然周）
      </p>
      {value.groups.map((g) => (
        <section
          key={g.workflowPath}
          className="space-y-1 rounded border border-line p-2"
        >
          <p>
            {g.workflowPath === "novel"
              ? "小说章节正式版本"
              : "改编剧本正式版本"}{" "}
            · 本窗新增采用 {g.adoptedInWindow} · 本窗首次匹配保存{" "}
            {g.deliveredInWindow}
          </p>
          <p>
            可核采用到Host保存 {g.measuredVersions} · 尚无匹配保存{" "}
            {g.pendingVersions} · 时钟异常／未来证据{" "}
            {g.clockInconsistentVersions}
          </p>
          <p>
            {g.duration
              ? `已知历史耗时范围 ${g.duration.minimumMs}–${g.duration.maximumMs} 毫秒 · 精确均值 ${g.duration.mean.numerator}/${g.duration.mean.denominator} 毫秒`
              : "采用后保存耗时未知，不补零"}
          </p>
          <details>
            <summary>原版本时间观察</summary>
            {g.items.map((r) => (
              <p
                key={`${r.formalVersion.id}:${r.formalVersion.version}`}
                className="break-all"
              >
                原版本 {r.formalVersion.id} v{r.formalVersion.version} · 原采用{" "}
                {r.adoptionEventId} · 首次保存 {r.savedEventId ?? "未记录"} ·{" "}
                {r.clockState} · {r.reason ?? "原时钟可核"} · 耗时{" "}
                {r.adoptionToSavedMs === null
                  ? "未知"
                  : `${r.adoptionToSavedMs} 毫秒`}
              </p>
            ))}
          </details>
        </section>
      ))}
      <p className="text-muted">
        新增采用与首次匹配保存是两个跨期计数，不能相除为本周转化率；重复导出不刷新首次时间。耗时只含可核的原采用到首次Host保存，包含人工审阅／等待，不是模型生成速度、全任务耗时或文学质量。旧历史、未来／倒退及回执时钟异常不补零；不认证当前有效性、授权、投稿或发行。
      </p>
    </div>
  );
}
export function CreativeDeliveryCoveragePanel({
  projectId,
}: {
  projectId: string;
}) {
  const client = useStudio(),
    active = useRef(projectId),
    request = useRef<AbortController | undefined>(undefined);
  active.current = projectId;
  const [value, setValue] = useState<CreativeDeliveryCoverage>(),
    [window, setWindow] = useState<CreativeDeliveryWindow>(),
    [error, setError] = useState<string>(),
    [pending, setPending] = useState(false);
  useEffect(() => {
    setValue(undefined);
    setWindow(undefined);
    setError(undefined);
    setPending(false);
    return () => request.current?.abort();
  }, [projectId]);
  const read = async (timed = false) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setValue(undefined);
    setWindow(undefined);
    setError(undefined);
    setPending(true);
    try {
      if (timed) {
        const result = await client.creativeOutcomes.deliveryWindow(
          projectId,
          controller.signal,
        );
        if (!controller.signal.aborted && active.current === projectId)
          setWindow(result);
      } else {
        const result = await client.creativeOutcomes.deliveryCoverage(
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
      aria-label="正式采用与保存的同版本交付覆盖"
      className="space-y-2 rounded border border-line p-3"
    >
      <h3 className="font-medium">正式采用与保存的同版本交付覆盖</h3>
      <p className="text-xs text-muted">
        明确读取完整本地台账，小说与改编分开核同版本；不启动模型、采用或导出。
      </p>
      <Button disabled={pending} onClick={() => void read()}>
        读取采用版本交付覆盖
      </Button>
      <Button disabled={pending} onClick={() => void read(true)}>
        读取七天交付与保存耗时
      </Button>
      {pending && (
        <>
          <p role="status">正在读取全部原台账…</p>
          <Button
            onClick={() => {
              request.current?.abort();
              setValue(undefined);
              setWindow(undefined);
              setPending(false);
            }}
          >
            停止读取交付覆盖
          </Button>
        </>
      )}
      {error && (
        <p role="alert">
          原交付覆盖读取失败：{error}。不保留旧结果或部分分母。
        </p>
      )}
      {value && <CreativeDeliveryCoverageView value={value} />}
      {window && <CreativeDeliveryWindowView value={window} />}
    </section>
  );
}
