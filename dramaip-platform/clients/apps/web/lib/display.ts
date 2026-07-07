export function planCodeLabel(value?: string) {
  const labels: Record<string, string> = {
    free: '免费版',
    basic: '基础版',
    pro: '专业版',
    premium: '高级版',
    creator: '创作者版',
    team: '团队版',
    enterprise: '企业版',
  }
  return value ? labels[value] ?? value : '-'
}

export function paymentProviderLabel(value?: string) {
  const labels: Record<string, string> = {
    simulated: '模拟支付',
    production: '生产支付',
    platform_seed: '平台预置',
    wechat_pay: '微信支付',
    alipay: '支付宝',
  }
  return value ? labels[value] ?? value : '-'
}

export function aiProviderLabel(value?: string) {
  const labels: Record<string, string> = {
    test: '测试服务商',
    'openai-compatible': '兼容协议服务商',
  }
  return value ? labels[value] ?? value : '-'
}

export function serviceLabel(value?: string) {
  const labels: Record<string, string> = {
    bff: '平台 BFF',
    'dramaip-bff': '平台 BFF',
    'bff-interface': '平台 BFF',
    'dramaip-bff-interface': '平台 BFF',
  }
  return value ? labels[value] ?? value : '-'
}

export function displayNameLabel(value?: string) {
  if (!value) return '-'
  if (value === 'Development Creator') return '开发创作者'
  return value
}
