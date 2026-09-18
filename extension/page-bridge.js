"use strict";
(() => {
  // src/lib/api.ts
  var FETCH_TIMEOUT_MS = 15e3;
  var ApiError = class extends Error {
    status;
    constructor(message, status = 0) {
      super(message);
      this.status = status;
    }
  };
  async function fetchJson(url, init = {}) {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        credentials: "include",
        ...init,
        signal: ctrl.signal,
        headers: {
          Accept: "application/json",
          ...init.headers || {}
        }
      });
      if (res.status === 401 || res.status === 403) {
        throw new ApiError("\u8BF7\u5148\u767B\u5F55 Cursor", res.status);
      }
      if (!res.ok) {
        throw new ApiError(`HTTP ${res.status}`, res.status);
      }
      return await res.json();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new ApiError("\u8BF7\u6C42\u8D85\u65F6");
      }
      throw new ApiError(err instanceof Error ? err.message : "\u7F51\u7EDC\u9519\u8BEF");
    } finally {
      window.clearTimeout(timer);
    }
  }
  async function fetchUsageSummary() {
    return await fetchJson("/api/usage-summary");
  }
  async function fetchAggregatedUsage(startDateMs, endDateMs) {
    const body = {
      teamId: -1,
      startDate: startDateMs
    };
    if (endDateMs != null && Number.isFinite(endDateMs)) body.endDate = endDateMs;
    return await fetchJson("/api/dashboard/get-aggregated-usage-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }
  async function fetchSandUsageStatus() {
    return fetchDashboard("get-sand-usage-status");
  }
  async function fetchPlanInfo() {
    return fetchDashboard("get-plan-info");
  }
  function fetchDashboard(path, body = {}) {
    return fetchJson(`/api/dashboard/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }
  function settledError(result, fallback) {
    if (result.status !== "rejected") return null;
    return result.reason instanceof Error ? result.reason.message : fallback;
  }
  async function loadUsagePayload() {
    const summary = await fetchUsageSummary();
    const start = summary.billingCycleStart ? new Date(summary.billingCycleStart).getTime() : NaN;
    const eventsTask = Number.isFinite(start) ? fetchAggregatedUsage(start) : Promise.reject(new Error("\u8D26\u5355\u5468\u671F\u8D77\u59CB\u65F6\u95F4\u65E0\u6548"));
    const [eventsSettled, sandSettled, planSettled] = await Promise.allSettled([
      eventsTask,
      fetchSandUsageStatus(),
      fetchPlanInfo()
    ]);
    const sand = sandSettled.status === "fulfilled" ? sandSettled.value : null;
    const events = eventsSettled.status === "fulfilled" ? eventsSettled.value : null;
    let weekEvents = null;
    let weekEventsError = null;
    const weekMs = sandWeekStartMs(sand);
    if (Number.isFinite(weekMs)) {
      try {
        weekEvents = await fetchAggregatedUsage(weekMs, Date.now());
      } catch (err) {
        weekEventsError = err instanceof Error ? err.message : "Grok Bot \u672C\u5468\u7528\u91CF\u8BF7\u6C42\u5931\u8D25";
      }
    }
    return {
      summary,
      events,
      eventsError: settledError(eventsSettled, "\u7528\u91CF\u4E8B\u4EF6\u8BF7\u6C42\u5931\u8D25"),
      sand,
      sandError: settledError(sandSettled, "Grok Bot \u5468\u9650\u989D\u8BF7\u6C42\u5931\u8D25"),
      planInfo: planSettled.status === "fulfilled" ? planSettled.value : null,
      planInfoError: settledError(planSettled, "\u5957\u9910\u4FE1\u606F\u8BF7\u6C42\u5931\u8D25"),
      weekEvents,
      weekEventsError
    };
  }
  function sandWeekStartMs(sand) {
    if (!sand || typeof sand !== "object" || Array.isArray(sand)) return NaN;
    let rec = sand;
    if (rec.data && typeof rec.data === "object" && !Array.isArray(rec.data) && rec.usagePercent == null) {
      rec = rec.data;
    }
    const raw = rec.currentPeriodStart;
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
      return raw < 1e11 ? raw * 1e3 : raw;
    }
    if (typeof raw === "string" && raw.trim()) {
      const trimmed = raw.trim();
      if (/^\d+$/.test(trimmed)) {
        const n = Number(trimmed);
        if (!Number.isFinite(n) || n <= 0) return NaN;
        return n < 1e11 ? n * 1e3 : n;
      }
      const time = Date.parse(trimmed);
      return Number.isNaN(time) ? NaN : time;
    }
    return NaN;
  }

  // src/lib/types.ts
  var CHANNEL = "CURSOR_USAGE_EXT";

  // src/bridge/index.ts
  function isRequest(data) {
    if (!data || typeof data !== "object") return false;
    const rec = data;
    return rec.channel === CHANNEL && rec.type === "FETCH";
  }
  function post(data) {
    window.postMessage({ channel: CHANNEL, ...data }, window.location.origin);
  }
  function hookHistory() {
    const wrap = (fn) => function(...args) {
      const result = fn.apply(this, args);
      post({ type: "NAV" });
      return result;
    };
    history.pushState = wrap(history.pushState);
    history.replaceState = wrap(history.replaceState);
    window.addEventListener("popstate", () => post({ type: "NAV" }));
  }
  var inflight = 0;
  async function handleFetch(requestId) {
    const mine = ++inflight;
    try {
      const payload = await loadUsagePayload();
      if (mine !== inflight) return;
      post({ type: "DATA", requestId, payload });
    } catch (err) {
      if (mine !== inflight) return;
      post({
        type: "ERROR",
        requestId,
        error: err instanceof Error ? err.message : "\u62C9\u53D6\u5931\u8D25",
        status: err instanceof ApiError ? err.status : 0
      });
    }
  }
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (!isRequest(event.data)) return;
    void handleFetch(event.data.requestId);
  });
  hookHistory();
})();
//# sourceMappingURL=page-bridge.js.map
