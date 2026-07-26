import type { ChatInput } from '@sdns/core'

/**
 * Build the minimal prompt used to verify a configured chat model.
 *
 * Do not set maxTokens here. Reasoning models count thinking tokens against that
 * limit, so a tiny cap can produce a valid response with no final content and
 * make a working connection look broken.
 */
export function createModelConnectionTestInput(): ChatInput {
  return {
    messages: [
      { role: 'system', content: '连接测试。只回复 ok。' },
      { role: 'user', content: 'ping' },
    ],
    temperature: 0,
  }
}
