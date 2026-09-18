export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | undefined> | null = null,
  ...children: Array<Node | string | null | undefined | false>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === "class") {
        el.className = String(value);
        continue;
      }
      if (value === true) {
        el.setAttribute(key, "");
        continue;
      }
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    el.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

export function isDashboardPath(pathname = location.pathname): boolean {
  return /\/dashboard(\/|$)/.test(pathname);
}

/** /dashboard or /cn/dashboard only — not /dashboard/settings */
export function isDashboardRoot(pathname = location.pathname): boolean {
  return /(?:^|\/)dashboard\/?$/.test(pathname);
}

export function detectTheme(): "light" | "dark" {
  const bg = getComputedStyle(document.body).backgroundColor;
  const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return "dark";
  const r = Number(m[1]);
  const g = Number(m[2]);
  const b = Number(m[3]);
  const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return l > 0.65 ? "light" : "dark";
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
