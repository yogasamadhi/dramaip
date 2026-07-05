'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '../../components/ui/Button'

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

type LoginInput = z.infer<typeof LoginSchema>

export default function LoginPage() {
  const form = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: '', password: '' },
  })

  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <h1 className="text-3xl font-semibold text-slate-950">Login</h1>
      <form className="mt-8 grid gap-4" onSubmit={form.handleSubmit(() => undefined)}>
        <label className="grid gap-2 text-sm">
          Email
          <input className="h-10 rounded-md border border-slate-300 px-3" {...form.register('email')} />
        </label>
        <label className="grid gap-2 text-sm">
          Password
          <input
            type="password"
            className="h-10 rounded-md border border-slate-300 px-3"
            {...form.register('password')}
          />
        </label>
        <Button type="submit">Login</Button>
      </form>
    </main>
  )
}
