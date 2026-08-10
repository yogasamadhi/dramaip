// RadarChart —— 纯 SVG 雷达图（无第三方依赖）
import { useState } from 'react'

interface RadarAxis {
  label: string
  value: number // 0-100
}

interface Props {
  axes: RadarAxis[]
  color?: string
  size?: number
}

/** 雷达图始终配套可读数值表，避免仅凭颜色或图形面积判断。 */
export function RadarChart({ axes, color = 'hsl(var(--primary))', size = 220 }: Props) {
  const [activeAxis, setActiveAxis] = useState<number | null>(null)
  const cx = size / 2
  const cy = size / 2
  const radius = size / 2 - 32
  const n = axes.length
  if (n < 3) return null
  const angle = (index: number) => (Math.PI * 2 * index) / n - Math.PI / 2
  const point = (index: number, value: number) => {
    const r = (Math.min(100, Math.max(0, value)) / 100) * radius
    return [cx + r * Math.cos(angle(index)), cy + r * Math.sin(angle(index))] as const
  }
  const dataPoints = axes.map((axis, index) => point(index, axis.value).join(',')).join(' ')
  const axisLines = axes.map((axis, index) => {
    const [x, y] = point(index, 100)
    const [lx, ly] = point(index, 116)
    return { x1: cx, y1: cy, x2: x, y2: y, lx, ly, label: axis.label }
  })

  return (
    <div>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[260px]" role="img" aria-label="雷达图，可用键盘聚焦数据点读取各维度得分">
        <title>雷达图</title>
        {[25, 50, 75, 100].map((value) => <polygon key={value} points={axes.map((_, index) => { const rr = (value / 100) * radius; return [cx + rr * Math.cos(angle(index)), cy + rr * Math.sin(angle(index))].join(',') }).join(' ')} fill="none" stroke="currentColor" className="text-border" strokeWidth={0.5} />)}
        {axisLines.map((line, index) => <g key={index}><line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke="currentColor" className="text-border" strokeWidth={0.5} /><text x={line.lx} y={line.ly} textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-[10px]">{line.label}</text></g>)}
        <polygon points={dataPoints} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={1.4} />
        {axes.map((axis, index) => { const [x, y] = point(index, axis.value); return <circle key={axis.label} cx={x} cy={y} r={3.5} fill={color} tabIndex={0} className="cursor-pointer focus:outline-none" aria-label={`${axis.label}，${axis.value} 分`} onFocus={() => setActiveAxis(index)} onMouseEnter={() => setActiveAxis(index)} /> })}
      </svg>
      {activeAxis != null && <p className="text-xs text-muted-foreground" aria-live="polite">当前读数：{axes[activeAxis]?.label} · {axes[activeAxis]?.value} 分</p>}
      <details className="mt-2 rounded border p-2 text-xs"><summary className="cursor-pointer font-medium">查看维度数据表</summary><table className="mt-2 w-full text-left"><thead><tr className="border-b text-muted-foreground"><th className="p-1">维度</th><th className="p-1">得分</th></tr></thead><tbody>{axes.map((axis) => <tr key={axis.label} className="border-b"><td className="p-1">{axis.label}</td><td className="p-1">{axis.value}</td></tr>)}</tbody></table></details>
    </div>
  )
}
