import type { Metadata } from 'next'
import { AppShell } from '../components/AppShell'
import { QueryProvider } from '../lib/query-client'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'DramaIP Studio — AI 漫剧生产工作室',
    template: '%s · DramaIP Studio',
  },
  description: '把一部长篇 IP，安全地做成可审片、可复现、可交付的 AI 漫剧。',
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
