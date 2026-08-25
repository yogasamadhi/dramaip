export const AGENTS_DESCRIPTOR = {
  id: "agents",
  version: "3.0.0-alpha.3",
  apiVersion: "2",
  requires: ["foundation", "automation", "writing", "knowledge"],
  provides: ["agents.runtime", "agents.evaluation"],
  stability: "internal",
} as const;

export const AGENTS_UI_CONTRIBUTIONS = [
  {
    id: "agents.slot.assistant",
    pluginId: "agents",
    kind: "slot",
    metadata: { slot: "shell.assistant", order: 10, title: "智能助手" },
  },
  {
    id: "agents.settings.engines",
    pluginId: "agents",
    kind: "settings",
    metadata: { section: "agent-engines", title: "智能引擎" },
  },
  {
    id: "agents.command.new-conversation",
    pluginId: "agents",
    kind: "command",
    metadata: { title: "新对话", command: "agents.new-conversation" },
  },
] as const;
