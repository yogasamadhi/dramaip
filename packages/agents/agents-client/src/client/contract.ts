/**
 * Factory contract of the agents client: the new-task settings, which the
 * task center opens under its heading.
 * @module @dramaip/agents-agents-client/client/contract
 */
import type {} from "@dramaip/infra-ui-slots";
import type {
  AgentTaskConfigProps,
  TaskConfigRemotes,
} from "./task-config/TaskConfig.tsx";

export type {
  AgentTaskConfigProps,
  AssistantIntent,
  AssistantIntentScope,
  TaskConfigProjectScope,
} from "./task-config/TaskConfig.tsx";

declare module "@dramaip/infra-ui-slots" {
  interface SlotFactoryMap {
    /**
     * The new-task settings: the recommended actions of the page it opens
     * on, the task and model controls,
     * and the run it started. Its owner hands it the project scope, the
     * settings return intent and the creation run card.
     */
    "agents.task-config": {
      scope: "root";
      props: AgentTaskConfigProps;
      inject: TaskConfigRemotes;
      locale: "agents";
    };
  }
}
