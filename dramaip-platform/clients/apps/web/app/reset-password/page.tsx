'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '../../components/ui/Button'
import { parseApiError } from '../../lib/api-error'
import { apiClient } from '../../lib/api-client'

const schema = z.object({
  email: z.string().email('请输入有效邮箱'),
  code: z.string().regex(/^[A-Za-z2-7]{8}$/, '请输入邮件中的 8 位验证码'),
  password: z.string().min(8, '密码至少需要 8 位'),
})
type Input = z.infer<typeof schema>

export default function ResetPasswordPage() {
  const router = useRouter()
  const form = useForm<Input>({ resolver: zodResolver(schema), defaultValues: { email: '', code: '', password: '' } })
  const reset = useMutation({
    mutationFn: (input: Input) => apiClient.resetPassword({ ...input, code: input.code.toUpperCase() }),
    onSuccess: () => window.setTimeout(() => router.replace('/login'), 1000),
  })

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <h1 className="text-3xl font-semibold text-slate-950">重置密码</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">重置成功后，所有已有登录会话都会失效，需要使用新密码重新登录。</p>
      <form className="mt-8 grid gap-4" onSubmit={form.handleSubmit((values) => reset.mutate(values))}>
        <Field label="邮箱" error={form.formState.errors.email?.message}><input className="h-10 rounded-md border border-slate-300 px-3" autoComplete="email" {...form.register('email')} /></Field>
        <Field label="8 位验证码" error={form.formState.errors.code?.message}><input className="h-10 rounded-md border border-slate-300 px-3 font-mono uppercase tracking-[0.2em]" maxLength={8} autoComplete="one-time-code" {...form.register('code')} /></Field>
        <Field label="新密码" error={form.formState.errors.password?.message}><input type="password" className="h-10 rounded-md border border-slate-300 px-3" autoComplete="new-password" {...form.register('password')} /></Field>
        <Button type="submit" disabled={reset.isPending}>{reset.isPending ? '重置中...' : '保存新密码'}</Button>
      </form>
      {reset.isSuccess ? <p className="mt-4 text-sm text-emerald-700">密码已重置，正在跳转至登录页。</p> : null}
      {reset.error ? <ErrorText error={reset.error} /> : null}
      <Link href="/login" className="mt-6 inline-block text-sm font-medium text-brand-700">返回登录</Link>
    </main>
  )
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return <label className="grid gap-2 text-sm text-slate-700">{label}{children}{error ? <span className="text-xs text-rose-600">{error}</span> : null}</label>
}

function ErrorText({ error }: { error: unknown }) {
  const details = parseApiError(error, '密码重置暂不可用。')
  return <p className="mt-4 text-sm text-rose-700">{details.message}{details.trace_id ? `（追踪号：${details.trace_id}）` : ''}</p>
}
