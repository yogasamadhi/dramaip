'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '../../components/ui/Button'
import { ACCESS_TOKEN_STORAGE_KEY, REFRESH_TOKEN_STORAGE_KEY, apiClient } from '../../lib/api-client'

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

type LoginInput = z.infer<typeof LoginSchema>

export default function LoginPage() {
  const router = useRouter()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const form = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: 'creator@example.com', password: 'password123' },
  })

  async function handleLogin(input: LoginInput) {
    try {
      setSubmitError(null)
      const session = await apiClient.login(input)
      window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, session.access_token)
      window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, session.refresh_token)
      router.push('/account')
    } catch {
      setSubmitError('Cannot reach the login service.')
    }
  }

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <h1 className="text-3xl font-semibold text-slate-950">Login</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        Use the seeded development account to enter the MVP account center.
      </p>
      <form className="mt-8 grid gap-4" onSubmit={form.handleSubmit(handleLogin)}>
        <label className="grid gap-2 text-sm">
          Email
          <input className="h-10 rounded-md border border-slate-300 px-3" {...form.register('email')} />
          {form.formState.errors.email ? (
            <span className="text-xs text-rose-600">{form.formState.errors.email.message}</span>
          ) : null}
        </label>
        <label className="grid gap-2 text-sm">
          Password
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
          {form.formState.isSubmitting ? 'Logging in...' : 'Login'}
        </Button>
        {submitError ? <p className="text-sm text-rose-600">{submitError}</p> : null}
      </form>
    </main>
  )
}
