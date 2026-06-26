// OpenAI-compatible 模型 Provider（项目说明.md §9）
import type { ChatInput, ChatOutput, LLMProvider, ModelConfig } from '@sdns/core'

export interface OpenAICompatibleOptions {
  name: string
  baseUrl: string
  apiKey: string
  model: string
}

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '')
}

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string
  readonly model: string
  private readonly baseUrl: string
  private readonly apiKey: string

  constructor(opts: OpenAICompatibleOptions) {
    this.name = opts.name
    this.model = opts.model
    this.baseUrl = trimSlash(opts.baseUrl)
    this.apiKey = opts.apiKey
  }

  async chat(input: ChatInput): Promise<ChatOutput> {
    const url = `${this.baseUrl}/chat/completions`
    const body: Record<string, unknown> = {
      model: this.model,
      messages: input.messages,
      temperature: input.temperature ?? 0.85,
      stream: false,
    }
    if (typeof input.maxTokens === 'number') body.max_tokens = input.maxTokens
    if (input.responseFormat === 'json') body.response_format = { type: 'json_object' }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`模型请求失败 (HTTP ${res.status}): ${detail.slice(0, 500)}`)
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
      usage?: { total_tokens?: number }
    }

    const content = data?.choices?.[0]?.message?.content ?? ''
    if (!content) throw new Error('模型返回空内容')

    return { content, raw: data, tokenUsage: data?.usage?.total_tokens }
  }

  async *stream(input: ChatInput): AsyncIterable<string> {
    const url = `${this.baseUrl}/chat/completions`
    const body: Record<string, unknown> = {
      model: this.model,
      messages: input.messages,
      temperature: input.temperature ?? 0.85,
      stream: true,
    }
    if (typeof input.maxTokens === 'number') body.max_tokens = input.maxTokens
    if (input.responseFormat === 'json') body.response_format = { type: 'json_object' }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`模型请求失败 (HTTP ${res.status}): ${detail.slice(0, 500)}`)
    }
    if (!res.body) throw new Error('模型未返回可读取的流')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue

        const data = trimmed.slice(5).trim()
        if (!data || data === '[DONE]') continue

        try {
          const parsed = JSON.parse(data) as {
            choices?: { delta?: { content?: string }; message?: { content?: string } }[]
          }
          const token = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.message?.content ?? ''
          if (token) yield token
        } catch {
          // Ignore malformed keep-alive/provider metadata lines.
        }
      }
    }
  }
}

/** 从模型配置构造 Provider */
export function providerFromModelConfig(config: ModelConfig): LLMProvider {
  return new OpenAICompatibleProvider({
    name: config.provider || config.name,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
  })
}
