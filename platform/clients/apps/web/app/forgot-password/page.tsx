'use client'

import Link from 'next/link'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '../../components/ui/Button'
import { parseApiError } from '../../lib/api-error'
import { apiClient } from '../../lib/api-client'

const schema = z.object({ email: z.string().email('请输入有效邮箱') })
type Input = z.infer<typeof schema>

export default function ForgotPasswordPage() {
  const form = useForm<Input>({ resolver: zodResolver(schema), defaultValues: { email: '' } })
  const request = useMutation({ mutationFn: (input: Input) => apiClient.requestPasswordReset(input) })

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <h1 className="text-3xl font-semibold text-slate-950">找回密码</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">输入注册邮箱后，我们会发送一次性重置验证码。为保护账号安全，页面不会显示邮箱是否已注册。</p>
      <form className="mt-8 grid gap-4" onSubmit={form.handleSubmit((values) => request.mutate(values))}>
        <label className="grid gap-2 text-sm text-slate-700">
          邮箱
          <input className="h-10 rounded-md border border-slate-300 px-3" autoComplete="email" {...form.register('email')} />
          {form.formState.errors.email ? <span className="text-xs text-rose-600">{form.formState.errors.email.message}</span> : null}
        </label>
        <Button type="submit" disabled={request.isPending}>{request.isPending ? '发送中...' : '发送重置验证码'}</Button>
      </form>
      {request.isSuccess ? (
        <p className="mt-4 text-sm text-emerald-700">若该邮箱已注册，验证码已发送。<Link href="/reset-password" className="ml-1 font-medium underline">继续重置密码</Link></p>
      ) : null}
      {request.error ? <ErrorText error={request.error} /> : null}
      <Link href="/login" className="mt-6 inline-block text-sm font-medium text-brand-700">返回登录</Link>
    </main>
  )
}

function ErrorText({ error }: { error: unknown }) {
  const details = parseApiError(error, '暂时无法发送验证码。')
  return <p className="mt-4 text-sm text-rose-700">{details.message}{details.trace_id ? `（追踪号：${details.trace_id}）` : ''}</p>
}
