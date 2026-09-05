import type { Metadata } from 'next'
import { AppShell } from '../components/AppShell'
import { QueryProvider } from '../lib/query-client'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: '尽意 DramaIP — 本地优先的 AI IP 创作工作台',
    template: '%s · 尽意 DramaIP',
  },
  description: '尽作者之意，成万象之作。从灵感、小说、剧本到分镜与影像生产，创作者始终拥有最终采用权。',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <QueryProvider>
          <AppShell>{children}</AppShell>
        </QueryProvider>
      </body>
    </html>
  )
}
