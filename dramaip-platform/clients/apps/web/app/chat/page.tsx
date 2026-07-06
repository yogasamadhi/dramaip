'use client'

import { useMutation } from '@tanstack/react-query'
import Link from 'next/link'
import { useState } from 'react'
import { apiClient } from '../../lib/api-client'
import { Button } from '../../components/ui/Button'

export default function ChatPage() {
  const [prompt, setPrompt] = useState('Give me a short-drama premise about a creator rebuilding their career.')
  const [provider, setProvider] = useState('openai-compatible')
  const [model, setModel] = useState('')

  const chat = useMutation({
    mutationFn: () =>
      apiClient.chat({
        provider,
        model: model || undefined,
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      }),
  })

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-slate-950">AI Chat</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Send a prompt through the BFF, AI Gateway, and quota service.
          </p>
        </div>
        <Link href="/account" className="text-sm text-slate-600">
          Account
        </Link>
      </div>

      <section className="mt-8 grid gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm">
            Provider
            <input
              className="h-10 rounded-md border border-slate-300 px-3"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
            />
          </label>
          <label className="grid gap-2 text-sm">
            Model
            <input
              className="h-10 rounded-md border border-slate-300 px-3"
              placeholder="Use provider default"
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
          </label>
        </div>
        <label className="grid gap-2 text-sm">
          Prompt
          <textarea
            className="min-h-36 rounded-md border border-slate-300 p-3"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <Button onClick={() => chat.mutate()} disabled={chat.isPending || prompt.trim().length === 0}>
          {chat.isPending ? 'Generating...' : 'Generate'}
        </Button>
      </section>

      {chat.error ? (
        <section className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
          Login first and configure the AI provider API key before chatting.
        </section>
      ) : null}

      {chat.data ? (
        <section className="mt-5 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-sm font-medium text-slate-500">
            {chat.data.provider} / {chat.data.model}
          </div>
          <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-800">{chat.data.content}</p>
          <div className="mt-5 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
            <div>Total tokens: {chat.data.total_tokens}</div>
            <div>Prompt: {chat.data.prompt_tokens}</div>
            <div>Completion: {chat.data.completion_tokens}</div>
          </div>
        </section>
      ) : null}
    </main>
  )
}
