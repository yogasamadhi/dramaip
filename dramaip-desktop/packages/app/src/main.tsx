import { initializeTheme } from "@sdns/ui";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { AppRoot } from "./studio-app";
import "./styles.css";

initializeTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppRoot />
  </StrictMode>,
);
