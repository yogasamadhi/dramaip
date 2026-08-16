import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { initializeTheme } from "@dramaip/ui";

import { StudioApplication } from "./studio-application.tsx";
import "./styles.css";

initializeTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StudioApplication />
  </StrictMode>,
);
