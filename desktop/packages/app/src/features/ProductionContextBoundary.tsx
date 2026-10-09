import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { useStudioSession } from "../studio-session";
import { useStudio } from "../studio-shared";
import {
  productionReferenceKey,
  readProductionObjectContext,
  type ProductionObjectContext,
} from "../production-object-context";

export function ProductionContextBoundary(props: {
  children(projectId: string, context: ProductionObjectContext): ReactNode;
}) {
  const location = useLocation();
  const session = useStudioSession();
  const client = useStudio();
  const params = new URLSearchParams(location.search);
  const projectId = params.get("projectId") ?? session.activeProjectId ?? "";
  const projectReferences = params.getAll("projectId");
  const malformedProject =
    projectReferences.length > 1 ||
    (projectReferences.length === 1 && !projectReferences[0]?.trim());
  const key = JSON.stringify([
    projectReferences,
    productionReferenceKey(location.search),
  ]);
  const scope = useQuery({
    queryKey: ["production-route-context", projectId, key],
    enabled: Boolean(projectId) && !malformedProject,
    retry: false,
    queryFn: async () => {
      if (params.getAll("projectId").length > 1)
        throw new Error("指定项目引用重复。");
      const project = await client.projects.get(projectId);
      if (project.id !== projectId) throw new Error("指定项目身份不符。");
      return readProductionObjectContext({
        projectId,
        search: location.search,
        get: client.resources.get,
      });
    },
  });
  if (malformedProject || (projectId && (scope.error || !scope.data)))
    return (
      <section
        className="rounded-xl border border-line bg-surface p-5"
        aria-label="制作对象归属核对"
      >
        <p role={scope.error || malformedProject ? "alert" : "status"}>
          {scope.error || malformedProject
            ? "指定项目或制作对象未能读取、身份或父级归属不符；未改读最近项目、列表首项或上次选择。"
            : "正在核对指定项目和制作对象的完整父级…"}
        </p>
        {(scope.error || malformedProject) && (
          <Link className="mt-3 inline-block text-sm text-brand" to="/">
            返回项目工作台，另行选择对象
          </Link>
        )}
      </section>
    );
  return props.children(projectId, scope.data ?? {});
}

export function WorkspaceObjectControls(props: {
  projectTitle?: string;
  objectTitles: string[];
  children: ReactNode;
}) {
  if (!props.projectTitle) return props.children;
  return (
    <section
      className="rounded-xl border border-line bg-surface p-4"
      aria-label="当前制作对象"
    >
      <p className="font-semibold">{props.projectTitle}</p>
      <p className="mt-1 text-sm text-muted">
        {props.objectTitles.join(" · ") || "尚未选择分集；制作与交付均为可选。"}
      </p>
      <details className="mt-3">
        <summary className="cursor-pointer text-sm">
          切换项目或制作对象（高级）
        </summary>
        <div className="mt-3">{props.children}</div>
      </details>
    </section>
  );
}
