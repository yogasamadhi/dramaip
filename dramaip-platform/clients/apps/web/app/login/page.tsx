'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '../../components/ui/Button'
import { parseApiError } from '../../lib/api-error'
import { apiClient, getAccessToken, saveSession } from '../../lib/api-client'
import { safeNextPath } from '../../lib/routes'

const LoginSchema = z.object({
  email: z.string().email('请输入有效邮箱'),
  password: z.string().min(8, '密码至少需要 8 位'),
})

type LoginInput = z.infer<typeof LoginSchema>

export default function LoginPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const form = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: 'creator@example.com', password: 'password123' },
  })

  useEffect(() => {
    if (getAccessToken()) {
      router.replace(currentNextPath())
    }
  }, [router])

  async function handleLogin(input: LoginInput) {
    try {
      setSubmitError(null)
      const session = await apiClient.login(input)
      saveSession(session)
      queryClient.clear()
      router.replace(currentNextPath())
    } catch (error) {
      setSubmitError(parseApiError(error, '登录失败，请检查账号和密码。').message)
    }
  }

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <h1 className="text-3xl font-semibold text-slate-950">登录</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        使用你的平台账号登录。本地开发环境可使用预置开发账号。
      </p>
      <form className="mt-8 grid gap-4" onSubmit={form.handleSubmit(handleLogin)}>
        <label className="grid gap-2 text-sm">
          邮箱
          <input className="h-10 rounded-md border border-slate-300 px-3" {...form.register('email')} />
          {form.formState.errors.email ? (
            <span className="text-xs text-rose-600">{form.formState.errors.email.message}</span>
          ) : null}
        </label>
        <label className="grid gap-2 text-sm">
          密码
          <input
            type="password"
            className="h-10 rounded-md border border-slate-300 px-3"
            {...form.register('password')}
          />
          {form.formState.errors.password ? (
            <span className="text-xs text-rose-600">{form.formState.errors.password.message}</span>
          ) : null}
        </label>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? '登录中...' : '登录'}
        </Button>
        {submitError ? <p className="text-sm text-rose-600">{submitError}</p> : null}
      </form>
      <p className="mt-6 text-sm text-slate-600">
        还没有账号？{' '}
        <Link href="/register" className="font-medium text-brand-700">
          注册
        </Link>
      </p>
    </main>
  )
}

function currentNextPath() {
  if (typeof window === 'undefined') return '/account'
  return safeNextPath(new URLSearchParams(window.location.search).get('next'))
}
