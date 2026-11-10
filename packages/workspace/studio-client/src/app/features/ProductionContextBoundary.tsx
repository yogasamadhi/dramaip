import type { ReactNode } from "react";
import { Link } from "../router";
import type { ProductionObjectContext } from "../production-object-context";
import { useProductionScope } from "../production-scope";
import styles from "./ProductionContextBoundary.module.css";
import { copyText } from "../copy";

export function ProductionContextBoundary(props: {
  children(projectId: string, context: ProductionObjectContext): ReactNode;
}) {
  const scope = useProductionScope();
  if (scope.status !== "ready")
    return (
      <section
        className={styles.c1}
        aria-label={copyText("app/features/ProductionContextBoundary.1")}
      >
        <p role={scope.status === "failed" ? "alert" : "status"}>
          {scope.status === "failed"
            ? "指定项目或制作对象未能读取、身份或父级归属不符；未改读最近项目、列表首项或上次选择。"
            : "正在核对指定项目和制作对象的完整父级…"}
        </p>
        {scope.status === "failed" && (
          <Link className={styles.c2} to="/">
            {copyText("app/features/ProductionContextBoundary.2")}
          </Link>
        )}
      </section>
    );
  return props.children(scope.projectId, scope.context);
}

export function WorkspaceObjectControls(props: {
  projectTitle?: string;
  objectTitles: string[];
  children: ReactNode;
}) {
  if (!props.projectTitle) return props.children;
  return (
    <section
      aria-label={copyText("app/features/ProductionContextBoundary.3")}
      className={styles.c3}
    >
      <details className={styles.group}>
        <summary className={styles.c4}>
          <span className={styles.c5}>
            <span className={styles.c6}>
              {copyText("app/features/ProductionContextBoundary.4")}
            </span>
            <span className={styles.c7}>{props.projectTitle}</span>
            <span className={styles.c8}>
              {props.objectTitles.length
                ? `· ${props.objectTitles.join(" · ")}`
                : "· 尚未选择分集（制作与交付可选）"}
            </span>
            <span className={styles.c9}>
              {copyText("app/features/ProductionContextBoundary.5")}
            </span>
            <span className={styles.c10}>
              {copyText("app/features/ProductionContextBoundary.6")}
            </span>
          </span>
        </summary>
        <div className={styles.c11}>{props.children}</div>
      </details>
    </section>
  );
}
