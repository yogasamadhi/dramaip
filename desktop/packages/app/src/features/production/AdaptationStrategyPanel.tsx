import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Button, confirmDialog } from "@dramaip/ui-shared";
import {
  AdaptationStrategyRequestSchema,
  AdaptationStrategySchema,
  AdaptationStrategyCatalogSchema,
  type AdaptationStrategyRequest,
  type AdaptationStrategy,
} from "@dramaip/contracts/production";
import { useStudio, message } from "../../studio-shared";
import { CreationWorkbench } from "../creation-workbench";
import { NarrativeSourceCoverage } from "../NarrativeSourceCoverage";
import { CreationWorkflowSchema } from "@dramaip/contracts/creation";
import {
  readOriginalStrategyWorkflow,
  readOriginalStrategyCandidate,
  successfulStrategyOwnerRead,
  strategyNavigationError,
  parseStrategyConfirmation,
  strategyConfirmationMatchesSource,
} from "../../strategy-exact-navigation";

export function AdaptationStrategyPanel({ projectId }: { projectId: string }) {
  const client = useStudio();
  const queries = useQueryClient();
  const [params, setParams] = useSearchParams();
  const navigationError = strategyNavigationError(params);
  const workflowId = params.get("workflowId")?.trim() || undefined;
  const requestedId = params.get("strategyId")?.trim() || undefined;
  const storageKey = `dramaip-strategy-source-confirmation:${projectId}`;
  const [confirmed, setConfirmed] = useState<
    AdaptationStrategyRequest | undefined
  >(() => {
    if (workflowId || requestedId || navigationError) return undefined;
    try {
      return parseStrategyConfirmation(
        window.localStorage.getItem(storageKey),
        projectId,
      );
    } catch {
      return undefined;
    }
  });
  const [focused, setFocused] = useState<string>();
  const [choice, setChoice] = useState<{ id: string; optionId: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const keys = useRef(new Map<string, string>());
  const catalog = useQuery({
    queryKey: ["adaptation-strategy-sources", projectId],
    queryFn: async () => {
      const value = AdaptationStrategyCatalogSchema.parse(
        await client.adaptationStrategies.sources(projectId),
      );
      if (value.projectId !== projectId)
        throw new Error("独立策略来源项目归属不符。");
      return value;
    },
    enabled: !navigationError,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 2000,
  });
  const original = useQuery({
    queryKey: [
      "strategy-original-workflow",
      projectId,
      workflowId,
      requestedId,
    ],
    queryFn: async () =>
      CreationWorkflowSchema.parse(await client.creation.get(workflowId!)),
    enabled: !navigationError && Boolean(workflowId),
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 1500,
  });
  const validWorkflow =
    workflowId && !navigationError
      ? readOriginalStrategyWorkflow(original, {
          projectId,
          workflowId,
          strategyId: requestedId,
        })
      : undefined;
  const request = workflowId
    ? validWorkflow?.input.adaptationStrategyRequest
    : confirmed;
  const history = useQuery({
    queryKey: ["adaptation-strategies", projectId],
    refetchInterval: 1500,
    enabled: !navigationError,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const items: AdaptationStrategy[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await client.adaptationStrategies.list(
          projectId,
          cursor,
          100,
        );
        if (page.items.some((item) => item.projectId !== projectId))
          throw new Error("策略历史项目归属不符。");
        items.push(...page.items);
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor))
          throw new Error("策略历史游标重复，尚未核全。");
        if (cursor) seen.add(cursor);
      } while (cursor);
      return items;
    },
  });
  const currentCatalog = successfulStrategyOwnerRead(catalog);
  const currentHistory = successfulStrategyOwnerRead(history);
  const id =
    requestedId ??
    (workflowId
      ? validWorkflow?.adaptationStrategyId
      : (focused ?? currentHistory?.[0]?.id));
  const candidate = useQuery({
    queryKey: ["adaptation-strategy", projectId, id, workflowId],
    queryFn: async () =>
      AdaptationStrategySchema.parse(
        await client.adaptationStrategies.get(id!),
      ),
    enabled: !navigationError && Boolean(id),
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 1500,
  });
  const value =
    id && !navigationError
      ? readOriginalStrategyCandidate(
          candidate,
          { projectId, strategyId: id, workflowId },
          validWorkflow,
        )
      : undefined;
  const accepted = currentHistory?.find(
    (item) => item.isCurrent && item.status === "adopted",
  );
  const refresh = () =>
    Promise.all(
      [
        "adaptation-strategy",
        "adaptation-strategies",
        "adaptation-strategy-sources",
        "season-plan-sources",
        "creation-workflow",
        "strategy-original-workflow",
        "creation-workflows",
        "change-preview",
      ].map((key) => queries.invalidateQueries({ queryKey: [key] })),
    );
  useEffect(
    () =>
      client.events.subscribe((event) => {
        if (
          /^(production\.|writing\.|workspace\.|automation\.creation-)/u.test(
            event.type,
          ) &&
          event.payload &&
          typeof event.payload === "object" &&
          (event.payload as { projectId?: string }).projectId === projectId
        )
          void refresh();
      }),
    [client, queries, projectId],
  );
  const confirmBasis = async () => {
    try {
      const fresh = await catalog.refetch();
      if (fresh.error || !fresh.data?.diagnosis)
        throw new Error("请先明确采用来源有效的诊断。");
      const request = AdaptationStrategyRequestSchema.parse({
        diagnosis: fresh.data.diagnosis,
        baseAdoptedId: fresh.data.adoptedStrategyId,
      });
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          format: "strategy-source-confirmation-v1",
          projectId,
          request,
        }),
      );
      setConfirmed(request);
      setParams(new URLSearchParams());
      setFocused(undefined);
      setChoice(undefined);
      setError(undefined);
    } catch (cause) {
      setError(message(cause));
    }
  };
  const readBusy =
    candidate.isFetching || Boolean(workflowId && original.isFetching);
  const action = async (kind: "adopt" | "discard") => {
    if (!value || busy || readBusy) return;
    const optionId = choice?.id === value.id ? choice.optionId : undefined;
    if (kind === "adopt" && !optionId) {
      setError("请明确选择这个候选中的一个策略，没有默认选项。");
      return;
    }
    if (
      !(await confirmDialog({
        title: kind === "adopt" ? "采用独立改编策略" : "放弃独立策略候选",
        description:
          kind === "adopt"
            ? "采用一个明确选项，保留旧版本；不自动生成季纲、改写原稿或采用其他候选。"
            : "只放弃这个候选，当前方向与原稿不变。",
        confirmLabel: kind === "adopt" ? "确认采用此策略" : "确认放弃此候选",
        tone: kind === "discard" ? "danger" : "default",
      }))
    )
      return;
    setBusy(true);
    setError(undefined);
    const fingerprint = JSON.stringify([
      value.id,
      value.stateVersion,
      kind,
      optionId,
    ]);
    const key = keys.current.get(fingerprint) ?? crypto.randomUUID();
    keys.current.set(fingerprint, key);
    try {
      const result =
        kind === "adopt"
          ? await client.adaptationStrategies.adopt(
              value.id,
              value.stateVersion,
              optionId!,
              key,
            )
          : await client.adaptationStrategies.discard(
              value.id,
              value.stateVersion,
              key,
            );
      setFocused(result.id);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
      await refresh();
    }
  };
  if (navigationError)
    return (
      <section aria-label="独立改编策略工作台">
        <p role="alert">{navigationError}</p>
      </section>
    );
  return (
    <section aria-label="独立改编策略工作台" className="space-y-5">
      <div className="rounded-lg border border-line bg-surface p-5">
        <h2 className="font-semibold">确认独立策略基准</h2>
        <p className="mt-2 text-sm text-muted">
          继承明确采用的诊断、作者意图与实际阅读表达，不扩张局部范围。模型提出
          2–3
          个不同动作的策略供比较，不自动选方向；制作风险不是报价，结构检查不是语义质量或权利核验。
        </p>
        <p className="mt-2 text-sm">
          当前可用诊断：
          {currentCatalog?.diagnosis
            ? `v${currentCatalog.diagnosis.version}${catalog.isFetching ? "（上次实际读取，正在重核）" : ""}`
            : "尚无来源有效的正式诊断"}{" "}
          ·{" "}
          <Link
            className="text-brand"
            to={`/projects/${projectId}/tools/adaptation-diagnosis`}
          >
            核对诊断
          </Link>
        </p>
        <Button
          className="mt-3"
          disabled={busy || catalog.isFetching || !currentCatalog?.diagnosis}
          onClick={() => void confirmBasis()}
        >
          确认独立策略来源
        </Button>
        {request && (
          <p className="mt-2 text-sm">
            本轮冻结诊断 v{request.diagnosis.version}
            ；来源变化、失败重试与重启不自动重绑。
            {workflowId
              ? "正在读取原工作流请求。"
              : "确认本身不发送模型；生成时再核对。"}
          </p>
        )}
        {accepted && (
          <p className="mt-2 text-sm">
            当前独立策略 v{accepted.version} · {accepted.selectedOptionId} ·{" "}
            {accepted.sourceState === "current" ? "来源有效" : "来源已变化"} ·{" "}
            <Link
              className="text-brand"
              to={`/projects/${projectId}/tools/season-plan`}
            >
              继续核对整季方案基准 →
            </Link>
          </p>
        )}
      </div>
      {workflowId &&
        !validWorkflow &&
        !original.error &&
        (!original.isFetchedAfterMount || original.isFetching) && (
          <p role="status">
            正在读取指定原策略运行；未恢复缓存候选或重新生成。
          </p>
        )}
      {workflowId &&
        (original.error ||
          (original.isFetchedAfterMount &&
            !original.isFetching &&
            original.data &&
            !validWorkflow)) && (
          <p role="alert" className="text-danger">
            指定工作流不存在或归属／操作不符；不会改用最新策略。
            {original.error ? message(original.error) : ""}
          </p>
        )}
      {(!workflowId || validWorkflow) &&
        (!requestedId || (workflowId && value)) && (
          <CreationWorkbench
            projectId={projectId}
            workflowId={workflowId}
            operation="adaptation-strategy"
            adaptationStrategyRequest={request}
            externalReview
            disabled={
              !request ||
              busy ||
              readBusy ||
              (!workflowId && Boolean(catalog.error || history.error))
            }
            startDisabled={
              !workflowId &&
              !strategyConfirmationMatchesSource(confirmed, currentCatalog)
            }
            resultLabel="独立改编策略"
            defaultInstruction="从已确认诊断和实际表达提出 2–3 个保留／合并／删减／重排／重构动作有真实差异的策略，不生成季纲或正文，不默认选择。"
            onStarted={(workflow) => {
              setParams(new URLSearchParams({ workflowId: workflow.id }));
            }}
            onCandidate={(workflow) => {
              if (
                !requestedId &&
                (!workflowId || workflowId === workflow.id) &&
                workflow.adaptationStrategyId
              )
                setParams(
                  new URLSearchParams({
                    workflowId: workflow.id,
                    strategyId: workflow.adaptationStrategyId,
                  }),
                );
              void refresh();
            }}
          />
        )}
      {currentHistory?.length ? (
        <div className="flex flex-wrap gap-2" aria-label="独立策略历史">
          {currentHistory.map((item) => (
            <Link
              key={item.id}
              className="rounded border border-line px-3 py-2 text-sm"
              to={`/projects/${projectId}/tools/adaptation-strategy?workflowId=${item.workflowId}&strategyId=${item.id}`}
            >
              策略 v{item.version} · {item.status}
              {item.isCurrent ? " · 当前正式" : ""}
            </Link>
          ))}
        </div>
      ) : null}
      {value && (
        <article
          data-adaptation-strategy-id={value.id}
          className="rounded-lg border border-line bg-surface p-5 space-y-4"
        >
          {!workflowId && requestedId && (
            <Link
              className="text-brand text-sm"
              to={`/projects/${projectId}/tools/adaptation-strategy?workflowId=${value.workflowId}&strategyId=${value.id}`}
            >
              打开此策略原运行（不切换最近运行）
            </Link>
          )}
          {readBusy && (
            <p role="status">
              正在重核原运行／策略；以下为上次实际原快照，操作暂不可用。
            </p>
          )}
          <h3 className="font-semibold">
            独立策略 v{value.version} · {value.status}
            {value.isCurrent ? " · 当前正式" : ""}
          </h3>
          <p className="text-sm">
            冻结诊断 v{value.basis.diagnosis.version}；
            {value.basis.chapters.length} 章身份，未读目录{" "}
            {value.basis.omittedChapters.length} 章；生成来源 {value.engineKind}
            。实际 usage／结算费用另以运行记录／回执为准，未知不等于零。
          </p>
          {value.basis.sourceBasis && (
            <NarrativeSourceCoverage
              basis={value.basis.sourceBasis}
              chapters={value.basis.chapters}
              label="策略实际阅读表达"
            />
          )}
          <p>{value.content.summary}</p>
          {value.sourceState === "stale" && (
            <p role="alert" className="text-sm text-danger">
              来源已变化：{value.staleReasons.join("；")}
              。保留原结果，不能覆盖当前方向。
            </p>
          )}
          <fieldset
            disabled={
              busy ||
              value.status !== "pending" ||
              value.sourceState !== "current"
            }
            className="space-y-3"
          >
            <legend className="font-semibold">
              比较并明确选择一个独立策略
            </legend>
            {value.content.options.map((option) => (
              <label
                key={option.id}
                className="block rounded border border-line p-4 space-y-2"
              >
                <span className="flex gap-2 items-center">
                  <input
                    type="radio"
                    name={`adaptation-strategy-${value.id}`}
                    aria-label={`选择独立策略 ${option.title}`}
                    checked={
                      choice?.id === value.id && choice.optionId === option.id
                    }
                    onChange={() =>
                      setChoice({ id: value.id, optionId: option.id })
                    }
                  />
                  <strong>{option.title}</strong>
                  {value.selectedOptionId === option.id ? " · 已正式采用" : ""}
                </span>
                <p className="text-sm">{option.rationale}</p>
                {(
                  [
                    "preserve",
                    "merge",
                    "remove",
                    "reorder",
                    "restructure",
                  ] as const
                ).map((key, index) => (
                  <p key={key} className="text-sm">
                    {["保留", "合并", "删减", "重排", "重构"][index]}：
                    {option[key].join("；") || "未提出"}
                  </p>
                ))}
                <p className="text-sm">
                  节奏：{option.rhythm} · 诊断发现：
                  {option.findingIds.join("、")}
                </p>
                <p className="text-sm">
                  风险：{option.risks.join("；")} · 制作 {option.productionRisk}
                  ：{option.productionNotes}
                </p>
              </label>
            ))}
          </fieldset>
          {value.status === "pending" && (
            <Button
              disabled={
                busy ||
                readBusy ||
                value.sourceState !== "current" ||
                choice?.id !== value.id
              }
              onClick={() => void action("adopt")}
            >
              采用此独立策略
            </Button>
          )}
          {["pending", "conflicted"].includes(value.status) && (
            <Button
              variant="ghost"
              disabled={busy || readBusy}
              onClick={() => void action("discard")}
            >
              放弃此策略候选
            </Button>
          )}
        </article>
      )}
      {[
        error,
        catalog.error && message(catalog.error),
        history.error && message(history.error),
        candidate.error && message(candidate.error),
        candidate.isFetchedAfterMount &&
          !candidate.isFetching &&
          !candidate.error &&
          candidate.data &&
          !value &&
          "指定候选归属或工作流不符，不展示其他对象。",
      ]
        .filter(Boolean)
        .map((text, index) => (
          <p role="alert" key={index} className="text-sm text-danger">
            {text}
          </p>
        ))}
    </section>
  );
}
