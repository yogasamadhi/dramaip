import { createElement } from "react";
import { TaskPage } from "./impl";

export const AutomationFeature = () => createElement(TaskPage);
export { PendingConfirmationPage as PendingConfirmationFeature } from "./PendingConfirmationPage";
