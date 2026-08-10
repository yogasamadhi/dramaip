// 模板变量渲染（ROADMAP v0.8 §3）—— 把 {{变量}} 占位符替换为用户提供的值
//
// 约定：
// - 占位符形如 {{varName}}（允许两侧空白）。
// - 未提供值的变量保留原占位符（交给模型按上下文补全），而非清空。
// - 同时收集模板中实际出现的变量名，便于前端表单生成。

/** 提取模板中所有 {{变量}} 占位符名（去重，保持出现顺序） */
export function extractTemplateVariables(content: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const re = /\{\{\s*([A-Za-z_][\w\u4e00-\u9fa5]*)\s*\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    const name = m[1]
    if (!seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}

/** 把模板中的 {{变量}} 替换为 variables 提供的值；未提供的变量保留占位符 */
export function renderTemplate(content: string, variables: Record<string, string>): string {
  if (!content) return ''
  return content.replace(/\{\{\s*([A-Za-z_][\w\u4e00-\u9fa5]*)\s*\}\}/g, (full, name: string) => {
    const v = variables[name]
    return v !== undefined && v !== null && v !== '' ? v : full
  })
}
