#!/usr/bin/env node

import { createServer } from 'node:http'

const port = Number.parseInt(process.env.PORT ?? '8099', 10)

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  response.end(body)
}

async function readJson(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function providerReply(messages) {
  const asksForMemoryJson = messages.some(
    (message) => message.role === 'system' && message.content.includes('请只输出 JSON'),
  )
  if (asksForMemoryJson) {
    return JSON.stringify({
      summary: '用户正在探索一座会回应梦境的海上城市。',
      memories: [{ kind: 'theme', content: '偏爱带有希望感的奇幻成长主题', confidence: 0.91 }],
    })
  }
  const latest = [...messages].reverse().find((message) => message.role === 'user')?.content ?? ''
  return `如果把“${latest.slice(0, 80)}”里的选择反过来，人物最害怕失去什么？`
}

createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    sendJson(response, 200, { status: 'UP' })
    return
  }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    sendJson(response, 404, { error: 'not_found' })
    return
  }

  try {
    const payload = await readJson(request)
    const content = providerReply(Array.isArray(payload.messages) ? payload.messages : [])
    const promptTokens = Math.max(1, Math.ceil(JSON.stringify(payload.messages ?? []).length / 4))
    const completionTokens = Math.max(1, Math.ceil(content.length / 4))
    if (payload.stream === true) {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'close',
      })
      response.write(`data: ${JSON.stringify({
        choices: [{ delta: { content } }],
        usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
      })}\n\n`)
      response.end('data: [DONE]\n\n')
      return
    }
    sendJson(response, 200, {
      choices: [{ message: { role: 'assistant', content } }],
      usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
    })
  } catch {
    sendJson(response, 400, { error: 'invalid_request' })
  }
}).listen(port, '0.0.0.0', () => {
  process.stdout.write(`DramaIP E2E AI provider listening on ${port}\n`)
})
