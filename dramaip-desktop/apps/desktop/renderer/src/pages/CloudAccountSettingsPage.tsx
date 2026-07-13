import { useEffect, useState } from 'react'
import { ArrowLeft, Cloud, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { type CloudAuthStatus, type CloudContext, ipc } from '@/lib/ipc'

export function CloudAccountSettingsPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<CloudAuthStatus | undefined>()
  const [context, setContext] = useState<CloudContext | undefined>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const refresh = async () => {
    try {
      setError(undefined)
      setStatus(await ipc.cloudAuth.status())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法读取云端登录状态')
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const login = async () => {
    setBusy(true)
    try {
      setError(undefined)
      // The main process opens the system browser and owns the PKCE verifier,
      // callback server, and Keychain session. Renderer never receives tokens.
      setStatus(await ipc.cloudAuth.login())
      setContext(undefined)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '云端登录失败')
    } finally {
      setBusy(false)
    }
  }

  const logout = async () => {
    setBusy(true)
    try {
      setError(undefined)
      setStatus(await ipc.cloudAuth.logout())
      setContext(undefined)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '退出登录失败')
    } finally {
      setBusy(false)
    }
  }

  const loadContext = async () => {
    setBusy(true)
    try {
      setError(undefined)
      setContext(await ipc.cloudAuth.context())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法获取云端套餐信息')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    return ipc.cloudAI.onBalance(() => {
      // The settled balance is authoritative in Desktop BFF. Refresh from the
      // server instead of trusting a renderer-supplied decrement.
      void loadContext()
    })
  }, [])

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-6 py-8">
      <header className="flex items-center gap-3 border-b pb-5">
        <Button variant="ghost" size="icon" onClick={() => navigate('/settings')} aria-label="返回设置">
          <ArrowLeft />
        </Button>
        <Cloud className="h-5 w-5" />
        <div>
          <h1 className="text-lg font-semibold">云端账号与套餐</h1>
          <p className="mt-1 text-sm text-muted-foreground">使用系统浏览器登录；长期会话仅保存在系统 Keychain。</p>
        </div>
      </header>

      <section className="mt-6 rounded-lg border bg-card p-5">
        {status?.enabled === false ? (
          <p className="text-sm text-muted-foreground">云端登录尚未启用。本地创作和自有 API Key 配置仍可正常使用。</p>
        ) : status?.signedIn ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-600" />
              <div className="text-sm">
                <p className="font-medium">已登录 {status.user?.name || status.user?.email}</p>
                <p className="mt-1 text-muted-foreground">访问凭据只驻留主进程内存；刷新凭据由系统 Keychain 托管。</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void loadContext()} disabled={busy}>查询套餐与余额</Button>
              <Button variant="outline" onClick={() => void logout()} disabled={busy}>退出云端账号</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">登录会在系统默认浏览器中完成，不会使用嵌入式 WebView。</p>
            <Button onClick={() => void login()} disabled={busy || status?.configured === false}>
              {busy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Cloud className="mr-2 h-4 w-4" />}
              使用浏览器登录云端
            </Button>
            {status?.error ? <p className="text-sm text-amber-700">{status.error}</p> : null}
          </div>
        )}
        {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
      </section>

      {context ? (
        <section className="mt-5 rounded-lg border bg-card p-5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-medium">云端上下文</h2>
            <Button variant="ghost" size="sm" onClick={() => void loadContext()} disabled={busy}><RefreshCw className="mr-1 h-4 w-4" />刷新</Button>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-4 text-muted-foreground">
            <div><dt>套餐</dt><dd className="mt-1 font-medium text-foreground">{context.subscription.plan}（{context.subscription.status}）</dd></div>
            <div><dt>剩余额度</dt><dd className="mt-1 font-medium text-foreground">{context.tokenBalance.remainingTokens.toLocaleString()}</dd></div>
            <div><dt>总额度</dt><dd className="mt-1 font-medium text-foreground">{context.tokenBalance.quotaTokens.toLocaleString()}</dd></div>
            <div><dt>已使用</dt><dd className="mt-1 font-medium text-foreground">{context.tokenBalance.usedTokens.toLocaleString()}</dd></div>
          </dl>
        </section>
      ) : null}
    </div>
  )
}
