export interface DraftRecoveryRecord {
  version: 1
  value: string
  savedAt: string
}

const RECOVERY_PREFIX = 'sdns-draft-recovery:'

export function draftRecoveryKey(targetKey: string): string {
  return `${RECOVERY_PREFIX}${targetKey}`
}

export function readDraftRecovery(targetKey: string): DraftRecoveryRecord | undefined {
  try {
    const raw = window.localStorage.getItem(draftRecoveryKey(targetKey))
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as Partial<DraftRecoveryRecord>
    if (parsed.version !== 1 || typeof parsed.value !== 'string' || typeof parsed.savedAt !== 'string') return undefined
    return { version: 1, value: parsed.value, savedAt: parsed.savedAt }
  } catch {
    return undefined
  }
}

export function writeDraftRecovery(targetKey: string, value: string): void {
  try {
    const record: DraftRecoveryRecord = { version: 1, value, savedAt: new Date().toISOString() }
    window.localStorage.setItem(draftRecoveryKey(targetKey), JSON.stringify(record))
  } catch {
    // 本地恢复缓冲不可用时不阻断编辑；主保存失败状态仍会展示。
  }
}

export function clearDraftRecovery(targetKey: string): void {
  try {
    window.localStorage.removeItem(draftRecoveryKey(targetKey))
  } catch {
    // 忽略受限存储环境；下一次成功保存仍可覆盖主数据。
  }
}
