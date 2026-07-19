// TrendChart —— 纯 SVG 多系列折线趋势图（无第三方依赖）
import { useMemo, useState } from 'react'

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
const PADDING = { top: 12, right: 12, bottom: 24, left: 30 }

/** 颜色只是辅助：图例按钮、焦点读数和数据表均能完整表达数值。 */
export function TrendChart({ series, height = 180, legend = true }: Props) {
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => new Set())
  const [activePoint, setActivePoint] = useState<{ seriesKey: string; index: number } | null>(null)
  const innerW = W - PADDING.left - PADDING.right
  const innerH = height - PADDING.top - PADDING.bottom
  const visibleSeries = series.filter((item) => !hiddenKeys.has(item.key))

  const { points, maxLen, coordinates } = useMemo(() => {
    const maxLen = Math.max(0, ...series.map((item) => item.data.length))
    const toCoordinate = (value: number, index: number) => ({
      x: maxLen <= 1 ? PADDING.left : PADDING.left + (index / (maxLen - 1)) * innerW,
      y: PADDING.top + innerH - (Math.min(100, Math.max(0, value)) / 100) * innerH,
    })
    const coordinates = new Map(series.map((item) => [item.key, item.data.map(toCoordinate)]))
    return {
      points: new Map(series.map((item) => [item.key, (coordinates.get(item.key) ?? []).map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`)])),
      coordinates,
      maxLen,
    }
  }, [series, innerW, innerH])

  if (maxLen === 0) return <p className="text-sm text-muted-foreground">暂无趋势数据</p>

  const selectedSeries = activePoint ? series.find((item) => item.key === activePoint.seriesKey) : undefined
  const selectedValue = selectedSeries && activePoint ? selectedSeries.data[activePoint.index] : undefined

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet" role="img" aria-label="趋势图，可用图例切换系列并用键盘聚焦数据点读取数值">
        <title>趋势图</title>
        {[0, 25, 50, 75, 100].map((tick) => {
          const y = PADDING.top + innerH - (tick / 100) * innerH
          return <g key={tick}><line x1={PADDING.left} y1={y} x2={W - PADDING.right} y2={y} stroke="currentColor" className="text-border" strokeWidth={0.5} /><text x={PADDING.left - 5} y={y + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">{tick}</text></g>
        })}
        <line x1={PADDING.left} y1={PADDING.top + innerH} x2={W - PADDING.right} y2={PADDING.top + innerH} stroke="currentColor" className="text-border" strokeWidth={0.5} />
        {visibleSeries.map((item) => <g key={item.key}><polyline points={(points.get(item.key) ?? []).join(' ')} fill="none" stroke={item.color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />{(coordinates.get(item.key) ?? []).map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={3.5} fill={item.color} className="cursor-pointer focus:outline-none" tabIndex={0} aria-label={`${item.label}，第 ${index + 1} 个数据点，${item.data[index]} 分`} onFocus={() => setActivePoint({ seriesKey: item.key, index })} onMouseEnter={() => setActivePoint({ seriesKey: item.key, index })} />)}</g>)}
      </svg>
      {selectedSeries && activePoint != null && <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">当前读数：{selectedSeries.label} · 第 {activePoint.index + 1} 个数据点 · {selectedValue ?? '—'} 分</p>}
      {legend && <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 px-1" aria-label="趋势图图例">{series.map((item) => { const hidden = hiddenKeys.has(item.key); return <button key={item.key} type="button" className={`inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs ${hidden ? 'text-muted-foreground line-through' : 'text-foreground'}`} aria-pressed={!hidden} onClick={() => setHiddenKeys((current) => { const next = new Set(current); if (next.has(item.key)) next.delete(item.key); else next.add(item.key); return next })}><span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} aria-hidden="true" />{item.label}</button> })}</div>}
      <details className="mt-2 rounded border p-2 text-xs"><summary className="cursor-pointer font-medium">查看趋势数据表</summary><div className="mt-2 overflow-x-auto"><table className="w-full min-w-[360px] text-left"><thead><tr className="border-b text-muted-foreground"><th className="p-1">序号</th>{series.map((item) => <th key={item.key} className="p-1">{item.label}</th>)}</tr></thead><tbody>{Array.from({ length: maxLen }, (_, index) => <tr key={index} className="border-b"><td className="p-1">{index + 1}</td>{series.map((item) => <td key={item.key} className="p-1">{item.data[index] ?? '—'}</td>)}</tr>)}</tbody></table></div></details>
    </div>
  )
}
