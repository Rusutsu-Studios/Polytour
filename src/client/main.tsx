import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { useResolvedReducedMotion } from "./settings/store.js";
import DisabledHints from "./ui/DisabledHints.js";
import NotFound from "./ui/NotFound.js";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing root element");
}

function ClientApp() {
  const reducedMotion = useResolvedReducedMotion();
  return (
    <MotionConfig reducedMotion={reducedMotion ? "always" : "never"}>
      {window.location.pathname === "/" ||
      window.location.pathname === "/index.html" ||
      /^\/rooms\/[^/]+$/.test(window.location.pathname) ? (
        <App />
      ) : (
        <NotFound />
      )}
      <DisabledHints />
    </MotionConfig>
  );
}

createRoot(root).render(
  <StrictMode>
    <ClientApp />
  </StrictMode>,
);
