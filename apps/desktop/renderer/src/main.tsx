import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { Toaster } from '@/components/ui/sonner'
import { RendererErrorBoundary } from '@/components/RendererErrorBoundary'
import { ThemeProvider } from '@/components/ThemeProvider'
import { createRendererErrorMeta } from '@/lib/runtime-errors'
import './styles/globals.css'

function reportRendererError(message: string, reason: unknown): void {
  const rendererLog = window.api?.log?.renderer
  if (!rendererLog) return
  void rendererLog('error', 'runtime', message, createRendererErrorMeta(reason)).catch(() => undefined)
}

window.addEventListener('error', (event) => {
  reportRendererError('unhandled error', event.error ?? event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  reportRendererError('unhandled rejection', event.reason)
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <HashRouter>
        <RendererErrorBoundary>
          <App />
        </RendererErrorBoundary>
        <Toaster />
      </HashRouter>
    </ThemeProvider>
  </React.StrictMode>,
)
