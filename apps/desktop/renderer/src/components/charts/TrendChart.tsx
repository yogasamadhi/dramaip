// TrendChart —— 纯 SVG 多系列折线趋势图（无第三方依赖）
import { useMemo } from 'react'

export interface TrendSeries {
  key: string
  label: string
  color: string
  data: number[]
}

interface Props {
  series: TrendSeries[]
  height?: number
  /** 是否显示图例 */
  legend?: boolean
}

const W = 520
const PADDING = { top: 12, right: 12, bottom: 22, left: 26 }

export function TrendChart({ series, height = 180, legend = true }: Props) {
  const innerW = W - PADDING.left - PADDING.right
  const innerH = height - PADDING.top - PADDING.bottom

  const { points, maxLen } = useMemo(() => {
    const maxLen = Math.max(0, ...series.map((s) => s.data.length))
    const toXY = (data: number[]) =>
      data.map((v, i) => {
        const x = maxLen <= 1 ? PADDING.left : PADDING.left + (i / (maxLen - 1)) * innerW
        const y = PADDING.top + innerH - (Math.min(100, Math.max(0, v)) / 100) * innerH
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
    return { points: series.map((s) => toXY(s.data)), maxLen }
  }, [series, innerW, innerH])

  if (maxLen === 0) {
    return <p className="text-sm text-muted-foreground">暂无趋势数据</p>
  }

  // y 轴刻度 0/50/100
  const yTicks = [0, 25, 50, 75, 100]

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {/* 网格线 + y 刻度 */}
        {yTicks.map((t) => {
          const y = PADDING.top + innerH - (t / 100) * innerH
          return (
            <g key={t}>
              <line x1={PADDING.left} y1={y} x2={W - PADDING.right} y2={y} stroke="currentColor" className="text-border" strokeWidth={0.5} />
              <text x={PADDING.left - 4} y={y + 3} textAnchor="end" className="fill-muted-foreground text-[8px]">
                {t}
              </text>
            </g>
          )
        })}
        {/* x 轴 */}
        <line x1={PADDING.left} y1={PADDING.top + innerH} x2={W - PADDING.right} y2={PADDING.top + innerH} stroke="currentColor" className="text-border" strokeWidth={0.5} />

        {/* 折线 */}
        {series.map((s, i) => (
          <polyline
            key={s.key}
            points={points[i].join(' ')}
            fill="none"
            stroke={s.color}
            strokeWidth={1.6}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
      </svg>
      {legend && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 px-1">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
