/**
 * main.ts evaluates this module before the application module, so background
 * runs are guarded even when evaluating the application module throws.
 */
import { app, dialog, shell } from "electron";
import {
  exitOnUncaughtError,
  installBackgroundNativeGuards,
  isBackgroundDebugMode,
} from "./background-debug";

if (isBackgroundDebugMode(process.env)) {
  exitOnUncaughtError(process);
  installBackgroundNativeGuards(dialog, shell);
  if (process.platform === "darwin") app.setActivationPolicy("accessory");
}
