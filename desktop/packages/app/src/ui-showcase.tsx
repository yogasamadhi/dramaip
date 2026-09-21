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
        title="尽意 DramaIP UI 组件"
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

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="space-y-2">
          <p className="text-xs font-semibold text-muted">导航与上下文</p>
          {[
            ["概览", false],
            ["故事", true],
            ["改编", false],
            ["制作", false],
            ["审核交付", false],
          ].map(([label, active]) => (
            <div
              key={String(label)}
              className={`rounded-md px-3 py-2 text-sm ${active ? "bg-brand-soft font-medium text-brand-strong" : "text-muted"}`}
            >
              {label}
            </div>
          ))}
        </Panel>
        <Panel className="lg:col-span-2">
          <div className="flex items-center justify-between border-b border-line pb-3">
            <div>
              <p className="font-semibold">第一章　雨夜来信</p>
              <p className="text-xs text-muted">刚刚已保存 · 1,286 字</p>
            </div>
            <StatusBadge tone="info">AI 生成中，可继续编辑</StatusBadge>
          </div>
          <p className="mt-4 rounded-lg bg-field p-5 font-editor text-lg leading-8">
            雨落在窗沿。她把信压在灯下，继续写下刚刚想到的新线索。
          </p>
        </Panel>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold">章节修订：第一章</p>
              <p className="mt-1 text-xs text-muted">当前项目 · 刚刚</p>
            </div>
            <StatusBadge tone="warning">等待采用</StatusBadge>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button size="sm">查看差异</Button>
            <Button size="sm" variant="primary">
              采用选中段落
            </Button>
          </div>
        </Card>
        <Card>
          <p className="text-xs font-semibold text-muted">三方差异与冲突</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-md bg-surface-muted p-3 text-sm">
              <p className="mb-2 font-medium">我的当前草稿</p>
              保留生成期间新增的线索。
            </div>
            <div className="rounded-md bg-brand-soft p-3 text-sm">
              <p className="mb-2 font-medium text-brand-strong">AI 候选稿</p>
              逐段选择后建立新的待确认预览。
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <InlineNotice tone="danger">
          保存失败：本机草稿仍在，可重新保存。
        </InlineNotice>
        <InlineNotice tone="warning">
          版本已变化：请比较后选择冲突段。
        </InlineNotice>
        <InlineNotice tone="success">
          结果已应用，并建立版本检查点。
        </InlineNotice>
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
