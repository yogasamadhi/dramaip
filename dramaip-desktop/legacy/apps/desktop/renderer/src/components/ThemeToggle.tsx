import { MonitorCog, Moon, Sun, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme, type ThemePreference } from '@/components/ThemeProvider'
import { cn } from '@/lib/utils'

const OPTIONS: Array<{ value: ThemePreference; label: string; icon: LucideIcon }> = [
  { value: 'light', label: '明亮', icon: Sun },
  { value: 'dark', label: '暗夜', icon: Moon },
  { value: 'system', label: '系统', icon: MonitorCog },
]

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, resolvedTheme, setTheme } = useTheme()

  return (
    <div
      className={cn('inline-flex items-center rounded-md border bg-background p-1 shadow-sm', className)}
      role="group"
      aria-label="界面主题"
    >
      {OPTIONS.map((option) => {
        const Icon = option.icon
        const selected = theme === option.value
        return (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={selected ? 'secondary' : 'ghost'}
            className="h-8 px-2.5"
            aria-pressed={selected}
            title={option.value === 'system' ? `跟随系统（当前${resolvedTheme === 'dark' ? '暗夜' : '明亮'}）` : `${option.label}模式`}
            onClick={() => setTheme(option.value)}
          >
            <Icon />
            {option.label}
          </Button>
        )
      })}
    </div>
  )
}
