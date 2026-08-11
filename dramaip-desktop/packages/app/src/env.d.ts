/// <reference types="vite/client" />

declare global {
  interface Window {
    desktop: {
      awaitInitialization(): Promise<{
        url: string;
        username: string;
        password: string;
        version: string;
      }>;
      retryInitialization(): Promise<{
        url: string;
        username: string;
        password: string;
        version: string;
      }>;
      pickFiles(options?: {
        multiple?: boolean;
        extensions?: string[];
      }): Promise<Array<{ token: string; name: string }> | null>;
      saveTextFile(input: {
        suggestedName: string;
        content: string;
      }): Promise<{ saved: boolean }>;
      openExternal(url: string): Promise<void>;
      revealPath(path: string): Promise<void>;
      storeCredential(secret: string): Promise<{ credentialRef: string }>;
      removeCredential(credentialRef: string): Promise<void>;
      getCredentialStorageStatus(): Promise<{
        available: boolean;
        storage: "local_encrypted_file";
        message?: string;
      }>;
    };
  }
}
export {};
