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
      className="rounded-lg border border-line p-4"
    >
      <summary className="cursor-pointer font-medium">
        打开旧 episode 兼容路径
      </summary>
      <p className="my-3 text-sm text-muted">
        保留旧工作流、候选、采用回执与深链接。此路径仍可能一次采用剧本、场景与分镜，不是新的独立单集开发；展开不会调用模型或迁移记录。
      </p>
      {props.children}
    </details>
  );
}
