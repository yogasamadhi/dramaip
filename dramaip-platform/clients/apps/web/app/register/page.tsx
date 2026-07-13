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
import { apiClient } from '../../lib/api-client'
import { safeNextPath } from '../../lib/routes'

const RegisterSchema = z.object({
  display_name: z.string().min(1, '请输入昵称').max(80, '昵称不能超过 80 个字符'),
  email: z.string().email('请输入有效邮箱'),
  password: z.string().min(8, '密码至少需要 8 位'),
})

type RegisterInput = z.infer<typeof RegisterSchema>

export default function RegisterPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const form = useForm<RegisterInput>({
    resolver: zodResolver(RegisterSchema),
    defaultValues: { display_name: '', email: '', password: '' },
  })

  useEffect(() => {
    apiClient.getSession().then(() => router.replace(currentNextPath())).catch(() => undefined)
  }, [router])

  async function handleRegister(input: RegisterInput) {
    try {
      setSubmitError(null)
      await apiClient.register(input)
      queryClient.clear()
      router.replace(currentNextPath())
    } catch (error) {
      setSubmitError(parseApiError(error, '注册失败，请稍后重试。').message)
    }
  }

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <h1 className="text-3xl font-semibold text-slate-950">注册</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        创建平台账号，用于订阅、额度管理和云端智能网关访问。
      </p>
      <form className="mt-8 grid gap-4" onSubmit={form.handleSubmit(handleRegister)}>
        <label className="grid gap-2 text-sm">
          昵称
          <input className="h-10 rounded-md border border-slate-300 px-3" {...form.register('display_name')} />
          {form.formState.errors.display_name ? (
            <span className="text-xs text-rose-600">{form.formState.errors.display_name.message}</span>
          ) : null}
        </label>
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
          {form.formState.isSubmitting ? '创建中...' : '创建账号'}
        </Button>
        {submitError ? <p className="text-sm text-rose-600">{submitError}</p> : null}
      </form>
      <p className="mt-6 text-sm text-slate-600">
        已有账号？{' '}
        <Link href="/login" className="font-medium text-brand-700">
          登录
        </Link>
      </p>
    </main>
  )
}

function currentNextPath() {
  if (typeof window === 'undefined') return '/account'
  return safeNextPath(new URLSearchParams(window.location.search).get('next'))
}
