import type { Project } from "@dramaip/contracts/product";
import { Button } from "@dramaip/ui-shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { deriveAdaptationCockpit } from "../../adaptation-cockpit";
import { loadAdaptationCockpitEvidence } from "../../adaptation-cockpit-evidence";
import { deriveDirectScriptCockpit } from "../../direct-script-cockpit";
import { loadDirectScriptCockpitEvidence } from "../../direct-script-cockpit-evidence";
import { PipelineStepper } from "../../pipeline-stepper";
import { isDirectScriptProject } from "../../project-intake";
import { useStudio } from "../../studio-shared";

/**
 * Adaptation main flow: the same formal gates as the project cockpit, shown as
 * an ordered pipeline with exactly one primary next step. Evidence is read
 * only; nothing here starts work or adopts content.
 */
export function AdaptationPipeline(props: { project: Project }) {
  const client = useStudio();
  const direct = isDirectScriptProject(props.project);
  const adaptationEvidence = useQuery({
    queryKey: ["adaptation-cockpit-evidence", props.project.id],
    queryFn: () => loadAdaptationCockpitEvidence(client, props.project.id),
    enabled: !direct,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const directEvidence = useQuery({
    queryKey: ["direct-script-cockpit-evidence", props.project.id],
    queryFn: () => loadDirectScriptCockpitEvidence(client, props.project.id),
    enabled: direct,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const evidence = direct ? directEvidence : adaptationEvidence;
  const cockpit = direct
    ? directEvidence.data &&
      deriveDirectScriptCockpit(props.project, directEvidence.data)
    : adaptationEvidence.data &&
      deriveAdaptationCockpit(props.project, adaptationEvidence.data);
  const projectPath = `/projects/${encodeURIComponent(props.project.id)}`;
  return (
    <section aria-label="独立创作主流程" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">
            {direct ? "剧本开发进度" : "改编进度"}
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            {cockpit
              ? `${cockpit.statusLabel} · ${cockpit.primaryAction.description}`
              : evidence.error
                ? "暂时无法读取正式进度；已有内容仍可在下方打开。"
                : "正在读取已保存的正式版本…"}
          </p>
        </div>
        {cockpit && (
          <Button asChild variant="primary" size="sm">
            <Link to={cockpit.primaryAction.to}>
              {cockpit.primaryAction.label}
            </Link>
          </Button>
        )}
      </div>
      {cockpit?.gates && (
        <PipelineStepper
          label={direct ? "剧本开发步骤" : "改编步骤"}
          steps={cockpit.gates}
          linkLabel="打开此步骤"
        />
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {!direct && (
          <Link
            className="text-link underline-offset-2 hover:underline"
            to={`${projectPath}/tools/adaptation-diagnosis`}
          >
            先确认来源并进行改编诊断 →
          </Link>
        )}
        <Link
          className="text-link underline-offset-2 hover:underline"
          to={`${projectPath}/tools/episode-development`}
        >
          打开独立单集开发 →
        </Link>
      </div>
    </section>
  );
}
