// RadarChart —— 纯 SVG 雷达图（无第三方依赖）
interface RadarAxis {
  label: string
  value: number // 0-100
}

interface Props {
  axes: RadarAxis[]
  color?: string
  size?: number
}

export function RadarChart({ axes, color = 'hsl(var(--primary))', size = 220 }: Props) {
  const cx = size / 2
  const cy = size / 2
  const radius = size / 2 - 28
  const n = axes.length
  if (n < 3) return null

  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2

  // 顶点坐标（按 value 缩放，value=100 在外圈）
  const point = (i: number, value: number) => {
    const r = (Math.min(100, Math.max(0, value)) / 100) * radius
    return [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))]
  }

  // 数据多边形
  const dataPoints = axes.map((a, i) => point(i, a.value).join(',')).join(' ')

  // 网格圈（25/50/75/100）
  const rings = [25, 50, 75, 100]
  // 轴线 + 标签
  const axisLines = axes.map((a, i) => {
    const [x, y] = point(i, 100)
    const [lx, ly] = point(i, 118)
    return { x1: cx, y1: cy, x2: x, y2: y, lx, ly, label: a.label }
  })

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[260px]">
      {rings.map((r) => (
        <polygon
          key={r}
          points={axes
            .map((_, i) => {
              const rr = (r / 100) * radius
              return [cx + rr * Math.cos(angle(i)), cy + rr * Math.sin(angle(i))].join(',')
            })
            .join(' ')}
          fill="none"
          stroke="currentColor"
          className="text-border"
          strokeWidth={0.5}
        />
      ))}
      {axisLines.map((l, i) => (
        <g key={i}>
          <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="currentColor" className="text-border" strokeWidth={0.5} />
          <text x={l.lx} y={l.ly} textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-[8px]">
            {l.label}
          </text>
        </g>
      ))}
      <polygon points={dataPoints} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={1.4} />
      {axes.map((a, i) => {
        const [x, y] = point(i, a.value)
        return <circle key={i} cx={x} cy={y} r={1.8} fill={color} />
      })}
    </svg>
  )
}
