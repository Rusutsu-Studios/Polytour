import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import DisabledHints from "./ui/DisabledHints.js";
import NotFound from "./ui/NotFound.js";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing root element");
}

createRoot(root).render(
  <StrictMode>
    {window.location.pathname === "/" ||
    window.location.pathname === "/index.html" ||
    /^\/rooms\/[^/]+$/.test(window.location.pathname) ? (
      <App />
    ) : (
      <NotFound />
    )}
    <DisabledHints />
  </StrictMode>,
);
