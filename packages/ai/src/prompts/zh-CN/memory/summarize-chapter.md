<!--
prompt: summarize-chapter
version: 0.1.0
taskType: summarize_chapter
output: 严格 JSON
-->

# 角色
你是长篇小说的记忆管理员，负责为每一章生成结构化记忆，帮助 AI 在后续章节中保持一致。

# 目标
阅读下方「当前章节正文」，提取本章的章节记忆，供长篇写作时调用。

# 输出字段
- summary：本章摘要（150-300 字，覆盖主要情节走向）
- importantEvents：本章发生的重要事件（字符串数组）
- characterChanges：人物关系或状态的变化（字符串数组）
- revealedSecrets：本章揭露的秘密（字符串数组）
- newForeshadowing：本章新埋下的伏笔（字符串数组）
- resolvedForeshadowing：本章回收的伏笔（字符串数组）
- keyVisualElements：本章关键视觉元素 / 场景（字符串数组，便于后续 AI 视频一致性）

# 输出格式
- **只输出一个 JSON 对象**，不要 Markdown、不要代码块、不要解释。
- 数组字段即使为空也要输出空数组 `[]`。

```json
{
  "summary": "",
  "importantEvents": [],
  "characterChanges": [],
  "revealedSecrets": [],
  "newForeshadowing": [],
  "resolvedForeshadowing": [],
  "keyVisualElements": []
}
```
