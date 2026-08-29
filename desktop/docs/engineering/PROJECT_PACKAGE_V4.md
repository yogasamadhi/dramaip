# `dramaip-project-package` schema v4

Desktop 接受 schema v1–v4；Web 只生成 v4。所有导入都先 Preview，Commit 后才创建项目和资源，并使用幂等键防止重试造成重复数据。

v4 在既有简报、卷季、章节、灵感卡片和 automation 资源之外，允许 `creativeIntelligence`：

- 用户选择的抽象语料卡；
- 项目因果节点和边；
- 观众认知状态；
- 脱敏后的来源谱系。

零章节创作简报是合法包。导入前可以修改项目名和模式。网页正文、完整灵感对话、长期记忆、个人创意指纹、IP 孪生缓存、账号信息和凭据永不进入项目包。

公共条目只复制创作机制和必要的来源标识；`quoted_from` 的短引用最多 500 个 Unicode 字符，并继续标记为需要人工权利复核。IP 孪生是可重建投影，不随包传输。
