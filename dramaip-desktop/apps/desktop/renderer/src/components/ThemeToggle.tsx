import { Moon, Sun, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme, type ThemeMode } from '@/components/ThemeProvider'
import { cn } from '@/lib/utils'

const OPTIONS: Array<{ value: ThemeMode; label: string; icon: LucideIcon }> = [
  { value: 'light', label: '明亮', icon: Sun },
  { value: 'dark', label: '暗夜', icon: Moon },
]

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()

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
            title={`${option.label}模式`}
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
