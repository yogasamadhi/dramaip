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
  const plaintextCount = totals.unsafePlaintext + totals.legacyPlaintext
  const failedCount = status.lastMigration?.failed ?? 0
  const needsAction = !status.encryptionAvailable || plaintextCount > 0 || totals.unreadableEncrypted > 0 || failedCount > 0
  const title = healthTitle(status, plaintextCount, failedCount)

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
        <span>加密 {totals.encrypted}</span>
        <span>明文 {plaintextCount}</span>
        <span>掩码 {totals.masked}</span>
        <span>不可读 {totals.unreadableEncrypted}</span>
        <span>空值 {totals.empty}</span>
      </div>
      <p className="text-muted-foreground">{healthMessage(status, plaintextCount, failedCount)}</p>
    </div>
  )
}

function healthTitle(status: SecretStorageStatus, plaintextCount: number, failedCount: number): string {
  if (failedCount > 0) return '密钥迁移有失败'
  if (status.health?.totals.unreadableEncrypted) return '存在不可读取的加密 Key'
  if (!status.encryptionAvailable && plaintextCount > 0) return '安全存储不可用'
  if (plaintextCount > 0) return '仍有明文 Key 待迁移'
  if (status.health?.totals.masked) return '存在掩码格式 Key'
  return '密钥健康正常'
}

function healthMessage(status: SecretStorageStatus, plaintextCount: number, failedCount: number): string {
  const migration = status.lastMigration
  const migrationText = migration
    ? `最近启动检查：尝试 ${migration.attempted}，已迁移 ${migration.migrated}，失败 ${migration.failed}。`
    : '尚无启动迁移记录。'

  if (failedCount > 0) {
    return `${migrationText} 失败项会保留原值；请检查系统钥匙串/凭据管理器后重启或重新保存配置。`
  }
  if (status.health?.totals.unreadableEncrypted) {
    return `${migrationText} 请确认当前系统账户可访问保存 Key 时使用的钥匙串或凭据管理器。`
  }
  if (!status.encryptionAvailable) {
    return plaintextCount > 0
      ? `${migrationText} 启用系统钥匙串/凭据管理器后重启，应用会自动迁移明文降级 Key。`
      : `${migrationText} 当前系统安全存储不可用，新 Key 默认拒绝保存，除非显式允许明文降级。`
  }
  if (plaintextCount > 0) {
    return `${migrationText} 重启应用或重新保存配置后会再次尝试加密迁移。`
  }
  return `${migrationText} API Key 仅在主进程解密使用，界面只显示掩码。`
}
