// 共享的空状态组件，统一各 Section 的「还没有 XX」展示。
// 替换 10+ 处重复的 `<p className="text-sm text-muted-foreground">还没有…</p>`。
import { type ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title?: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  if (!icon && !title && !description) {
    return null
  }
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      {icon && (
        <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">
          {icon}
        </div>
      )}
      {title && <p className="text-sm font-medium tracking-tight">{title}</p>}
      {description && <p className="max-w-sm text-xs text-muted-foreground">{description}</p>}
      {action}
    </div>
  )
}
