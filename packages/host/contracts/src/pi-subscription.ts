export type PiSubscriptionAction =
  "status" | "start" | "answer" | "cancel" | "logout";

export interface PiSubscriptionAnswer {
  promptId: string;
  value: string;
}

export interface PiSubscriptionPrompt {
  id: string;
  type: "select" | "text" | "secret" | "manual_code";
  message: string;
  placeholder?: string;
  options?: readonly { id: string; label: string; description?: string }[];
}

export type PiSubscriptionNotice =
  | { type: "auth_url"; url: string; instructions?: string }
  | {
      type: "device_code";
      userCode: string;
      verificationUri: string;
      openBrowserOnConfirm?: boolean;
      copyCodeOnConfirm?: boolean;
    }
  | { type: "progress"; message: string }
  | {
      type: "info";
      message: string;
      links?: readonly { url: string; label?: string }[];
    };

export interface PiSubscriptionStatus {
  signedIn: boolean;
  pending: boolean;
  failed: boolean;
  failureReason?: "network" | "exchange" | "storage";
  exchangeStatus?: number;
  modelIds: readonly string[];
  prompt?: PiSubscriptionPrompt;
  notices: readonly PiSubscriptionNotice[];
}
