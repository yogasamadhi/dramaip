import { ArrowLeft, Check, MonitorCog, Moon, PanelsTopLeft, Sparkles, Sun, Type } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useTheme, type EditorFont, type ThemePreference, type UiDensity } from '@/components/ThemeProvider'
import { cn } from '@/lib/utils'

type Option<T extends string> = {
  value: T
  title: string
  description: string
  icon: typeof Sun
}

const THEME_OPTIONS: Array<Option<ThemePreference>> = [
  { value: 'system', title: '跟随系统', description: '自动匹配 macOS 外观变化。', icon: MonitorCog },
  { value: 'light', title: '明亮工作室', description: '适合日间长时间阅读和审稿。', icon: Sun },
  { value: 'dark', title: '暗夜工作室', description: '降低暗光环境下的视觉刺激。', icon: Moon },
]

const DENSITY_OPTIONS: Array<Option<UiDensity>> = [
  { value: 'comfortable', title: '舒适', description: '保留更宽松的控件和卡片间距。', icon: PanelsTopLeft },
  { value: 'compact', title: '紧凑', description: '在小窗口显示更多辅助信息。', icon: PanelsTopLeft },
]

const EDITOR_FONT_OPTIONS: Array<Option<EditorFont>> = [
  { value: 'serif', title: '叙事衬线', description: '默认：更适合连续的小说正文阅读。', icon: Type },
  { value: 'sans', title: '清晰无衬线', description: '适合快速审阅和编辑操作。', icon: Type },
  { value: 'mono', title: '等宽校对', description: '适合逐字检查 Prompt 与结构化内容。', icon: Type },
]

function ChoiceGroup<T extends string>({
  label,
  description,
  options,
  value,
  onChange,
}: {
  label: string
  description: string
  options: Array<Option<T>>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold text-foreground">{label}</legend>
      <p className="-mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
      <div className="grid gap-2 md:grid-cols-3" role="radiogroup" aria-label={label}>
        {options.map((option) => {
          const Icon = option.icon
          const selected = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              className={cn(
                'studio-card-interactive relative flex min-h-28 items-start gap-3 rounded-xl border p-4 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                selected ? 'border-brand bg-brand-soft text-foreground shadow-sm' : 'bg-surface hover:bg-surface-raised',
              )}
            >
              <span className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', selected ? 'bg-brand text-brand-foreground' : 'bg-muted text-muted-foreground')}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{option.title}</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">{option.description}</span>
              </span>
              {selected && <Check className="h-4 w-4 shrink-0 text-brand" aria-label="已选中" />}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

export function AppearanceSettingsPage() {
  const navigate = useNavigate()
  const { theme, resolvedTheme, density, editorFont, setTheme, setDensity, setEditorFont } = useTheme()

  return (
    <div className="min-h-screen bg-canvas">
      <header className="flex min-h-[64px] items-center gap-3 border-b bg-surface/90 px-[var(--page-gutter)] backdrop-blur">
        <button
          type="button"
          aria-label="返回设置"
          onClick={() => navigate('/settings')}
          className="flex h-[var(--control-height)] w-[var(--control-height)] items-center justify-center rounded-[var(--radius-sm)] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-soft text-brand">
          <Sparkles className="h-4 w-4" />
        </span>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">外观与编辑偏好</h1>
          <p className="text-xs text-muted-foreground">偏好只保存在本机，不会改变项目内容。</p>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 p-[var(--page-gutter)] studio-page-enter">
        <Card>
          <CardHeader>
            <CardTitle>界面主题</CardTitle>
            <CardDescription>当前解析为{resolvedTheme === 'dark' ? '暗夜' : '明亮'}模式；切换时不会出现全屏闪白。</CardDescription>
          </CardHeader>
          <CardContent>
            <ChoiceGroup label="选择主题" description="可固定选择，也可在系统外观变化时自动跟随。" options={THEME_OPTIONS} value={theme} onChange={setTheme} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>工作区密度</CardTitle>
            <CardDescription>只调整共享控件和卡片的节奏；正文可读字号保持不低于 12px。</CardDescription>
          </CardHeader>
          <CardContent>
            <ChoiceGroup label="选择密度" description="小窗口可使用紧凑模式，减少辅助界面对创作画布的挤压。" options={DENSITY_OPTIONS} value={density} onChange={setDensity} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>编辑字体</CardTitle>
            <CardDescription>只影响 TipTap 正文；导航、表单与数据表继续使用清晰的界面字体。</CardDescription>
          </CardHeader>
          <CardContent>
            <ChoiceGroup label="选择正文样式" description="字体选择立即应用到章节编辑器，并在下次启动时恢复。" options={EDITOR_FONT_OPTIONS} value={editorFont} onChange={setEditorFont} />
          </CardContent>
        </Card>

        <section aria-label="设计系统预览" className="grid gap-3 md:grid-cols-3">
          <Card className="studio-card-interactive">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">内容表面</CardTitle>
              <CardDescription>canvas、surface 与 raised 层级</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border bg-surface-raised p-3 text-sm text-foreground">工作区卡片在两种主题下都保留边界与层级。</div>
            </CardContent>
          </Card>
          <Card className="studio-ai-surface studio-card-interactive">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm"><Sparkles className="h-4 w-4 text-ai" />AI 行动</CardTitle>
              <CardDescription>AI 行动使用全应用唯一的鸢尾紫强调色。</CardDescription>
            </CardHeader>
            <CardContent>
              <span className="inline-flex rounded-full bg-ai-soft px-2.5 py-1 text-xs font-medium text-ai">上下文已就绪</span>
            </CardContent>
          </Card>
          <Card className="studio-card-interactive">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">状态层级</CardTitle>
              <CardDescription>成功、提醒与阻断具有独立语义色。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <span className="studio-status-success rounded-full border px-2.5 py-1 text-xs font-medium">已保存</span>
              <span className="studio-status-warn rounded-full border px-2.5 py-1 text-xs font-medium">待复检</span>
              <span className="studio-status-block rounded-full border px-2.5 py-1 text-xs font-medium">已阻断</span>
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  )
}
