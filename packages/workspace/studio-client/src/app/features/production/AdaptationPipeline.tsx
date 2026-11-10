import type { Project } from "@dramaip/contracts/product";
import { Button } from "@dramaip/infra-ui-primitives";
import { useQuery } from "../../query";
import { Link } from "../../router";
import { deriveAdaptationCockpit } from "../../adaptation-cockpit";
import { loadAdaptationCockpitEvidence } from "../../adaptation-cockpit-evidence";
import { deriveDirectScriptCockpit } from "../../direct-script-cockpit";
import { loadDirectScriptCockpitEvidence } from "../../direct-script-cockpit-evidence";
import { PipelineStepper } from "../../pipeline-stepper";
import { isDirectScriptProject } from "../../project-intake";
import { useStudio } from "../../studio-shared";
import styles from "./AdaptationPipeline.module.css";
import { copyText } from "../../copy";

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
    <section
      aria-label={copyText("app/features/production/AdaptationPipeline.1")}
      className={styles.c1}
    >
      <div className={styles.c2}>
        <div className={styles.c3}>
          <h2 className={styles.c4}>{direct ? "剧本开发进度" : "改编进度"}</h2>
          <p className={styles.c5}>
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
      <div className={styles.c6}>
        {!direct && (
          <Link
            className={styles.c7}
            to={`${projectPath}/tools/adaptation-diagnosis`}
          >
            {copyText("app/features/production/AdaptationPipeline.2")}
          </Link>
        )}
        <Link
          className={styles.c7}
          to={`${projectPath}/tools/episode-development`}
        >
          {copyText("app/features/production/AdaptationPipeline.3")}
        </Link>
      </div>
    </section>
  );
}
