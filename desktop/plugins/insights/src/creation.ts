import { provideService } from "@dramaip/plugin-api/internal";
import {
  CREATION_INSIGHTS_SERVICE,
  creationReference,
} from "@dramaip/contracts/creation";
import type { PluginContext } from "@dramaip/plugin-api/internal";

export function registerInsightsCreation(context: PluginContext) {
  context.effect(
    () =>
      provideService(context, CREATION_INSIGHTS_SERVICE, {
        references: (projectId, id, targetId) =>
          context.uow.execute((tx) => {
            if (!targetId)
              throw new Error("反馈尚未定位，请选择需要修订的章节或剧本。");
            const cluster = tx.get<{
              id: string;
              project_id: string;
              batch_id: string;
              title: string;
              summary: string;
              created_at: string;
            }>("SELECT * FROM insights_feedback_clusters WHERE id = ?", id);
            if (!cluster || cluster.project_id !== projectId)
              throw new Error("反馈不属于当前项目。");
            const comments = tx.all<{ content: string }>(
              "SELECT content FROM insights_feedback_comments WHERE batch_id = ? ORDER BY created_at LIMIT 100",
              cluster.batch_id,
            );
            return [
              creationReference("feedback", {
                id,
                version: Date.parse(cluster.created_at),
                title: cluster.title,
                summary: cluster.summary,
                comments,
                interpretation:
                  "观众意见属于主观反馈，先定位证据，再根据创作方向修订，不无条件迎合。",
              }),
            ];
          }),
      }),
    `service:${CREATION_INSIGHTS_SERVICE}`,
  );
}
