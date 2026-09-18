export function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function centsToUsd(cents: unknown): number {
  return num(cents) / 100;
}

export function formatMoney(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return value < 0 ? `-$${formatted}` : `$${formatted}`;
}

export function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const digits = value > 0 && value < 1 ? 2 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)}%`;
}

export function formatTokens(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${trimNum(abs / 1e9)}B`;
  if (abs >= 1e6) return `${trimNum(abs / 1e6)}M`;
  if (abs >= 1e3) return `${trimNum(abs / 1e3)}K`;
  return String(Math.round(abs));
}

function trimNum(n: number): string {
  const s = n >= 10 ? n.toFixed(1) : n.toFixed(2);
  return s.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

export function formatDaysLeft(days: number | null): string {
  if (days == null) return "周期未知";
  if (days <= 0) return "即将重置";
  return `${days} 天后重置`;
}

/** Grok Bot weekly reset: countdown to the hour, plus local clock time. */
export function formatResetAt(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "重置未知";
  const end = new Date(iso).getTime();
  if (!Number.isFinite(end)) return "重置未知";
  const ms = end - now;
  if (ms <= 0) return "即将重置";
  const hoursTotal = Math.floor(ms / 3_600_000);
  const days = Math.floor(hoursTotal / 24);
  const hours = hoursTotal % 24;
  const wait =
    days > 0 && hours > 0
      ? `${days} 天 ${hours} 小时后重置`
      : days > 0
        ? `${days} 天后重置`
        : hours > 0
          ? `${hours} 小时后重置`
          : `${Math.max(1, Math.floor(ms / 60_000))} 分钟后重置`;
  const clock = formatLocalHour(end);
  return clock ? `${wait} · ${clock}` : wait;
}

function formatLocalHour(ms: number): string {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return "";
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hour = String(d.getHours()).padStart(2, "0");
  const minute = String(d.getMinutes()).padStart(2, "0");
  return `${month}/${day} ${hour}:${minute}`;
}

export function formatAgo(ts: number | null): string {
  if (ts == null) return "尚未刷新";
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 8) return "刚刚";
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  return `${Math.round(min / 60)} 小时前`;
}

export function displayModelName(id: string): string {
  const base = humanizeModel(id);
  if (/^sand([-_]|$)/i.test(id)) {
    const rest = base.replace(/^Sand\s+/i, "").trim();
    return rest && !/^bot$/i.test(rest) ? `Grok Bot · ${rest}` : "Grok Bot";
  }
  return base;
}

export function humanizeModel(id: string): string {
  let s = id.replace(/^cursor-/i, "");
  const parts = s.split(/[-_]+/g).filter(Boolean);
  const special: Record<string, string> = {
    grok: "Grok",
    composer: "Composer",
    claude: "Claude",
    gpt: "GPT",
    gemini: "Gemini",
    xhigh: "xHigh",
    high: "High",
    low: "Low",
    medium: "Medium",
    fast: "Fast",
    thinking: "Thinking",
    bot: "Bot",
    opus: "Opus",
    sonnet: "Sonnet",
    haiku: "Haiku",
    auto: "Auto",
  };
  return parts
    .map((part) => {
      const key = part.toLowerCase();
      if (special[key]) return special[key];
      if (/^\d+(\.\d+)?$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}
