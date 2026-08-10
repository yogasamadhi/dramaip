import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'
import { clearDraftRecovery, readDraftRecovery, writeDraftRecovery } from '@/lib/draftRecovery'

export type DraftSaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'error' | 'recovered'

interface AutosaveDraftOptions<T> {
  targetKey: string
  initialValue: T
  serialize: (value: T) => string
  deserialize: (value: string) => T | undefined
  save: (value: T) => Promise<boolean>
  onSaved?: () => void
  delayMs?: number
}

interface AutosaveDraftResult<T> {
  value: T
  updateValue: (next: SetStateAction<T>) => void
  flush: () => Promise<boolean>
  discardRecovery: () => void
  status: DraftSaveState
  isDirty: boolean
}

type DraftFlushWindow = Window & {
  __sdnsFlushDrafts?: () => Promise<void>
}

const registeredFlushers = new Set<() => Promise<boolean>>()

function installGlobalDraftFlusher(): void {
  const target = window as DraftFlushWindow
  target.__sdnsFlushDrafts = async () => {
    await Promise.allSettled(Array.from(registeredFlushers, (flush) => flush()))
  }
}

/**
 * 编辑值始终先写入本地恢复缓冲，随后节流写入 SQLite。即使路由立即切换或窗口关闭，
 * flush 也会使用目标 ID 对应的保存函数，不会把旧草稿写到新对象。
 */
export function useAutosaveDraft<T>(options: AutosaveDraftOptions<T>): AutosaveDraftResult<T> {
  const { targetKey, initialValue, serialize, deserialize, save, onSaved, delayMs = 600 } = options
  const initialSerialized = serialize(initialValue)
  const initialRef = useRef(new Map<string, T>())
  const draftRef = useRef(new Map<string, T>())
  const serializerRef = useRef(new Map<string, (value: T) => string>())
  const saveRef = useRef(new Map<string, (value: T) => Promise<boolean>>())
  const onSavedRef = useRef(new Map<string, (() => void) | undefined>())
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const savingRef = useRef(new Map<string, Promise<boolean>>())
  const currentKeyRef = useRef(targetKey)
  const initialSaveState = initialStatus(targetKey, initialSerialized)
  const stateRef = useRef<DraftSaveState>(initialSaveState)
  const [value, setValue] = useState<T>(() => initialValue)
  const [status, setStatus] = useState<DraftSaveState>(initialSaveState)

  initialRef.current.set(targetKey, initialValue)
  serializerRef.current.set(targetKey, serialize)
  saveRef.current.set(targetKey, save)
  onSavedRef.current.set(targetKey, onSaved)
  if (!draftRef.current.has(targetKey)) {
    const recovery = readDraftRecovery(targetKey)
    draftRef.current.set(targetKey, recovery ? (deserialize(recovery.value) ?? initialValue) : initialValue)
  }

  const setCurrentStatus = useCallback((next: DraftSaveState, key: string) => {
    if (currentKeyRef.current !== key) return
    stateRef.current = next
    setStatus(next)
  }, [])

  const persist = useCallback(async (key: string): Promise<boolean> => {
    const existing = savingRef.current.get(key)
    if (existing) return existing
    const draft = draftRef.current.get(key)
    const saveDraft = saveRef.current.get(key)
    const encode = serializerRef.current.get(key)
    if (draft === undefined || !saveDraft || !encode) return false
    const job = (async () => {
      setCurrentStatus('saving', key)
      try {
        const ok = await saveDraft(draft)
        if (!ok) throw new Error('保存未确认')
        const latest = draftRef.current.get(key)
        if (latest !== undefined && encode(latest) !== encode(draft)) {
          writeDraftRecovery(key, encode(latest))
          setCurrentStatus('dirty', key)
          timersRef.current.set(key, window.setTimeout(() => {
            timersRef.current.delete(key)
            void persist(key)
          }, delayMs))
        } else {
          clearDraftRecovery(key)
          setCurrentStatus('saved', key)
          onSavedRef.current.get(key)?.()
          if (currentKeyRef.current === key) {
            window.setTimeout(() => setCurrentStatus('clean', key), 1200)
          }
        }
        return true
      } catch {
        const latest = draftRef.current.get(key) ?? draft
        writeDraftRecovery(key, encode(latest))
        setCurrentStatus('error', key)
        return false
      } finally {
        savingRef.current.delete(key)
      }
    })()
    savingRef.current.set(key, job)
    return job
  }, [setCurrentStatus])

  const schedule = useCallback((key: string) => {
    const timer = timersRef.current.get(key)
    if (timer) window.clearTimeout(timer)
    timersRef.current.set(key, window.setTimeout(() => {
      timersRef.current.delete(key)
      void persist(key)
    }, delayMs))
  }, [delayMs, persist])

  const flush = useCallback(async (): Promise<boolean> => {
    const key = currentKeyRef.current
    const timer = timersRef.current.get(key)
    if (timer) {
      window.clearTimeout(timer)
      timersRef.current.delete(key)
    }
    const activeSave = savingRef.current.get(key)
    if (activeSave) {
      const firstResult = await activeSave
      // 输入发生在第一次 IPC 保存期间时，persist 会安排下一次节流保存。
      // 关闭窗口或按下 Cmd/Ctrl+S 时不能把这一次节流留给即将销毁的页面。
      return firstResult && persist(key)
    }
    return persist(key)
  }, [persist])

  const updateValue = useCallback((next: SetStateAction<T>) => {
    const key = currentKeyRef.current
    const current = draftRef.current.get(key) as T
    const resolved = typeof next === 'function' ? (next as (previous: T) => T)(current) : next
    draftRef.current.set(key, resolved)
    const encode = serializerRef.current.get(key)
    if (encode) writeDraftRecovery(key, encode(resolved))
    setValue(resolved)
    setCurrentStatus('dirty', key)
    schedule(key)
  }, [schedule, setCurrentStatus])

  const discardRecovery = useCallback(() => {
    const key = currentKeyRef.current
    const initial = initialRef.current.get(key)
    if (initial === undefined) return
    clearDraftRecovery(key)
    draftRef.current.set(key, initial)
    setValue(initial)
    setCurrentStatus('clean', key)
  }, [setCurrentStatus])

  useEffect(() => {
    const previousKey = currentKeyRef.current
    if (previousKey === targetKey) {
      if (stateRef.current === 'clean' || stateRef.current === 'saved') {
        const current = draftRef.current.get(targetKey)
        const encode = serializerRef.current.get(targetKey)
        if (current !== undefined && encode?.(current) !== initialSerialized) {
          draftRef.current.set(targetKey, initialValue)
          setValue(initialValue)
        }
      }
      return
    }
    const previousTimer = timersRef.current.get(previousKey)
    if (previousTimer) {
      window.clearTimeout(previousTimer)
      timersRef.current.delete(previousKey)
    }
    void persist(previousKey)
    currentKeyRef.current = targetKey
    const recovery = readDraftRecovery(targetKey)
    const restored = recovery ? deserialize(recovery.value) : undefined
    const nextValue = restored ?? initialValue
    draftRef.current.set(targetKey, nextValue)
    setValue(nextValue)
    setCurrentStatus(restored ? 'recovered' : 'clean', targetKey)
  }, [deserialize, initialSerialized, initialValue, persist, setCurrentStatus, targetKey])

  useEffect(() => {
    registeredFlushers.add(flush)
    installGlobalDraftFlusher()
    const onBeforeUnload = () => { void flush() }
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void flush()
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      registeredFlushers.delete(flush)
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('keydown', onKeyDown)
      void flush()
    }
  }, [flush])

  const isDirty = status === 'dirty' || status === 'saving' || status === 'error' || status === 'recovered'
  return { value, updateValue, flush, discardRecovery, status, isDirty }
}

function initialStatus(targetKey: string, initialValue: string): DraftSaveState {
  const recovery = readDraftRecovery(targetKey)
  return recovery && recovery.value !== initialValue ? 'recovered' : 'clean'
}
