import type { Metadata } from 'next'
import { AppShell } from '../components/AppShell'
import { QueryProvider } from '../lib/query-client'
import './globals.css'

export const metadata: Metadata = {
  title: 'DramaIP',
  description: '智能短剧 IP 创作平台',
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
