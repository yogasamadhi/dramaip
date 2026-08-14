import { useEffect, useState } from 'react'
import { BarChart3, Loader2, ShieldCheck } from 'lucide-react'
import { ipc } from '@/lib/ipc'
import { Button } from '@/components/ui/button'

export function AnalyticsConsentBanner() {
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    void ipc.analytics.getConsent()
      .then((settings) => { if (active) setVisible(settings.consent === 'unknown') })
      .catch(() => undefined)
    return () => { active = false }
  }, [])

  async function decide(consent: 'granted' | 'denied') {
    setBusy(true)
    try {
      await ipc.analytics.setConsent(consent)
      setVisible(false)
    } finally {
      setBusy(false)
    }
  }

  if (!visible) return null
  return (
    <aside className="fixed bottom-4 left-1/2 z-50 w-[min(680px,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border bg-popover p-5 shadow-2xl" role="dialog" aria-labelledby="analytics-consent-title" aria-describedby="analytics-consent-description">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-primary/10 p-2 text-primary"><BarChart3 className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <h2 id="analytics-consent-title" className="font-semibold">是否帮助改进 DramaIP？</h2>
          <p id="analytics-consent-description" className="mt-1 text-sm leading-6 text-muted-foreground">
            默认不上传。选择同意后，只发送随机安装标识、版本、OS、白名单事件、耗时区间和标准错误码；不发送账号、项目、标题、Prompt、素材名、路径或媒体。
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void decide('granted')} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}同意匿名分析</Button>
            <Button size="sm" variant="outline" onClick={() => void decide('denied')} disabled={busy}>保持关闭</Button>
          </div>
        </div>
      </div>
    </aside>
  )
}
