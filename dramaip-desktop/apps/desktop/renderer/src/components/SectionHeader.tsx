// 共享的 Section 头部组件，统一各 Section 的标题栏样式。
// 替换 18+ 处重复的 `border-b px-4 py-2 + h2` 模式。
import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface SectionHeaderProps {
  title: string
  icon?: ReactNode
  actions?: ReactNode
  variant?: 'sm' | 'base' | 'lg'
}

const VARIANT_CLASS: Record<NonNullable<SectionHeaderProps['variant']>, string> = {
  sm: 'text-sm',
  base: 'text-base',
  lg: 'text-lg',
}

export function SectionHeader({ title, icon, actions, variant = 'sm' }: SectionHeaderProps) {
  return (
    <div className="flex items-center gap-2 border-b px-4 py-2">
      {icon}
      <h2 className={cn('font-semibold', VARIANT_CLASS[variant])}>{title}</h2>
      {actions && <div className="ml-auto flex items-center gap-1">{actions}</div>}
    </div>
  )
}
