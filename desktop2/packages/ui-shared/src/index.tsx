import {
  createContext,
  type ComponentType,
  type PropsWithChildren,
  useContext,
} from "react";

import { StudioClient } from "@dramaip/client";
import type { UiSlot } from "@dramaip/plugin-api";

const ClientContext = createContext<StudioClient | undefined>(undefined);

export function StudioClientProvider({
  client,
  children,
}: PropsWithChildren<{ client: StudioClient }>) {
  return (
    <ClientContext.Provider value={client}>{children}</ClientContext.Provider>
  );
}

export function useStudioClient(): StudioClient {
  const client = useContext(ClientContext);
  if (!client) throw new Error("StudioClientProvider is missing");
  return client;
}

export interface ResolvedUiSlot {
  id: string;
  slot: UiSlot;
  Component: ComponentType;
}

const SlotContext = createContext<readonly ResolvedUiSlot[]>([]);

export function UiSlotProvider({
  slots,
  children,
}: PropsWithChildren<{ slots: readonly ResolvedUiSlot[] }>) {
  return <SlotContext.Provider value={slots}>{children}</SlotContext.Provider>;
}

export function useUiSlots(slot: UiSlot): readonly ResolvedUiSlot[] {
  return useContext(SlotContext).filter((item) => item.slot === slot);
}

export interface ChapterUiState {
  projectId: string;
  chapterId: string;
  title: string;
  content: string;
  version: number;
}

const ChapterContext = createContext<ChapterUiState | undefined>(undefined);

export function ChapterUiProvider({
  value,
  children,
}: PropsWithChildren<{ value: ChapterUiState }>) {
  return (
    <ChapterContext.Provider value={value}>{children}</ChapterContext.Provider>
  );
}

export function useChapterUi(): ChapterUiState | undefined {
  return useContext(ChapterContext);
}

export function LoadingPanel({ label = "正在加载…" }: { label?: string }) {
  return <div className="empty-state">{label}</div>;
}

export function ErrorPanel({ error }: { error: unknown }) {
  return (
    <div className="error-panel" role="alert">
      {error instanceof Error ? error.message : "加载失败"}
    </div>
  );
}

export function EmptyPanel({ children }: PropsWithChildren) {
  return <div className="empty-state">{children}</div>;
}
