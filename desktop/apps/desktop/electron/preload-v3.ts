import { contextBridge } from "electron";

export interface RuntimeBootstrap {
  baseUrl: string;
  accessToken: string;
  appVersion: string;
  apiVersion: "2";
}

const prefix = "--dramaip-runtime-bootstrap=";
const encoded = process.argv
  .find((argument) => argument.startsWith(prefix))
  ?.slice(prefix.length);
if (!encoded) throw new Error("DramaIP runtime bootstrap is missing");
const parsed = JSON.parse(
  Buffer.from(encoded, "base64").toString("utf8"),
) as RuntimeBootstrap;
if (
  typeof parsed.baseUrl !== "string" ||
  typeof parsed.accessToken !== "string" ||
  typeof parsed.appVersion !== "string" ||
  parsed.apiVersion !== "2"
)
  throw new Error("DramaIP runtime bootstrap is invalid");

contextBridge.exposeInMainWorld(
  "runtimeBootstrap",
  Object.freeze({
    baseUrl: parsed.baseUrl,
    accessToken: parsed.accessToken,
    appVersion: parsed.appVersion,
    apiVersion: parsed.apiVersion,
  }),
);
