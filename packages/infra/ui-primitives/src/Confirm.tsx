// Confirm: a promise-returning confirm dialog. One ConfirmProvider mounted at
// the render root presents every confirmDialog() request; a newer request
// declines the one still open.

import { useEffect, useState, type ReactNode } from 'react'
import { Button } from './Button.tsx'
import { useControlLabels } from './ControlLabels.tsx'
import { Dialog, DialogFooter } from './Dialog.tsx'
import css from './Confirm.module.css'

export type ConfirmDialogOptions = {
  title?: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  /** `danger` uses the danger title, confirm text and button. */
  tone?: 'default' | 'danger'
}

type ConfirmRequest = ConfirmDialogOptions & { resolve(accepted: boolean): void }

let present: ((request: ConfirmRequest) => void) | undefined

/**
 * Ask the user to confirm an action.
 * @param value - the description, or the full options.
 * @returns true when the user confirms; false on cancel, dismissal, or when no ConfirmProvider is mounted.
 */
export function confirmDialog(value: string | ConfirmDialogOptions): Promise<boolean> {
  const options = typeof value === 'string' ? { description: value } : value
  if (present === undefined) return Promise.resolve(false)
  const show = present
  return new Promise<boolean>(resolve => { show({ ...options, resolve }) })
}

/**
 * Present confirmDialog() requests for the tree below.
 * @returns the children followed by the confirm dialog.
 */
export function ConfirmProvider({ children }: { children?: ReactNode }) {
  const labels = useControlLabels()
  const [request, setRequest] = useState<ConfirmRequest>()

  useEffect(() => {
    present = next => {
      setRequest(current => {
        current?.resolve(false)
        return next
      })
    }
    return () => { present = undefined }
  }, [])

  const danger = request?.tone === 'danger'
  const finish = (accepted: boolean): void => {
    request?.resolve(accepted)
    setRequest(undefined)
  }

  return (
    <>
      {children}
      <Dialog open={request !== undefined} onOpenChange={open => { if (!open) finish(false) }}>
        <Dialog.Content hideClose className={css.confirm}>
          <Dialog.Title>{request?.title ?? (danger ? labels.dangerTitle : labels.confirmTitle)}</Dialog.Title>
          <Dialog.Description>{request?.description}</Dialog.Description>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { finish(false) }}>{request?.cancelLabel ?? labels.cancel}</Button>
            <Button variant={danger ? 'danger' : 'primary'} onClick={() => { finish(true) }}>
              {request?.confirmLabel ?? (danger ? labels.dangerConfirm : labels.confirm)}
            </Button>
          </DialogFooter>
        </Dialog.Content>
      </Dialog>
    </>
  )
}
