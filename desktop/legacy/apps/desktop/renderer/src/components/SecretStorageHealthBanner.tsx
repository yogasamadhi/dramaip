import { AlertTriangle, ShieldCheck } from 'lucide-react'
import type { SecretStorageStatus } from '@/lib/ipc'
import { cn } from '@/lib/utils'

interface SecretStorageHealthBannerProps {
  status: SecretStorageStatus | null
  className?: string
}

export function SecretStorageHealthBanner({ status, className }: SecretStorageHealthBannerProps) {
  const health = status?.health
  if (!status || !health) return null

  const totals = health.totals
  const legacyCount = totals.unsafePlaintext + totals.legacyPlaintext + totals.encrypted
  const oldKeychainCount = totals.keychain
  const failedCount = status.lastMigration?.failed ?? 0
  const needsAction =
    !status.keychainAvailable ||
    oldKeychainCount > 0 ||
    legacyCount > 0 ||
    totals.unreadableEncrypted > 0 ||
    failedCount > 0
  const title = healthTitle(status, legacyCount, oldKeychainCount, failedCount)

  return (
    <div
      className={cn(
        'space-y-2 rounded-md border p-3 text-xs',
        needsAction ? 'border-destructive/40 bg-destructive/5' : 'border-primary/30 bg-primary/5',
        className,
      )}
    >
      <div className={cn('flex items-center gap-2 font-medium', needsAction ? 'text-destructive' : 'text-primary')}>
        {needsAction ? <AlertTriangle className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
        {title}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
        <span>本地凭据 {totals.localFile}</span>
        <span>旧钥匙串引用 {oldKeychainCount}</span>
        <span>旧版待迁移 {legacyCount}</span>
        <span>掩码 {totals.masked}</span>
        <span>不可读 {totals.unreadableEncrypted}</span>
        <span>空值 {totals.empty}</span>
      </div>
      <p className="text-muted-foreground">
        {healthMessage(status, legacyCount, oldKeychainCount, failedCount)}
      </p>
    </div>
  )
}

function healthTitle(
  status: SecretStorageStatus,
  legacyCount: number,
  oldKeychainCount: number,
  failedCount: number,
): string {
  if (failedCount > 0) return '密钥迁移有失败'
  if (status.health?.totals.unreadableEncrypted) return '存在不可读取的加密 Key'
  if (!status.keychainAvailable && legacyCount > 0) return '本地凭据存储不可用'
  if (oldKeychainCount > 0) return '旧钥匙串凭据需要重新输入'
  if (legacyCount > 0) return '仍有旧版 Key 待迁移'
  if (status.health?.totals.masked) return '存在掩码格式 Key'
  return '密钥健康正常'
}

function healthMessage(
  status: SecretStorageStatus,
  legacyCount: number,
  oldKeychainCount: number,
  failedCount: number,
): string {
  const migration = status.lastMigration
  const migrationText = migration
    ? `最近启动检查：尝试 ${migration.attempted}，已迁移 ${migration.migrated}，失败 ${migration.failed}。`
    : '尚无启动迁移记录。'

  if (failedCount > 0) {
    return `${migrationText} 失败项会保留原值；请重新保存对应配置。`
  }
  if (status.health?.totals.unreadableEncrypted) {
    return `${migrationText} 旧版系统加密值不会再读取，请重新输入对应 API Key。`
  }
  if (!status.keychainAvailable) {
    return legacyCount > 0
      ? `${migrationText} 修复本地用户数据目录权限后重启，应用会再次迁移旧版 Key。`
      : `${migrationText} 当前本地凭据文件不可用；新 Key 会被拒绝保存，且不会降级为 SQLite 明文。`
  }
  if (oldKeychainCount > 0) {
    return `${migrationText} 应用已停用系统钥匙串，不会再弹出授权窗口；请在对应配置中重新输入 API Key。`
  }
  if (legacyCount > 0) {
    return `${migrationText} 重启应用后会再次尝试迁移；失败项会保留原值，便于恢复。`
  }
  return `${migrationText} API Key 保存在用户数据目录的加密凭据文件中，SQLite 只保留引用，界面只显示掩码。`
}
