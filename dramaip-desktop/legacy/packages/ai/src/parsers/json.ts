// 从模型输出中提取 JSON（去掉 ``` 代码围栏、截取首个 JSON 结构）
export function extractJson(raw: string): unknown {
  const text = (raw ?? '').trim()
  if (!text) throw new Error('空输出')

  // 去掉 ```json ... ``` 代码围栏
  const fence = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/)
  const candidate = fence ? fence[1].trim() : text

  // 直接解析
  try {
    return JSON.parse(candidate)
  } catch {
    /* 继续尝试截取 */
  }

  // 截取首个 { ... } 或 [ ... ]
  const objStart = candidate.indexOf('{')
  const objEnd = candidate.lastIndexOf('}')
  if (objStart !== -1 && objEnd > objStart) {
    return JSON.parse(candidate.slice(objStart, objEnd + 1))
  }
  const arrStart = candidate.indexOf('[')
  const arrEnd = candidate.lastIndexOf(']')
  if (arrStart !== -1 && arrEnd > arrStart) {
    return JSON.parse(candidate.slice(arrStart, arrEnd + 1))
  }

  throw new Error('无法从模型输出中解析出 JSON')
}
