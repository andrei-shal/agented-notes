const STYLE_ID = "hljs-theme";

async function injectCSS(url: string): Promise<void> {
  const existing = document.getElementById(STYLE_ID);
  if (existing) existing.remove();

  const res = await fetch(url);
  if (!res.ok) return;
  const css = await res.text();

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}

export function loadHighlightTheme(isDark: boolean): void {
  const cssPath = isDark ? "/hljs-dark.css" : "/hljs-light.css";
  injectCSS(cssPath).catch(() => {});
}
