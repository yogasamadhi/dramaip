import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { Toaster } from '@/components/ui/sonner'
import './styles/globals.css'

function stackFrames(stack?: string): string[] | undefined {
  return stack
    ?.split('\n')
    .slice(1, 8)
    .map((line) => line.trim())
    .filter(Boolean)
}

function errorMeta(reason: unknown): Record<string, unknown> {
  if (reason instanceof Error) {
    return {
      type: 'Error',
      name: reason.name,
      messageLength: reason.message.length,
      stackFrames: stackFrames(reason.stack),
    }
  }
  if (typeof reason === 'string') {
    return { type: 'string', length: reason.length }
  }
  if (reason && typeof reason === 'object') {
    return {
      type: reason.constructor?.name ?? 'object',
      keys: Object.keys(reason).slice(0, 10),
    }
  }
  return { type: typeof reason }
}

function reportRendererError(message: string, reason: unknown): void {
  const rendererLog = window.api?.log?.renderer
  if (!rendererLog) return
  void rendererLog('error', 'runtime', message, errorMeta(reason)).catch(() => undefined)
}

window.addEventListener('error', (event) => {
  reportRendererError('unhandled error', event.error ?? event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  reportRendererError('unhandled rejection', event.reason)
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
      <Toaster />
    </HashRouter>
  </React.StrictMode>,
)
