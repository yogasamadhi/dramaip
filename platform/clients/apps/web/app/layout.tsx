import type { Metadata } from 'next'
import { AppShell } from '../components/AppShell'
import { QueryProvider } from '../lib/query-client'
import { PRODUCT_POSITIONING } from '../lib/product-positioning'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: `${PRODUCT_POSITIONING.brand} — ${PRODUCT_POSITIONING.category}`,
    template: '%s · 尽意 DramaIP',
  },
  description: `${PRODUCT_POSITIONING.promise}。${PRODUCT_POSITIONING.description}`,
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
