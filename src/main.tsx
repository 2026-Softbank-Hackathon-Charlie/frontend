import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Global styles first: page stylesheets imported by the pages (e.g. migrate.css) come later in the bundle and
// win ties against app.css, so a page can refine a shared rule without raising specificity.
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/motion.css";
import { App } from "./App";
import { LangToggle } from "./i18n/LangToggle";
import { SimProvider } from "./sim/store";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SimProvider>
      <App />
      <LangToggle />
    </SimProvider>
  </StrictMode>,
);
