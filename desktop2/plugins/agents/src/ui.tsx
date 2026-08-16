import { lazy, Suspense } from "react";
import { Link, useParams } from "react-router-dom";

import type { UiContribution } from "@dramaip/plugin-api";

const LazyAssistantDrawer = lazy(async () => ({
  default: (await import("./assistant-panel.tsx")).AssistantDrawerContent,
}));

function AssistantDrawerSlot() {
  return (
    <Suspense fallback={<div className="empty-state">正在加载智能助手…</div>}>
      <LazyAssistantDrawer />
    </Suspense>
  );
}

function AgentProjectCard() {
  const { projectId } = useParams();
  return (
    <Link className="tool-card" to={`/projects/${projectId}/agents`}>
      <span className="card-kicker">FIVE ENGINES</span>
      <h2>智能助手</h2>
      <p>五引擎对话、创作任务、差异预览、中断恢复与盲测。</p>
    </Link>
  );
}

export const agentsUi: readonly UiContribution[] = [
  {
    kind: "route",
    id: "agents.project",
    pluginId: "agents",
    path: "/projects/:projectId/agents",
    title: "智能助手",
    component: async () => ({
      default: (await import("./assistant-panel.tsx")).AssistantPage,
    }),
  },
  {
    kind: "route",
    id: "agents.tasks",
    pluginId: "agents",
    path: "/tasks",
    title: "创作任务",
    component: async () => ({
      default: (await import("./assistant-panel.tsx")).TasksPage,
    }),
  },
  {
    kind: "route",
    id: "agents.settings",
    pluginId: "agents",
    path: "/settings",
    title: "引擎设置",
    component: async () => ({
      default: (await import("./assistant-panel.tsx")).SettingsPage,
    }),
  },
  {
    kind: "navigation",
    id: "agents.tasks.navigation",
    pluginId: "agents",
    section: "settings",
    order: 20,
    label: "任务",
    to: "/tasks",
  },
  {
    kind: "navigation",
    id: "agents.settings.navigation",
    pluginId: "agents",
    section: "settings",
    order: 100,
    label: "设置",
    to: "/settings",
  },
  {
    kind: "slot",
    id: "agents.shell.assistant",
    pluginId: "agents",
    slot: "shell.assistant",
    order: 10,
    component: async () => ({ default: AssistantDrawerSlot }),
  },
  {
    kind: "slot",
    id: "agents.project.section",
    pluginId: "agents",
    slot: "project.section",
    order: 30,
    component: async () => ({ default: AgentProjectCard }),
  },
  {
    kind: "slot",
    id: "agents.chapter.auxiliary",
    pluginId: "agents",
    slot: "chapter.auxiliary",
    order: 10,
    component: async () => ({
      default: (await import("./assistant-panel.tsx")).ChapterAssistant,
    }),
  },
  {
    kind: "command",
    id: "agents.open-assistant",
    pluginId: "agents",
    title: "打开智能助手",
    run: () => {
      window.dispatchEvent(new Event("dramaip:open-assistant"));
    },
  },
];
