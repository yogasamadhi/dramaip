import { CreationWorkbench } from "../creation-workbench";
import { BareButton, NativeSelect } from "@dramaip/infra-ui-primitives";
import { useQuery, useQueryClient } from "../../query";
import { useEffect, useState } from "react";
import { message, useStudio } from "../../studio-shared";
import { useStudioSession } from "../../studio-session";
import styles from "./impl.module.css";
import { copyText } from "../../copy";
export function ChapterAnalysisPanel(props: { projectId?: string } = {}) {
  const client = useStudio();
  const session = useStudioSession();
  const queryClient = useQueryClient();
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: client.projects.list,
  });
  const [projectId, setProjectId] = useState(props.projectId ?? "");
  const [chapterId, setChapterId] = useState("");
  const [notice, setNotice] = useState<string>();
  const { data: chapters = [] } = useQuery({
    queryKey: ["analysis-chapters", projectId],
    queryFn: () => client.chapters.list(projectId),
    enabled: Boolean(projectId),
  });
  useEffect(() => {
    if (props.projectId && projectId !== props.projectId) {
      setProjectId(props.projectId);
      setChapterId("");
    }
  }, [projectId, props.projectId]);
  useEffect(() => {
    if (chapterId && !chapters.some((chapter) => chapter.id === chapterId))
      setChapterId("");
  }, [chapterId, chapters]);
  const run = async () => {
    if (!chapterId) return;
    setNotice(undefined);
    try {
      const result = await client.analysis.runChapter(chapterId);
      setNotice(
        `已生成 ${result.records.length} 项章节分析，可在下方对应资料区查看。`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["resource"] }),
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      ]);
    } catch (cause) {
      setNotice(message(cause));
    }
  };
  return (
    <section className={styles.c1}>
      <div>
        <h2 className={styles.c2}>
          {copyText("app/features/creative/impl.1")}
        </h2>
        <p className={styles.c3}>{copyText("app/features/creative/impl.2")}</p>
      </div>
      <div className={styles.c4}>
        <label className={styles.c5}>
          {copyText("app/features/creative/impl.3")}
          <NativeSelect
            className={styles.c6}
            value={projectId}
            onChange={(event) => {
              const nextProjectId = event.target.value;
              setProjectId(nextProjectId);
              if (nextProjectId) session.selectProject(nextProjectId);
              setChapterId("");
            }}
          >
            <option value="">{copyText("app/features/creative/impl.4")}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className={styles.c5}>
          {copyText("app/features/creative/impl.5")}
          <NativeSelect
            className={styles.c6}
            disabled={!projectId}
            value={chapterId}
            onChange={(event) => setChapterId(event.target.value)}
          >
            <option value="">{copyText("app/features/creative/impl.6")}</option>
            {chapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.title}
              </option>
            ))}
          </NativeSelect>
        </label>
        <div className={styles.c7}>
          <BareButton
            className={styles.c8}
            disabled={!chapterId}
            onClick={() => void run()}
          >
            {copyText("app/features/creative/impl.7")}
          </BareButton>
        </div>
      </div>
      {projectId && chapterId && (
        <div className={styles.c9}>
          <CreationWorkbench
            projectId={projectId}
            targetId={chapterId}
            baseVersion={
              chapters.find((item) => item.id === chapterId)?.version
            }
            operation="chapter"
            defaultInstruction="分析本章人物动机、连续性、节奏和表达，提出有证据的局部修订，保留原作方向，生成候选并检查。"
          />
        </div>
      )}
      {notice && <p className={styles.c10}>{notice}</p>}
    </section>
  );
}
