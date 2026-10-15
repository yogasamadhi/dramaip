import type { ReactNode } from "react";

/** Presentation only: opting into compatibility never starts or migrates work. */
export function LegacyEpisodeCompatibility(props: {
  children: ReactNode;
  explicit?: boolean;
}) {
  return (
    <details
      key={String(Boolean(props.explicit))}
      open={props.explicit || undefined}
      aria-label="旧 episode 兼容路径"
      className="rounded-lg border border-line bg-surface p-4"
    >
      <summary className="cursor-pointer text-sm font-medium text-muted">
        旧版流程：一次生成本集剧本与分镜
      </summary>
      <p className="my-3 text-sm text-muted">
        保留旧版生成记录与链接。旧版流程会一次写入剧本、场景与分镜；新项目建议使用上方的逐步开发。展开不会调用模型或迁移记录。
      </p>
      {props.children}
    </details>
  );
}
