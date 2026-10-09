import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { GenerationRecord } from "@dramaip/contracts/insights";
import { generationCostLabel } from "../../generation-cost";
import { useStudio, message } from "../../studio-shared";

export function GenerationCostHistory({
  record,
}: {
  record: GenerationRecord;
}) {
  const client = useStudio();
  const [opened, setOpened] = useState(false);
  const [cursor, setCursor] = useState<number>();
  const query = useQuery({
    queryKey: [
      "generation-cost-observations",
      record.projectId,
      record.id,
      cursor,
    ],
    queryFn: ({ signal }) =>
      client.generationCosts.list(
        record.id,
        record.projectId,
        cursor,
        25,
        signal,
      ),
    enabled: opened,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  return (
    <section className="mt-2 text-xs">
      <button
        type="button"
        className="rounded border border-line px-2 py-1"
        onClick={() => setOpened((value) => !value)}
      >
        {opened ? "收起费用观察" : "只读费用观察"}
      </button>
      {opened && (
        <div className="mt-2 space-y-2">
          <p>原记录 {record.id}；费用观察不合计，也不是结算凭证。</p>
          {(query.isPending || query.isFetching) && <p>正在读取原费用观察…</p>}
          {query.error && (
            <p role="alert">{message(query.error)}；未继续展示缓存费用。</p>
          )}
          {!query.error && !query.isFetching && query.data && (
            <>
              <p>已保存 {query.data.observationCount} 条；结算状态未知。</p>
              {query.data.legacyObservation && (
                <p>
                  {generationCostLabel({
                    ...record,
                    costObservation: query.data.legacyObservation,
                  })}
                  ；没有可认证的旧观察来源。
                </p>
              )}
              {query.data.items.map((item) => (
                <p key={item.sequence}>
                  观察 {item.sequence} ·{" "}
                  {generationCostLabel({
                    ...record,
                    costObservation: item.observation,
                  })}{" "}
                  · 本地记录时间 {item.observation.recordedAt ?? "未知"}
                </p>
              ))}
              {query.data.nextCursor && (
                <button
                  type="button"
                  className="rounded border border-line px-2 py-1"
                  onClick={() => setCursor(query.data!.nextCursor)}
                >
                  读取更早观察
                </button>
              )}
              {cursor !== undefined && (
                <button
                  type="button"
                  className="ml-2 rounded border border-line px-2 py-1"
                  onClick={() => setCursor(undefined)}
                >
                  返回最新观察
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
