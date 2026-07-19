import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface ConfirmActionOptions {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

export interface PromptActionOptions extends ConfirmActionOptions {
  inputLabel: string
  defaultValue?: string
  placeholder?: string
}

interface ConfirmActionApi {
  confirm(options: ConfirmActionOptions): Promise<boolean>
  prompt(options: PromptActionOptions): Promise<string | null>
}

type PendingAction =
  | { kind: 'confirm'; options: ConfirmActionOptions; resolve: (value: boolean) => void }
  | { kind: 'prompt'; options: PromptActionOptions; resolve: (value: string | null) => void }

const ConfirmActionContext = createContext<ConfirmActionApi | null>(null)
let activeConfirmActionApi: ConfirmActionApi | null = null

/** 可在事件处理函数中直接调用；应用初始化前调用会明确失败而不是回退到原生阻塞对话框。 */
export function confirmAction(options: ConfirmActionOptions): Promise<boolean> {
  if (!activeConfirmActionApi) return Promise.reject(new Error('确认服务尚未初始化'))
  return activeConfirmActionApi.confirm(options)
}

export function promptAction(options: PromptActionOptions): Promise<string | null> {
  if (!activeConfirmActionApi) return Promise.reject(new Error('输入服务尚未初始化'))
  return activeConfirmActionApi.prompt(options)
}

/** 全局串行确认/输入服务，替代原生阻塞式 confirm/prompt。 */
export function ConfirmActionProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [inputValue, setInputValue] = useState('')

  const settle = useCallback((value: boolean | string | null) => {
    setPending((current) => {
      if (!current) return null
      if (current.kind === 'confirm') current.resolve(Boolean(value))
      else current.resolve(typeof value === 'string' ? value : null)
      return null
    })
  }, [])

  const confirm = useCallback((options: ConfirmActionOptions) => new Promise<boolean>((resolve) => {
    setPending((current) => {
      if (current?.kind === 'confirm') current.resolve(false)
      else if (current?.kind === 'prompt') current.resolve(null)
      return { kind: 'confirm', options, resolve }
    })
  }), [])

  const prompt = useCallback((options: PromptActionOptions) => new Promise<string | null>((resolve) => {
    setInputValue(options.defaultValue ?? '')
    setPending((current) => {
      if (current?.kind === 'confirm') current.resolve(false)
      else if (current?.kind === 'prompt') current.resolve(null)
      return { kind: 'prompt', options, resolve }
    })
  }), [])

  useEffect(() => {
    activeConfirmActionApi = { confirm, prompt }
    return () => { activeConfirmActionApi = null }
  }, [confirm, prompt])

  const options = pending?.options
  return (
    <ConfirmActionContext.Provider value={{ confirm, prompt }}>
      {children}
      <Dialog open={pending !== null} onOpenChange={(open) => { if (!open) settle(null) }}>
        <DialogContent aria-describedby="confirm-action-description">
          <DialogHeader>
            <DialogTitle>{options?.title}</DialogTitle>
            <DialogDescription id="confirm-action-description">{options?.description}</DialogDescription>
          </DialogHeader>
          {pending?.kind === 'prompt' && <div className="grid gap-2"><Label htmlFor="confirm-action-input">{pending.options.inputLabel}</Label><Input id="confirm-action-input" value={inputValue} placeholder={pending.options.placeholder} onChange={(event) => setInputValue(event.target.value)} autoFocus /></div>}
          <DialogFooter>
            <Button variant="outline" onClick={() => settle(null)}>{options?.cancelLabel ?? '取消'}</Button>
            <Button variant={options?.destructive ? 'destructive' : 'default'} onClick={() => settle(pending?.kind === 'prompt' ? inputValue : true)}>{options?.confirmLabel ?? '继续'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmActionContext.Provider>
  )
}

export function useConfirmAction(): ConfirmActionApi {
  const value = useContext(ConfirmActionContext)
  if (!value) throw new Error('useConfirmAction 必须在 ConfirmActionProvider 内使用')
  return value
}

export function deleteConfirmation(subject: string): ConfirmActionOptions {
  return {
    title: `删除${subject}？`,
    description: `将永久删除${subject}及其关联信息，当前操作不可撤销。`,
    confirmLabel: '删除',
    destructive: true,
  }
}
