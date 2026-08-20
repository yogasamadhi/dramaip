/// <reference types="vite/client" />

declare global {
  interface Window {
    runtimeBootstrap: Readonly<{
      baseUrl: string;
      accessToken: string;
      appVersion: string;
      apiVersion: "2";
    }>;
  }
}
export {};
