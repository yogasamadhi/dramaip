import { provideService, optionalService } from "@dramaip/plugin-api/internal";
import {
  CREATION_REVIEW_SERVICE,
  creationReference,
} from "@dramaip/contracts/creation";
import { PRODUCTION_RECORD_SERVICE } from "@dramaip/contracts/production";
import type { PluginContext } from "@dramaip/plugin-api/internal";

export function registerReviewCreation(context: PluginContext) {
  context.effect(
    () =>
      provideService(context, CREATION_REVIEW_SERVICE, {
        references: (projectId, id, targetId) => {
          const target = optionalService(
            context,
            PRODUCTION_RECORD_SERVICE,
          )?.get(targetId);
          if (
            !target ||
            target.projectId !== projectId ||
            target.kind !== "scripts"
          )
            throw new Error("请选择当前项目的剧本。");
          return context.uow.execute((tx) => {
            const record = tx.get<{ project_id: string; episode_id: string }>(
              "SELECT project_id, episode_id FROM review_packages WHERE id = ?",
              id,
            );
            if (
              !record ||
              record.project_id !== projectId ||
              record.episode_id !== target.parentId
            )
              throw new Error("审片意见与目标剧本不属于同一分集。");
            const comments = tx.all<{
              id: string;
              body: string;
              updated_at: string;
            }>(
              "SELECT * FROM review_comments WHERE package_id = ? AND resolved = 0 ORDER BY created_at",
              id,
            );
            const decisions = tx.all<{ id: string; created_at: string }>(
              "SELECT * FROM review_decisions WHERE package_id = ? AND decision IN ('return','request_changes') ORDER BY created_at",
              id,
            );
            if (!comments.length && !decisions.length)
              throw new Error("当前审片包没有待处理反馈。");
            return [
              creationReference("review", {
                id,
                version: Math.max(
                  0,
                  ...comments.map((item) => Date.parse(item.updated_at)),
                  ...decisions.map((item) => Date.parse(item.created_at)),
                ),
                title: "审片原始意见与返修决定",
                comments,
                decisions,
              }),
            ];
          });
        },
      }),
    `service:${CREATION_REVIEW_SERVICE}`,
  );
}
