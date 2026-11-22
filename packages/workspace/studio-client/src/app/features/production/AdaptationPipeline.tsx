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

const GUIDE_STEPS = [
  {
    title: "确认原著和改编想法",
    text: "告诉 AI 这部小说想改成什么样的短剧：给谁看、多少集、哪些人物和情节一定要保留。",
    action: "确认改编想法",
  },
  {
    title: "AI 诊断原著",
    text: "AI 通读原著，找出适合短剧的冲突和爽点，以及需要删减或合并的部分。",
    action: "开始诊断",
  },
  {
    title: "定改编策略",
    text: "确定主线怎么收、人物怎么取舍、节奏多快，后面的分集都按这个来。",
    action: "制定改编策略",
  },
  {
    title: "排分集方案",
    text: "把故事分到每一集，标出每集的开场钩子和结尾悬念。",
    action: "排分集方案",
  },
  {
    title: "写第 1 集剧本",
    text: "按分集方案写出第 1 集的完整剧本，满意后再一集一集往下写。",
    action: "写第 1 集剧本",
  },
  {
    title: "第 1 集分镜（可选）",
    text: "剧本已经可以导出交给下游。需要自己做视频时，再把剧本拆成分镜和样片包。",
    action: "做第 1 集分镜",
  },
] as const;

const GUIDE_DONE = {
  title: "全部完成",
  text: "第 1 集的剧本和分镜都已保存，可以继续写后面的集数，或导出交给下游。",
  action: "查看成果",
};

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
  // The single next step of a novel being adapted, in plain words.
  const nextIndex = cockpit?.gates?.findIndex(
    (gate) => gate.status !== "ready",
  );
  const nextStep =
    !direct && cockpit?.gates && nextIndex !== undefined
      ? nextIndex < 0
        ? { ...GUIDE_DONE, to: cockpit.primaryAction.to }
        : {
            ...GUIDE_STEPS[Math.min(nextIndex, GUIDE_STEPS.length - 1)]!,
            to: cockpit.primaryAction.to,
          }
      : undefined;
  return (
    <section
      aria-label={copyText("app/features/production/AdaptationPipeline.1")}
      className={styles.c1}
    >
      {nextStep && (
        <div
          className={styles.guide}
          aria-label={copyText("app/features/production/AdaptationPipeline.5")}
        >
          <div>
            <p className={styles.guideStep}>
              {copyText("app/features/production/AdaptationPipeline.4", {
                p1: nextStep.title,
              })}
            </p>
            <p className={styles.guideText}>{nextStep.text}</p>
          </div>
          <Button asChild variant="primary" size="sm">
            <Link to={nextStep.to}>{nextStep.action}</Link>
          </Button>
        </div>
      )}
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
