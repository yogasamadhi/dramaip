/// <reference types="node" />

// 允许以 ?raw 形式导入 prompt Markdown（Vite 原生支持）。
// （packages/ai 自带同名声明，这里供 desktop 的 node 程序识别内联进来的 ai 源码。）
declare module '*.md?raw' {
  const content: string
  export default content
}
