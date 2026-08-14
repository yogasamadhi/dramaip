export type ApiError = {
  code: string
  message: string
  trace_id?: string
  status?: number
}

export function parseApiError(error: unknown, fallback = '请求失败'): ApiError {
  const maybe = error as {
    response?: { status?: number; data?: { error?: string | { code?: string; message?: string; trace_id?: string } } }
    message?: string
  }
  const raw = maybe.response?.data?.error
  if (typeof raw === 'string') {
    return { code: raw, message: localizeApiMessage(raw, raw, fallback), status: maybe.response?.status }
  }
  if (raw) {
    const code = raw.code || fallback
    const message = raw.message || raw.code || fallback
    return {
      code,
      message: localizeApiMessage(code, message, fallback),
      trace_id: raw.trace_id,
      status: maybe.response?.status,
    }
  }
  return {
    code: fallback,
    message: localizeApiMessage(fallback, maybe.message || fallback, fallback),
    status: maybe.response?.status,
  }
}

export function isUnauthorized(error: unknown) {
  return parseApiError(error).status === 401
}

export function formatApiError(error: unknown, fallback = '请求失败') {
  const details = parseApiError(error, fallback)
  return `${details.message}${details.trace_id ? `（追踪号：${details.trace_id}）` : ''}`
}

function localizeApiMessage(code: string, message: string, fallback: string) {
  const key = `${code} ${message}`.toLowerCase()
  if (key.includes('unauthorized') || key.includes('unauthenticated') || key.includes('invalid token')) {
    return '请先登录后再继续。'
  }
  if (key.includes('permission') || key.includes('forbidden')) {
    return '当前账号没有权限执行此操作。'
  }
  if (key.includes('email delivery is not configured')) return '当前环境尚未配置邮件投递服务。'
  if (key.includes('email delivery unavailable')) return '邮件投递暂不可用，请稍后重试。'
  if (key.includes('email delivery endpoint is invalid')) return '邮件投递服务配置无效，请联系管理员。'
  if (key.includes('verification code')) return '验证码无效或已过期，请重新获取。'
  if (key.includes('email_verification_required')) return '请先完成邮箱验证，再创建订单。'
  if (key.includes('invalid credentials') || key.includes('invalid email') || key.includes('password')) {
    return '邮箱或密码不正确。'
  }
  if (key.includes('plan not found')) return '套餐不存在。'
  if (key.includes('missing_plan_id') || key.includes('missing plan')) return '请选择套餐后再继续。'
  if (key.includes('quota') || key.includes('insufficient')) return '模型额度不足。'
  if (key.includes('api key') || key.includes('provider')) return '当前环境尚未配置智能服务商。'
  if (key.includes('rate')) return '请求频率已达上限，请稍后再试。'
  if (key.includes('not found')) return '资源不存在或已被删除。'
  if (message === 'Network Error') return '网络连接失败，请检查服务是否已启动。'
  if (message === fallback) return fallback
  return message
}
