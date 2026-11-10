// ToastQueue: queued status toasts built on the Radix Toast primitive. One
// ToastProvider mounted at the render root shows every showToast() request;
// it keeps the newest three. The presentational banner without a queue is
// `Toast`.

import { useEffect, useState, type ReactNode } from 'react'
import { Toast as ToastPrimitive } from 'radix-ui'
import { Button, IconButton } from './Button.tsx'
import { useControlLabels } from './ControlLabels.tsx'
import { IconCloseOutlineRegular } from './icons/index.tsx'
import css from './ToastQueue.module.css'

export type ToastOptions = {
  message: ReactNode
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
  /** One recovery action, e.g. undo; it needs `onAction`. */
  actionLabel?: string
  onAction?(): void | Promise<void>
  /** Time on screen; defaults to six seconds. */
  durationMs?: number
}

type ToastEntry = ToastOptions & { id: number }

const MAX_TOASTS = 3

let present: ((toast: ToastOptions) => void) | undefined
let nextId = 1

/**
 * Show a transient status message, optionally with one recovery action.
 * Reversible operations use it instead of a blocking confirm. A no-op when
 * no ToastProvider is mounted.
 */
export function showToast(toast: ToastOptions): void {
  present?.(toast)
}

/**
 * Present showToast() requests for the tree below.
 * @returns the children followed by the toast viewport.
 */
export function ToastProvider({ children }: { children?: ReactNode }) {
  const labels = useControlLabels()
  const [toasts, setToasts] = useState<ToastEntry[]>([])

  useEffect(() => {
    present = toast => {
      const id = nextId++
      setToasts(current => [...current.slice(-(MAX_TOASTS - 1)), { ...toast, id }])
    }
    return () => { present = undefined }
  }, [])

  const close = (id: number): void => {
    setToasts(current => current.filter(toast => toast.id !== id))
  }

  return (
    <ToastPrimitive.Provider label={labels.notification}>
      {children}
      {toasts.map(toast => (
        <ToastPrimitive.Root
          key={toast.id}
          duration={toast.durationMs ?? 6000}
          data-tone={toast.tone ?? 'neutral'}
          className={css.toast}
          onOpenChange={open => { if (!open) close(toast.id) }}
        >
          <ToastPrimitive.Description className={css.message}>{toast.message}</ToastPrimitive.Description>
          {toast.actionLabel !== undefined && toast.onAction !== undefined && (
            <ToastPrimitive.Action altText={toast.actionLabel} asChild>
              <Button size="sm" variant="ghost" onClick={() => { void toast.onAction?.() }}>{toast.actionLabel}</Button>
            </ToastPrimitive.Action>
          )}
          <ToastPrimitive.Close asChild>
            <IconButton size="sm" variant="ghost" aria-label={labels.dismiss}><IconCloseOutlineRegular /></IconButton>
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport label={labels.notifications} className={css.viewport} />
    </ToastPrimitive.Provider>
  )
}
