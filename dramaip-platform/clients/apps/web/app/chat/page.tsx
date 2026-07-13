'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { RequireAuth } from '../../components/RequireAuth'
import { Button } from '../../components/ui/Button'
import { parseApiError } from '../../lib/api-error'
import { apiClient } from '../../lib/api-client'
import { aiProviderLabel } from '../../lib/display'
import { isSimulatedPaymentEnabled } from '../../lib/runtime'

export default function ChatPage() {
  const queryClient = useQueryClient()
  const [prompt, setPrompt] = useState('请给我一个关于创作者重建事业的短剧故事前提。')
  const [provider, setProvider] = useState(() => (isSimulatedPaymentEnabled() ? 'test' : 'openai-compatible'))
  const [model, setModel] = useState('')
  const [requestID, setRequestID] = useState(() => crypto.randomUUID())
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const tokenBalance = useQuery({
    queryKey: ['token-balance'],
    queryFn: () => apiClient.getTokenBalance(),
    retry: false,
  })

  const chat = useMutation({
    mutationFn: () =>
      apiClient.chat({
        request_id: requestID,
        idempotency_key: requestID,
        provider,
        model: model || undefined,
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['token-balance'] })
      await queryClient.invalidateQueries({ queryKey: ['token-usage'] })
      await queryClient.invalidateQueries({ queryKey: ['usage-trend'] })
    },
  })

  const spentTokens = chat.data
    ? Math.max(0, (tokenBalance.data?.remaining_tokens ?? chat.data.remaining_tokens) - chat.data.remaining_tokens)
    : 0

  return (
    <RequireAuth>
      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold text-slate-950">智能对话</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              通过平台云端智能网关调用模型，不需要在客户端暴露上游服务商密钥。
            </p>
            <p className="mt-2 text-sm text-slate-500">
              剩余额度：{tokenBalance.data ? tokenBalance.data.remaining_tokens.toLocaleString() : '加载中...'}
            </p>
          </div>
        </div>

        <section className="mt-8 grid gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <label className="grid gap-2 text-sm">
            提示词
            <textarea
              className="min-h-36 rounded-md border border-slate-300 p-3"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="w-fit text-sm font-medium text-brand-700"
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            {advancedOpen ? '收起高级设置' : '显示高级设置'}
          </button>
          {advancedOpen ? (
            <div className="grid gap-4 rounded-md bg-slate-50 p-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm">
                服务商
                <select
                  className="h-10 rounded-md border border-slate-300 px-3"
                  value={provider}
                  onChange={(event) => setProvider(event.target.value)}
                >
                  <option value="test">测试服务商</option>
                  <option value="openai-compatible">兼容协议服务商</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm">
                模型
                <input
                  className="h-10 rounded-md border border-slate-300 px-3"
                  placeholder="使用服务商默认模型"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                />
              </label>
              <label className="grid gap-2 text-sm md:col-span-2">
                幂等键（请求编号）
                <div className="flex gap-2">
                  <input
                    className="h-10 flex-1 rounded-md border border-slate-300 px-3"
                    value={requestID}
                    onChange={(event) => setRequestID(event.target.value)}
                  />
                  <Button type="button" onClick={() => setRequestID(crypto.randomUUID())}>
                    生成
                  </Button>
                </div>
              </label>
            </div>
          ) : null}
          <Button onClick={() => chat.mutate()} disabled={chat.isPending || prompt.trim().length === 0}>
            {chat.isPending ? '生成中...' : '生成'}
          </Button>
        </section>

        {chat.error ? (
          <section className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700">
            {classifyChatError(chat.error)}
          </section>
        ) : null}

        {chat.data ? (
          <section className="mt-5 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="text-sm font-medium text-slate-500">
              {aiProviderLabel(chat.data.provider)} / {chat.data.model}
            </div>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-800">{chat.data.content}</p>
            <div className="mt-5 grid gap-3 text-sm text-slate-600 md:grid-cols-3">
              <div>总消耗：{chat.data.total_tokens}</div>
              <div>提示词：{chat.data.prompt_tokens}</div>
              <div>生成内容：{chat.data.completion_tokens}</div>
              <div>剩余额度：{chat.data.remaining_tokens.toLocaleString()}</div>
              <div>本次扣减：{spentTokens.toLocaleString()}</div>
              <div>状态：{statusLabel(chat.data.status ?? 'succeeded')}</div>
            </div>
            {advancedOpen ? (
              <div className="mt-4 grid gap-2 text-xs text-slate-500">
                <div>请求：{chat.data.request_id}</div>
                <div>预留：{chat.data.reservation_id}</div>
              </div>
            ) : null}
          </section>
        ) : null}
      </main>
    </RequireAuth>
  )
}

function classifyChatError(error: unknown) {
  const apiError = parseApiError(error, '智能请求失败。')
  const text = `${apiError.code} ${apiError.message}`.toLowerCase()
  if (apiError.status === 402 || text.includes('quota')) return '模型额度不足。请升级套餐，或等待下个周期额度刷新。'
  if (apiError.status === 429 || text.includes('rate')) return '请求频率已达上限，请稍后再试。'
  if (text.includes('api key') || text.includes('provider')) return '当前环境尚未配置智能服务商。'
  if (text.includes('upstream')) return '上游智能服务商调用失败，未生成有效响应。'
  return apiError.message
}

function statusLabel(value?: string) {
  const labels: Record<string, string> = {
    succeeded: '成功',
    failed: '失败',
    canceled: '已取消',
  }
  return value ? labels[value] ?? value.replaceAll('_', ' ') : '-'
}
