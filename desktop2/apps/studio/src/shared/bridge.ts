export interface StudioInit {
  apiBaseUrl: string;
  username: string;
  password: string;
  profile: "studio" | "e2e";
  platform: NodeJS.Platform;
}

export interface StudioBridge {
  init(): Promise<StudioInit>;
  retryInit(): Promise<StudioInit>;
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<boolean>;
    close(): Promise<void>;
    setTheme(theme: "light" | "dark"): Promise<void>;
  };
  files: {
    select(options?: {
      extensions?: string[];
    }): Promise<{ capability: string; name: string } | undefined>;
    selectMany(options?: {
      extensions?: string[];
    }): Promise<readonly { capability: string; name: string }[]>;
    saveTarget(options: {
      suggestedName: string;
      extensions?: string[];
    }): Promise<
      { capability: string; revealCapability: string; name: string } | undefined
    >;
    reveal(capability: string): Promise<void>;
  };
  credentials: {
    store(secret: string): Promise<{ credentialRef: string }>;
    remove(credentialRef: string): Promise<void>;
    status(credentialRef?: string): Promise<{
      available: boolean;
      configured: boolean;
    }>;
  };
  system: {
    openExternal(url: string): Promise<void>;
  };
}
