import type { AggregatedUsage, UsageSummary } from "./types";

const FETCH_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

async function fetchJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      credentials: "include",
      ...init,
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        ...(init.headers || {}),
      },
    });
    if (res.status === 401 || res.status === 403) {
      throw new ApiError("请先登录 Cursor", res.status);
    }
    if (!res.ok) {
      throw new ApiError(`HTTP ${res.status}`, res.status);
    }
    return await res.json();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError("请求超时");
    }
    throw new ApiError(err instanceof Error ? err.message : "网络错误");
  } finally {
    window.clearTimeout(timer);
  }
}

export async function fetchUsageSummary(): Promise<UsageSummary> {
  return (await fetchJson("/api/usage-summary")) as UsageSummary;
}

export async function fetchAggregatedUsage(startDateMs: number, endDateMs?: number): Promise<AggregatedUsage> {
  const body: { teamId: number; startDate: number; endDate?: number } = {
    teamId: -1,
    startDate: startDateMs,
  };
  if (endDateMs != null && Number.isFinite(endDateMs)) body.endDate = endDateMs;
  return (await fetchJson("/api/dashboard/get-aggregated-usage-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })) as AggregatedUsage;
}

export async function fetchSandUsageStatus(): Promise<unknown> {
  return fetchDashboard("get-sand-usage-status");
}

/** Plan name + included API allowance (includedAmountCents). Cookie session, same as other dashboard posts. */
export async function fetchPlanInfo(): Promise<unknown> {
  return fetchDashboard("get-plan-info");
}

function fetchDashboard(path: string, body: unknown = {}): Promise<unknown> {
  return fetchJson(`/api/dashboard/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function settledError(result: PromiseSettledResult<unknown>, fallback: string): string | null {
  if (result.status !== "rejected") return null;
  return result.reason instanceof Error ? result.reason.message : fallback;
}

export async function loadUsagePayload(): Promise<{
  summary: UsageSummary;
  events: AggregatedUsage | null;
  eventsError: string | null;
  sand: unknown;
  sandError: string | null;
  planInfo: unknown;
  planInfoError: string | null;
  weekEvents: AggregatedUsage | null;
  weekEventsError: string | null;
}> {
  const summary = await fetchUsageSummary();
  const start = summary.billingCycleStart ? new Date(summary.billingCycleStart).getTime() : NaN;
  const eventsTask = Number.isFinite(start)
    ? fetchAggregatedUsage(start)
    : Promise.reject(new Error("账单周期起始时间无效"));
  const [eventsSettled, sandSettled, planSettled] = await Promise.allSettled([
    eventsTask,
    fetchSandUsageStatus(),
    fetchPlanInfo(),
  ]);
  const sand = sandSettled.status === "fulfilled" ? sandSettled.value : null;
  const events = eventsSettled.status === "fulfilled" ? eventsSettled.value : null;
  let weekEvents: AggregatedUsage | null = null;
  let weekEventsError: string | null = null;
  const weekMs = sandWeekStartMs(sand);
  if (Number.isFinite(weekMs)) {
    try {
      weekEvents = await fetchAggregatedUsage(weekMs, Date.now());
    } catch (err) {
      weekEventsError = err instanceof Error ? err.message : "Grok Bot 本周用量请求失败";
    }
  }
  return {
    summary,
    events,
    eventsError: settledError(eventsSettled, "用量事件请求失败"),
    sand,
    sandError: settledError(sandSettled, "Grok Bot 周限额请求失败"),
    planInfo: planSettled.status === "fulfilled" ? planSettled.value : null,
    planInfoError: settledError(planSettled, "套餐信息请求失败"),
    weekEvents,
    weekEventsError,
  };
}

function sandWeekStartMs(sand: unknown): number {
  if (!sand || typeof sand !== "object" || Array.isArray(sand)) return NaN;
  let rec = sand as Record<string, unknown>;
  if (rec.data && typeof rec.data === "object" && !Array.isArray(rec.data) && rec.usagePercent == null) {
    rec = rec.data as Record<string, unknown>;
  }
  const raw = rec.currentPeriodStart;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return raw < 1e11 ? raw * 1000 : raw;
  }
  if (typeof raw === "string" && raw.trim()) {
    const trimmed = raw.trim();
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n <= 0) return NaN;
      return n < 1e11 ? n * 1000 : n;
    }
    const time = Date.parse(trimmed);
    return Number.isNaN(time) ? NaN : time;
  }
  return NaN;
}
