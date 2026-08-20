import { useState } from "react";
import {
  Button,
  Card,
  Dialog,
  Drawer,
  DropdownMenu,
  EmptyState,
  Field,
  IconButton,
  InlineNotice,
  Input,
  LoadingState,
  PageHeader,
  Panel,
  ScrollArea,
  Select,
  StatusBadge,
  Tabs,
  Textarea,
  Toolbar,
} from "@dramaip/ui-shared";
import { MoreHorizontal, Sparkles } from "lucide-react";

/** Development-only component gallery for LM7 visual and interaction review. */
export function UiShowcase() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <section className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        eyebrow="LM7 · 设计系统"
        title="DramaIP UI 组件"
        description="集中检查主题、控件状态、表单、浮层与反馈样式；此页面仅在开发环境可用。"
        actions={<StatusBadge tone="success">组件基线</StatusBadge>}
      />

      <Panel className="space-y-4">
        <Toolbar aria-label="组件操作示例">
          <Button variant="primary">主要操作</Button>
          <Button variant="secondary">次要操作</Button>
          <Button variant="subtle">低对比操作</Button>
          <Button variant="ghost">文本操作</Button>
          <Button variant="danger">危险操作</Button>
          <IconButton aria-label="智能操作" variant="secondary">
            <Sparkles aria-hidden="true" className="size-4" />
          </IconButton>
          <DropdownMenu>
            <DropdownMenu.Trigger asChild>
              <IconButton aria-label="更多组件操作" variant="ghost">
                <MoreHorizontal aria-hidden="true" className="size-4" />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              <DropdownMenu.Item>菜单项目</DropdownMenu.Item>
              <DropdownMenu.Item>另一个项目</DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu>
        </Toolbar>

        <Tabs defaultValue="form">
          <Tabs.List aria-label="组件分组">
            <Tabs.Trigger value="form">表单</Tabs.Trigger>
            <Tabs.Trigger value="states">状态</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="form" className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="项目名称" hint="统一字段说明与错误位置">
              <Input placeholder="输入项目名称" />
            </Field>
            <Field label="创作阶段">
              <Select
                placeholder="选择阶段"
                options={[
                  { value: "novel", label: "小说写作" },
                  { value: "adapt", label: "改编" },
                  { value: "produce", label: "制作" },
                ]}
              />
            </Field>
            <Field className="md:col-span-2" label="页面说明">
              <Textarea placeholder="输入多行内容" />
            </Field>
          </Tabs.Content>
          <Tabs.Content value="states" className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              <StatusBadge>待处理</StatusBadge>
              <StatusBadge tone="success">已完成</StatusBadge>
              <StatusBadge tone="warning">需复核</StatusBadge>
              <StatusBadge tone="danger">已阻塞</StatusBadge>
            </div>
            <InlineNotice>普通状态信息不会伪装成可点击按钮。</InlineNotice>
            <InlineNotice tone="warning">需要人工确认的提醒。</InlineNotice>
          </Tabs.Content>
        </Tabs>
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="font-semibold">浮层</h2>
          <p className="mt-1 text-sm text-muted">
            统一焦点锁定、Escape 和关闭语义。
          </p>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" onClick={() => setDialogOpen(true)}>
              打开弹窗
            </Button>
            <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
              打开抽屉
            </Button>
          </div>
        </Card>
        <ScrollArea className="h-40 rounded-xl border border-line bg-surface p-4">
          <LoadingState label="加载状态示例" />
        </ScrollArea>
      </div>

      <EmptyState
        title="空状态示例"
        description="说明为什么为空，并只提供一个明确的下一步。"
        action={<Button variant="primary">开始创建</Button>}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <Dialog.Content>
          <Dialog.Title>示例弹窗</Dialog.Title>
          <Dialog.Description>
            用于检查标题、正文与关闭交互。
          </Dialog.Description>
        </Dialog.Content>
      </Dialog>
      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <Drawer.Content>
          <Drawer.Title>示例抽屉</Drawer.Title>
          <Drawer.Description>用于辅助信息和次级工作流。</Drawer.Description>
        </Drawer.Content>
      </Drawer>
    </section>
  );
}
