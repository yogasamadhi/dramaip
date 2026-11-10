/** Copy of the system client: the settings page frame and its diagnostics section. */
export const zh = {
  "page.title": "设置中心",
  "page.description":
    "先配置模型服务商，再查看 Pi 状态、管理备份、诊断和外部连接。",
  "page.nav": "设置分类",
  "appearance.nav": "外观与编辑",
  "appearance.title": "外观、字体与语言",
  "appearance.description":
    "主题、字体和界面语言保存在本机设置中，并与应用栏中的外观菜单保持同步。",
  "diagnostics.nav": "高级诊断",
  "diagnostics.title": "诊断与安全",
  "diagnostics.description":
    "诊断信息只包含运行时、插件、数据库迁移和事件消费者的状态，不包含正文、密钥或文件绝对路径。",
  "diagnostics.collect": "收集诊断信息",
  "diagnostics.collecting": "正在收集…",
  "diagnostics.export": "导出诊断信息",
  "diagnostics.exported": "诊断信息已导出。",
  "diagnostics.cancelled": "已取消导出。",
  "diagnostics.failed": "操作没有完成：{message}",
  "diagnostics.fileName": "尽意-DramaIP-诊断信息.json",
  "diagnostics.vault": "本地凭据库：{state}",
  "diagnostics.vault.checking": "正在检查…",
  "diagnostics.vault.available":
    "可用，配置和凭据保存在 ~/.dramaip，不访问系统钥匙串。",
  "diagnostics.vault.unavailable": "不可用，请检查应用数据目录的写入权限。",
  "diagnostics.summary": "诊断摘要",
  "diagnostics.plugins": "插件",
  "diagnostics.migrations": "数据库迁移",
  "diagnostics.consumers": "事件消费者",
  "diagnostics.host": "桌面宿主",
  "diagnostics.host.healthy": "正常",
  "diagnostics.host.unavailable": "不可用",
};

/** English copy for the same keys. */
export const en: Record<keyof typeof zh, string> = {
  "page.title": "Settings",
  "page.description":
    "Set up a model provider first, then check Pi status and manage backups, diagnostics and external connections.",
  "page.nav": "Settings sections",
  "appearance.nav": "Appearance and editing",
  "appearance.title": "Appearance, fonts and language",
  "appearance.description":
    "The theme, fonts and interface language stay in this device's settings and follow the appearance menu in the app bar.",
  "diagnostics.nav": "Advanced diagnostics",
  "diagnostics.title": "Diagnostics and security",
  "diagnostics.description":
    "Diagnostics hold only the state of the runtime, plugins, database migrations and event consumers: no text, keys or absolute file paths.",
  "diagnostics.collect": "Collect diagnostics",
  "diagnostics.collecting": "Collecting…",
  "diagnostics.export": "Export diagnostics",
  "diagnostics.exported": "Diagnostics exported.",
  "diagnostics.cancelled": "Export cancelled.",
  "diagnostics.failed": "The action did not finish: {message}",
  "diagnostics.fileName": "DramaIP-diagnostics.json",
  "diagnostics.vault": "Local credential vault: {state}",
  "diagnostics.vault.checking": "checking…",
  "diagnostics.vault.available":
    "available; configuration and credentials stay in ~/.dramaip without accessing the system keychain.",
  "diagnostics.vault.unavailable":
    "unavailable; check write access to the app data folder.",
  "diagnostics.summary": "Diagnostics summary",
  "diagnostics.plugins": "Plugins",
  "diagnostics.migrations": "Database migrations",
  "diagnostics.consumers": "Event consumers",
  "diagnostics.host": "Desktop Host",
  "diagnostics.host.healthy": "Healthy",
  "diagnostics.host.unavailable": "Unavailable",
};
