import { useState } from "react";
import {
  Button,
  Card,
  Dialog,
  Drawer,
  Disclosure,
  DropdownMenu,
  EmptyState,
  Field,
  IconButton,
  InlineNotice,
  Input,
  LoadingState,
  NativeSelect,
  PageHeader,
  Panel,
  ScrollArea,
  Select,
  Tag,
  Tabs,
  Textarea,
  Toolbar,
  showToast,
} from "@dramaip/infra-ui-primitives";
import {
  IconEllipsisOutlineRegular as MoreHorizontal,
  IconSparkleRegular as Sparkles,
} from "@dramaip/infra-ui-primitives";
import { PipelineStepper } from "./pipeline-stepper";
import styles from "./ui-showcase.module.css";
import { copyText } from "./copy";
import { clsx } from "clsx";

/** Development-only component gallery for LM7 visual and interaction review. */
export function UiShowcase() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <section className={styles.c1}>
      <PageHeader
        eyebrow="LM7 · 设计系统"
        title={copyText("app/ui-showcase.1")}
        description="集中检查主题、控件状态、表单、浮层与反馈样式；此页面仅在开发环境可用。"
        actions={<Tag tone="success">{copyText("app/ui-showcase.2")}</Tag>}
      />

      <Panel className={styles.c2}>
        <Toolbar aria-label={copyText("app/ui-showcase.3")}>
          <Button variant="primary">{copyText("app/ui-showcase.4")}</Button>
          <Button variant="secondary">{copyText("app/ui-showcase.5")}</Button>
          <Button variant="subtle">{copyText("app/ui-showcase.6")}</Button>
          <Button variant="ghost">{copyText("app/ui-showcase.7")}</Button>
          <Button variant="danger">{copyText("app/ui-showcase.8")}</Button>
          <IconButton
            aria-label={copyText("app/ui-showcase.9")}
            variant="secondary"
          >
            <Sparkles aria-hidden="true" className={styles.c3} />
          </IconButton>
          <DropdownMenu>
            <DropdownMenu.Trigger asChild>
              <IconButton
                aria-label={copyText("app/ui-showcase.10")}
                variant="ghost"
              >
                <MoreHorizontal aria-hidden="true" className={styles.c3} />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              <DropdownMenu.Item>
                {copyText("app/ui-showcase.11")}
              </DropdownMenu.Item>
              <DropdownMenu.Item>
                {copyText("app/ui-showcase.12")}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu>
        </Toolbar>

        <Tabs defaultValue="form">
          <Tabs.List aria-label={copyText("app/ui-showcase.13")}>
            <Tabs.Trigger value="form">
              {copyText("app/ui-showcase.14")}
            </Tabs.Trigger>
            <Tabs.Trigger value="states">
              {copyText("app/ui-showcase.15")}
            </Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="form" className={styles.c4}>
            <Field label="项目名称" hint="统一字段说明与错误位置">
              <Input placeholder={copyText("app/ui-showcase.16")} />
            </Field>
            <Field label="创作阶段">
              <Select
                placeholder={copyText("app/ui-showcase.17")}
                options={[
                  { value: "novel", label: "小说写作" },
                  { value: "adapt", label: "改编" },
                  { value: "produce", label: "制作" },
                ]}
              />
            </Field>
            <Field className={styles.c5} label="页面说明">
              <Textarea placeholder={copyText("app/ui-showcase.18")} />
            </Field>
          </Tabs.Content>
          <Tabs.Content value="states" className={styles.c6}>
            <div className={styles.c7}>
              <Tag>{copyText("app/ui-showcase.19")}</Tag>
              <Tag tone="success">{copyText("app/ui-showcase.20")}</Tag>
              <Tag tone="warning">{copyText("app/ui-showcase.21")}</Tag>
              <Tag tone="danger">{copyText("app/ui-showcase.22")}</Tag>
            </div>
            <InlineNotice>{copyText("app/ui-showcase.23")}</InlineNotice>
            <InlineNotice tone="warning">
              {copyText("app/ui-showcase.24")}
            </InlineNotice>
          </Tabs.Content>
        </Tabs>
      </Panel>

      <div className={styles.c8}>
        <Card>
          <h2 className={styles.c9}>{copyText("app/ui-showcase.25")}</h2>
          <p className={styles.c10}>{copyText("app/ui-showcase.26")}</p>
          <div className={styles.c11}>
            <Button variant="secondary" onClick={() => setDialogOpen(true)}>
              {copyText("app/ui-showcase.27")}
            </Button>
            <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
              {copyText("app/ui-showcase.28")}
            </Button>
          </div>
        </Card>
        <ScrollArea className={styles.c12}>
          <LoadingState label="加载状态示例" />
        </ScrollArea>
      </div>

      <div className={styles.c13}>
        <Panel className={styles.c14}>
          <p className={styles.c15}>{copyText("app/ui-showcase.29")}</p>
          {[
            ["概览", false],
            ["故事", true],
            ["改编", false],
            ["制作", false],
            ["审核交付", false],
          ].map(([label, active]) => (
            <div
              key={String(label)}
              className={clsx(styles.c16, active ? styles.k1 : styles.k2)}
            >
              {label}
            </div>
          ))}
        </Panel>
        <Panel className={styles.c17}>
          <div className={styles.c18}>
            <div>
              <p className={styles.c9}>{copyText("app/ui-showcase.30")}</p>
              <p className={styles.c19}>{copyText("app/ui-showcase.31")}</p>
            </div>
            <Tag tone="info">{copyText("app/ui-showcase.32")}</Tag>
          </div>
          <p className={styles.c20}>{copyText("app/ui-showcase.33")}</p>
        </Panel>
      </div>

      <div className={styles.c8}>
        <Card>
          <div className={styles.c21}>
            <div>
              <p className={styles.c9}>{copyText("app/ui-showcase.34")}</p>
              <p className={styles.c22}>{copyText("app/ui-showcase.35")}</p>
            </div>
            <Tag tone="warning">{copyText("app/ui-showcase.36")}</Tag>
          </div>
          <div className={styles.c23}>
            <Button size="sm">{copyText("app/ui-showcase.37")}</Button>
            <Button size="sm" variant="primary">
              {copyText("app/ui-showcase.38")}
            </Button>
          </div>
        </Card>
        <Card>
          <p className={styles.c15}>{copyText("app/ui-showcase.39")}</p>
          <div className={styles.c24}>
            <div className={styles.c25}>
              <p className={styles.c26}>{copyText("app/ui-showcase.40")}</p>
              {copyText("app/ui-showcase.41")}
            </div>
            <div className={styles.c27}>
              <p className={styles.c28}>{copyText("app/ui-showcase.42")}</p>
              {copyText("app/ui-showcase.43")}
            </div>
          </div>
        </Card>
      </div>

      <div className={styles.c29}>
        <InlineNotice tone="danger">
          {copyText("app/ui-showcase.44")}
        </InlineNotice>
        <InlineNotice tone="warning">
          {copyText("app/ui-showcase.45")}
        </InlineNotice>
        <InlineNotice tone="success">
          {copyText("app/ui-showcase.46")}
        </InlineNotice>
      </div>

      <Panel className={styles.c2}>
        <PipelineStepper
          label="流水线进度示例"
          linkLabel="打开本步骤"
          steps={[
            {
              id: "s1",
              label: "确认来源",
              status: "ready",
              statusLabel: "已完成",
              detail: "来源与作者意图已确认。",
              to: "/__ui",
            },
            {
              id: "s2",
              label: "改编诊断",
              status: "needs-human",
              statusLabel: "等你确认",
              detail: "AI 草稿已生成，等待你审阅。",
              to: "/__ui",
            },
            {
              id: "s3",
              label: "整季方案",
              status: "pending",
              statusLabel: "尚未开始",
              detail: "完成诊断后可以开始。",
              to: "/__ui",
            },
          ]}
        />
        <div className={styles.c8}>
          <Disclosure summary="折叠说明示例">
            <p className={styles.c30}>{copyText("app/ui-showcase.47")}</p>
          </Disclosure>
          <NativeSelect
            aria-label={copyText("app/ui-showcase.48")}
            defaultValue="a"
          >
            <option value="a">{copyText("app/ui-showcase.49")}</option>
            <option value="b">{copyText("app/ui-showcase.50")}</option>
          </NativeSelect>
        </div>
        <Button
          variant="secondary"
          onClick={() =>
            showToast({
              message: "已移入回收站。",
              actionLabel: "撤销",
              onAction: () =>
                showToast({ message: "已恢复。", tone: "success" }),
            })
          }
        >
          {copyText("app/ui-showcase.51")}
        </Button>
      </Panel>

      <EmptyState
        title={copyText("app/ui-showcase.52")}
        description="说明为什么为空，并只提供一个明确的下一步。"
        action={
          <Button variant="primary">{copyText("app/ui-showcase.53")}</Button>
        }
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <Dialog.Content>
          <Dialog.Title>{copyText("app/ui-showcase.54")}</Dialog.Title>
          <Dialog.Description>
            {copyText("app/ui-showcase.55")}
          </Dialog.Description>
        </Dialog.Content>
      </Dialog>
      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <Drawer.Content>
          <Drawer.Title>{copyText("app/ui-showcase.56")}</Drawer.Title>
          <Drawer.Description>
            {copyText("app/ui-showcase.57")}
          </Drawer.Description>
        </Drawer.Content>
      </Drawer>
    </section>
  );
}
