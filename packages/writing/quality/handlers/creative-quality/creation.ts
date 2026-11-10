import { provideService } from "@dramaip/plugin-api/internal";
import { CREATION_QUALITY_SERVICE } from "@dramaip/contracts/creation";
import type { PluginContext } from "@dramaip/plugin-api/internal";
import {
  CREATION_CHECK_PROMPT,
  creationQualityPrompt,
  collectCreationIssues,
} from "./creation-check-content.js";

export function registerCreationQuality(context: PluginContext) {
  context.effect(
    () =>
      provideService(context, CREATION_QUALITY_SERVICE, {
        prompt: CREATION_CHECK_PROMPT,
        promptFor: creationQualityPrompt,
        collect: collectCreationIssues,
      }),
    `service:${CREATION_QUALITY_SERVICE}`,
  );
}
