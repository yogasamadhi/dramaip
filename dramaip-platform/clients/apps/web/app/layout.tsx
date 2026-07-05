import type { Metadata } from 'next'
import { QueryProvider } from '../lib/query-client'
import './globals.css'

export const metadata: Metadata = {
  title: 'DramaIP',
  description: 'AI drama IP creation platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  )
}
