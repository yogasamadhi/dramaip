/** 将一个镜头移动到另一个镜头前；输入不变时返回原顺序副本。 */
export function moveStoryboardShot(ids: string[], sourceId: string, targetId: string): string[] {
  const sourceIndex = ids.indexOf(sourceId)
  const targetIndex = ids.indexOf(targetId)
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return [...ids]
  const next = [...ids]
  next.splice(sourceIndex, 1)
  next.splice(next.indexOf(targetId), 0, sourceId)
  return next
}

export function nudgeStoryboardShot(ids: string[], id: string, direction: -1 | 1): string[] {
  const index = ids.indexOf(id)
  const targetIndex = index + direction
  if (index < 0 || targetIndex < 0 || targetIndex >= ids.length) return [...ids]
  const next = [...ids]
  ;[next[index], next[targetIndex]] = [next[targetIndex], next[index]]
  return next
}
