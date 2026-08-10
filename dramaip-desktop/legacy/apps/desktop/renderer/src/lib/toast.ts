// AI 失败提示工具：封装带「重试」按钮的 toast，并提供后端错误码到中文友好提示的映射。
import { toast } from 'sonner'

/** 已知的后端错误码 → 中文友好提示（未知错误码原样透传）。 */
const ERROR_CODE_MESSAGES: Record<string, string> = {
  cloud_quota_insufficient: '云端额度不足，请充值或切换为自有 API Key',
  cloud_unauthorized: '云端账号未登录或会话过期，请重新登录',
  cloud_timeout: '云端请求超时，请稍后重试',
  budget_exceeded: '已超出本次或每日 Token / 费用预算',
  model_not_configured: '尚未配置可用模型，请先在设置中添加',
  secret_unavailable: 'API Key 无法从系统凭据管理器读取',
}

/** 把后端返回的原始错误（可能含错误码或英文异常）转换为中文友好提示。 */
export function friendlyAiError(rawError: string | undefined): string {
  if (!rawError) return '未知错误'
  for (const [code, message] of Object.entries(ERROR_CODE_MESSAGES)) {
    if (rawError.includes(code)) return `${message}（${code}）`
  }
  return rawError
}

interface ToastAiErrorOptions {
  /** 原始错误信息（来自 res.error 或 catch 的 e.message），可为 undefined */
  message: string | undefined
  /** loading toast 的 id，用于替换；不传则新建 */
  id?: string | number
  /** 重试动作；提供时显示「重试」按钮 */
  retry?: () => void
  /** 重试按钮文案 */
  retryLabel?: string
}

/**
 * AI 失败时弹出带可选「重试」按钮的 toast。
 * - 有 retry：显示友好错误 + 重试按钮
 * - 无 retry：退化为普通 toast.error
 */
export function toastAiError({ message, id, retry, retryLabel = '重试' }: ToastAiErrorOptions) {
  const friendly = friendlyAiError(message)
  const baseLabel = 'AI 任务失败'
  if (retry) {
    return toast.error(`${baseLabel}：${friendly}`, {
      id,
      duration: 10000,
      action: { label: retryLabel, onClick: retry },
    })
  }
  return toast.error(`${baseLabel}：${friendly}`, { id })
}
