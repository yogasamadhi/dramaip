export type ConversationMessageState = 'streaming' | 'completed' | 'failed' | 'canceled'
export type ChatStreamTerminalEvent = 'completed' | 'failed'

export function conversationStateFromStatus(status: string): ConversationMessageState {
  if (status === 'succeeded') return 'completed'
  if (status === 'canceled') return 'canceled'
  if (status === 'in_progress' || status === 'cancellation_requested') return 'streaming'
  return 'failed'
}

export function chatStatusLabel(status: string): string {
  return ({
    succeeded: '已完成',
    canceled: '已取消',
    cancellation_requested: '取消已受理',
    in_progress: '生成中',
    failed: '生成未完成',
    not_found: '未找到',
  } as Record<string, string>)[status] ?? status
}

export function streamTerminalOutcome(
  terminalEvent: ChatStreamTerminalEvent | undefined,
  requestID: string,
): { state: ConversationMessageState; notice: string; refreshUsage: boolean } {
  if (terminalEvent === 'completed') {
    return { state: 'completed', notice: '生成完成。', refreshUsage: true }
  }
  if (terminalEvent === 'failed') {
    return {
      state: 'failed',
      notice: `生成未完成，可使用“恢复最近请求”查询结果。关联编号：${requestID}`,
      refreshUsage: true,
    }
  }
  return {
    state: 'failed',
    notice: `流式连接已结束但未收到完成状态，可使用“恢复最近请求”查询结果。关联编号：${requestID}`,
    refreshUsage: true,
  }
}
