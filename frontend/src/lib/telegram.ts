import {
  init,
  isTMA,
  retrieveRawInitData,
  mountThemeParams,
  unmountThemeParams,
  isThemeParamsDark,
  viewport,
  mountViewport,
  unmountViewport,
} from "@telegram-apps/sdk";

export interface TelegramInfo {
  isTelegram: boolean;
  initData: string | null;
  theme: "light" | "dark";
  viewportHeight: number | null;
  viewportStableHeight: number | null;
}

let cachedInfo: TelegramInfo | null = null;

/**
 * Initialize the Telegram Mini App SDK.
 * Safe to call multiple times — subsequent calls return cached info.
 */
export async function initTelegram(): Promise<TelegramInfo> {
  if (cachedInfo) return cachedInfo;

  try {
    init();
  } catch {
    // Already initialized or not in Telegram — swallow
  }

  const telegram = isTMA();

  let initData: string | null = null;
  let theme: "light" | "dark" = "light";
  let viewportHeight: number | null = null;
  let viewportStableHeight: number | null = null;

  if (telegram) {
    try {
      initData = retrieveRawInitData() ?? null;
    } catch {
      // initData unavailable
    }

    try {
      await mountThemeParams();
      theme = isThemeParamsDark() ? "dark" : "light";
    } catch {
      // Theme params unavailable
    }

    try {
      await mountViewport();
      viewportHeight = viewport.height() ?? null;
      viewportStableHeight = viewport.stableHeight() ?? null;
    } catch {
      // Viewport unavailable
    }
  }

  cachedInfo = { isTelegram: telegram, initData, theme, viewportHeight, viewportStableHeight };
  return cachedInfo;
}

/** Get cached Telegram info (synchronous, returns null before init). */
export function getTelegramInfo(): TelegramInfo | null {
  return cachedInfo;
}

/** Cleanup Telegram SDK subscriptions. */
export function destroyTelegram(): void {
  try {
    unmountThemeParams();
  } catch { /* ignore */ }
  try {
    unmountViewport();
  } catch { /* ignore */ }
  cachedInfo = null;
}
