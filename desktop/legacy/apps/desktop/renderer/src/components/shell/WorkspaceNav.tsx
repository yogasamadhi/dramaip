// 统一的工作台导航组件，消除 WorkspacePage 中 3 处重复的 WORKSPACE_NAV_GROUPS 渲染。
// 提供 list（侧栏列表，带激活态）和 dropdown（下拉菜单项）两种 variant。
import { WORKSPACE_NAV_GROUPS } from '@sdns/core'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface WorkspaceNavProps {
  /** 当前激活的 section key（仅 list variant 使用） */
  activeSection?: string
  /** 选中某项时的回调；key 为 section 或 'writing-room' */
  onSelect: (key: string) => void
}

/**
 * 列表变体：完整侧栏导航，分组标题 + 带激活态的按钮。
 */
export function WorkspaceNavList({ activeSection, onSelect }: WorkspaceNavProps) {
  return (
    <>
      {WORKSPACE_NAV_GROUPS.map((group) => (
        <div key={group.key} className="space-y-1">
          <div className="px-3 pb-1 pt-3 text-xs font-medium tracking-wide text-muted-foreground">{group.label}</div>
          {group.items.map((item) => {
            const active = activeSection === item.key
            return (
              <button
                key={item.key}
                onClick={() => onSelect(item.key)}
                aria-label={item.label}
                title={item.label}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex w-full items-center rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  active
                    ? 'bg-accent font-medium text-accent-foreground [box-shadow:inset_2px_0_0_hsl(var(--iris))]'
                    : 'text-foreground hover:bg-accent/60',
                )}
              >
                {item.label}
              </button>
            )
          })}
        </div>
      ))}
    </>
  )
}

/**
 * 下拉菜单变体：用于 DropdownMenuContent 内部，渲染分组标题 + 菜单项。
 */
export function WorkspaceNavDropdown({ onSelect }: WorkspaceNavProps) {
  return (
    <>
      {WORKSPACE_NAV_GROUPS.map((group) => (
        <div key={group.key} className="py-1">
          <div className="px-2 pb-1 pt-2 text-xs font-medium tracking-wide text-muted-foreground">{group.label}</div>
          {group.items.map((item) => (
            <DropdownMenuItem key={item.key} onClick={() => onSelect(item.key)}>
              {item.label}
            </DropdownMenuItem>
          ))}
        </div>
      ))}
    </>
  )
}
