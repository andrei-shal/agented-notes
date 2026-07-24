import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initTelegram } from "./lib/telegram";
import { useUIStore } from "./store/uiStore";
import { loadHighlightTheme } from "./lib/loadHighlightTheme";
import "./index.css";

function updateTheme() {
  const isDark = useUIStore.getState().theme === "dark";
  document.documentElement.classList.toggle("dark", isDark);
  loadHighlightTheme(isDark);
}

async function bootstrap() {
  // Initialize Telegram SDK (safe to call outside Telegram)
  const tg = await initTelegram();

  // Determine initial theme: Telegram > localStorage > system preference
  const storedTheme = useUIStore.getState().theme;
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = tg.theme === "dark" ? "dark" : storedTheme === "dark" ? "dark" : systemDark ? "dark" : "light";

  // Sync store with resolved theme
  if (theme !== useUIStore.getState().theme) {
    useUIStore.getState().toggleTheme();
  }

  // Apply theme and highlight.js style
  updateTheme();

  // Subscribe to theme changes in the store
  useUIStore.subscribe((state, prev) => {
    if (state.theme !== prev.theme) {
      updateTheme();
    }
  });

  // Render React
  const rootElement = document.getElementById("root");
  if (!rootElement) throw new Error("Root element not found");

  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

bootstrap();
