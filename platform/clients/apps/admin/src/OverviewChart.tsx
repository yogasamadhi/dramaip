import { useLayoutEffect, useRef } from "react";
import { PieChart } from "echarts/charts";
import { TooltipComponent } from "echarts/components";
import { init, use as useECharts } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import type { Overview } from "./api";

useECharts([PieChart, TooltipComponent, CanvasRenderer]);

export default function OverviewChart({ overview }: { overview: Overview }) {
  const node = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!node.current) return;
    const chart = init(node.current);
    chart.setOption({
      tooltip: { trigger: "item" },
      series: [
        {
          type: "pie",
          radius: ["54%", "78%"],
          label: { color: "#c9d5ee" },
          data: [
            { value: overview.paid_order_count, name: "已支付订单" },
            { value: overview.active_subscription_count, name: "活跃订阅" },
            {
              value: overview.open_exception_count,
              name: "待处理异常",
              itemStyle: { color: "#f08f62" },
            },
          ],
        },
      ],
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(node.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [overview]);

  return <div className="chart" ref={node} aria-label="运营概览图表" />;
}
