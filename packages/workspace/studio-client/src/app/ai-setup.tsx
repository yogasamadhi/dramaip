import { createContext, useContext, type ReactNode } from "react";

/** What the inline AI model setup takes from the page that opens it. */
export interface AiSetupProps {
  open: boolean;
  onClose(): void;
  onReady(): void;
}

/** Render the inline AI model setup, or undefined when the app has none. */
export type RenderAiSetup = (props: AiSetupProps) => ReactNode;

const AiSetupContext = createContext<RenderAiSetup | undefined>(undefined);

/** Hands the pages the inline AI model setup the agents client registers. */
export const AiSetupProvider = AiSetupContext.Provider;

/** The inline AI model setup, when the app provides one. */
export function useAiSetup(): RenderAiSetup | undefined {
  return useContext(AiSetupContext);
}
