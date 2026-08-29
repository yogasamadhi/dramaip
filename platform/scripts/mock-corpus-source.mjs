#!/usr/bin/env node

import { createServer } from 'node:http'

const port = Number.parseInt(process.env.PORT ?? '8091', 10)
const hits = new Map()

createServer((request, response) => {
  const key = request.url ?? '/'
  hits.set(key, (hits.get(key) ?? 0) + 1)
  if (request.method === 'GET' && key === '/health') {
    send(response, 200, 'text/plain', 'ok')
    return
  }
  if (request.method === 'GET' && key === '/robots.txt') {
    send(response, 200, 'text/plain', 'User-agent: *\nAllow: /\nCrawl-delay: 1\n')
    return
  }
  if (request.method === 'GET' && key === '/story') {
    const etag = '"dramaip-corpus-e2e-v1"'
    if (request.headers['if-none-match'] === etag) {
      response.writeHead(304, { ETag: etag })
      response.end()
      return
    }
    send(response, 200, 'text/html; charset=utf-8', [
      '<html><head><title>雨伞误会机制</title></head><body>',
      '<main>两个人都以为对方在抢同一把伞，最后发现伞属于路过的第三个人。',
      '机制是共享错误前提、逐步升级和第三方揭示。</main>',
      '<a href="/story-two">同域后续</a></body></html>',
    ].join(''), { ETag: etag, 'Last-Modified': 'Wed, 27 Aug 2026 00:00:00 GMT' })
    return
  }
  if (request.method === 'GET' && key === '/story-two') {
    send(response, 200, 'text/plain', '角色为了掩饰一个小谎言，不断制造更大的公开误会。')
    return
  }
  send(response, 404, 'text/plain', 'not found')
}).listen(port, '0.0.0.0', () => {
  process.stdout.write(`DramaIP E2E corpus source listening on ${port}\n`)
})

function send(response, status, contentType, body, headers = {}) {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  })
  response.end(body)
}
