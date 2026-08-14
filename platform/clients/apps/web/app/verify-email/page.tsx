'use client'

import Link from 'next/link'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { RequireAuth } from '../../components/RequireAuth'
import { Button } from '../../components/ui/Button'
import { parseApiError } from '../../lib/api-error'
import { apiClient } from '../../lib/api-client'

export default function VerifyEmailPage() {
  const [code, setCode] = useState('')
  const session = useQuery({ queryKey: ['session'], queryFn: () => apiClient.getSession(), retry: false })
  const requestCode = useMutation({ mutationFn: () => apiClient.requestEmailVerification() })
  const verify = useMutation({ mutationFn: () => apiClient.verifyEmail({ code: code.trim().toUpperCase() }) })

  return (
    <RequireAuth>
      <main className="mx-auto max-w-md px-6 py-10">
        <h1 className="text-3xl font-semibold text-slate-950">验证邮箱</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          我们会把一次性验证码发送到 {session.data?.user.email || '你的注册邮箱'}。验证码只可使用一次，有效期为 15 分钟。
        </p>
        <section className="mt-8 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <Button type="button" variant="secondary" onClick={() => requestCode.mutate()} disabled={requestCode.isPending}>
            {requestCode.isPending ? '发送中...' : requestCode.isSuccess ? '重新发送验证码' : '发送验证码'}
          </Button>
          {requestCode.isSuccess ? <p className="mt-3 text-sm text-emerald-700">验证码已发送，请检查邮箱。</p> : null}
          {requestCode.error ? <ErrorText error={requestCode.error} /> : null}

          <form
            className="mt-6 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              verify.mutate()
            }}
          >
            <label className="grid gap-2 text-sm text-slate-700">
              8 位验证码
              <input
                className="h-10 rounded-md border border-slate-300 px-3 font-mono uppercase tracking-[0.2em]"
                value={code}
                maxLength={8}
                autoComplete="one-time-code"
                onChange={(event) => setCode(event.target.value.toUpperCase())}
              />
            </label>
            <Button type="submit" disabled={verify.isPending || code.trim().length !== 8}>
              {verify.isPending ? '验证中...' : '确认验证'}
            </Button>
          </form>
          {verify.isSuccess ? <p className="mt-3 text-sm text-emerald-700">邮箱已验证，可以继续管理订阅与额度。</p> : null}
          {verify.error ? <ErrorText error={verify.error} /> : null}
        </section>
        <Link href="/account" className="mt-6 inline-block text-sm font-medium text-brand-700">返回账号中心</Link>
      </main>
    </RequireAuth>
  )
}

function ErrorText({ error }: { error: unknown }) {
  const details = parseApiError(error, '邮箱验证暂不可用。')
  return <p className="mt-3 text-sm text-rose-700">{details.message}{details.trace_id ? `（追踪号：${details.trace_id}）` : ''}</p>
}
