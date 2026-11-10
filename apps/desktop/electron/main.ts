/**
 * Electron entrypoint. The background guards load first; the shell module
 * holds the application lifecycle and has no business behavior.
 */
import "./background-entry.js";
import "./shell/application.js";
