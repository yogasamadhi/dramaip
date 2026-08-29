'use client'

import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { init, use as registerECharts } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useRef } from 'react'

registerECharts([BarChart, GridComponent, TooltipComponent, CanvasRenderer])

type UsagePoint = {
  date: string
  total_tokens: number
}

export default function UsageTrendChart({ points }: { points: UsagePoint[] }) {
  const node = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!node.current) return
    const chart = init(node.current)
    chart.setOption({
      tooltip: {},
      grid: { left: 32, right: 16, top: 24, bottom: 28 },
      xAxis: { type: 'category', data: points.map((point) => point.date) },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', data: points.map((point) => point.total_tokens), itemStyle: { color: '#2563eb' } }],
    })
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(node.current)
    return () => {
      observer.disconnect()
      chart.dispose()
    }
  }, [points])

  return <div ref={node} className="mt-6 h-64 w-full" aria-label="30 天用量趋势" />
}
