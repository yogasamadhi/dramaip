// 允许以 ?raw 形式导入 prompt Markdown 文件（Vite 原生支持）
declare module '*.md?raw' {
  const content: string
  export default content
}
