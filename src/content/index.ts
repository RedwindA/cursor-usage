import { isDashboardPath, isDashboardRoot } from "../lib/dom";
import { buildView, snapshotNeedsUpgrade, UNATTRIBUTED_MIN } from "../lib/estimate";
import {
  DEFAULT_REFRESH_POLICY,
  learnedBotFromView,
  learnedFromView,
  loadLearnedBot,
  loadLearnedFirstParty,
  loadRefreshSettings,
  markFetched,
  saveLearnedBot,
  saveLearnedFirstParty,
  saveRefreshPolicy,
  shouldAutoRefresh,
  type RefreshPolicy,
} from "../lib/settings";
import { CHANNEL, type BridgeResponse } from "../lib/types";
import { UsagePanel } from "./ui";

const CSS_URL = chrome.runtime.getURL("styles/panel.css");

let panel: UsagePanel | null = null;
let requestId = 0;
let lastPath = location.pathname;
let loginRetry = 0;
let policy: RefreshPolicy = DEFAULT_REFRESH_POLICY;
let lastAt: number | null = null;
let upgradeFetch = false;
let learnedFirstParty: Awaited<ReturnType<typeof loadLearnedFirstParty>> = null;
let learnedBot: Awaited<ReturnType<typeof loadLearnedBot>> = null;

function postToPage(type: "FETCH", extra: Record<string, unknown> = {}): void {
  window.postMessage({ channel: CHANNEL, type, ...extra }, window.location.origin);
}

function isResponse(data: unknown): data is BridgeResponse {
  if (!data || typeof data !== "object") return false;
  const rec = data as { channel?: unknown; type?: unknown };
  return rec.channel === CHANNEL && typeof rec.type === "string";
}

async function boot(): Promise<void> {
  const [cssText, settings, learned, botLearned] = await Promise.all([
    fetch(CSS_URL).then((r) => r.text()),
    loadRefreshSettings(),
    loadLearnedFirstParty(),
    loadLearnedBot(),
  ]);
  policy = settings.policy;
  lastAt = settings.lastAt;
  learnedFirstParty = learned;
  learnedBot = botLearned;
  panel = new UsagePanel(cssText, {
    onRefresh: () => refresh(true),
    onPolicyChange: (next) => {
      policy = next;
      void saveRefreshPolicy(next);
    },
  }, policy);
  await panel.attach();
  if (settings.snapshot) {
    panel.setView(settings.snapshot.view, settings.snapshot.updatedAt);
    upgradeFetch = snapshotNeedsUpgrade(settings.snapshot.view);
  }
  syncRoute();
}

function syncRoute(): void {
  const onDashboard = isDashboardPath();
  panel?.setRouteVisible(onDashboard);
  if (!onDashboard) return;
  refresh(false);
}

function refresh(manual: boolean): void {
  if (!panel || !isDashboardPath()) return;
  // Auto-refresh only on /dashboard root. Other dashboard tabs keep last data.
  if (!manual && !upgradeFetch) {
    if (!isDashboardRoot() && lastAt != null) return;
    if (!shouldAutoRefresh(policy, lastAt)) return;
  }
  upgradeFetch = false;
  if (manual || !document.hidden) panel.setLoading(true);
  requestId += 1;
  postToPage("FETCH", { requestId });
}

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window) return;
  if (!isResponse(event.data)) return;
  const msg = event.data;
  if (msg.type === "NAV") {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      syncRoute();
    }
    return;
  }
  if ("requestId" in msg && msg.requestId !== requestId) return;
  if (!panel) return;

  if (msg.type === "ERROR") {
    panel.setError(msg.error || "拉取失败");
    if ((msg.status === 401 || /登录/.test(msg.error || "")) && loginRetry < 1) {
      loginRetry += 1;
      window.setTimeout(() => refresh(true), 2000);
    }
    return;
  }
  loginRetry = 0;
  if (msg.type === "DATA") {
    const view = buildView(msg.payload.summary, msg.payload.events, msg.payload.sand, {
      planInfo: msg.payload.planInfo,
      learned: learnedFirstParty,
      learnedBot,
      weekEvents: msg.payload.weekEvents,
    });
    if (msg.payload.eventsError) {
      view.notes.push({ tone: "warn", text: msg.payload.eventsError });
    }
    if (msg.payload.sandError && view.bot.amount >= UNATTRIBUTED_MIN) {
      view.notes.push({ tone: "info", text: `Grok Bot 周限额未拉到：${msg.payload.sandError}` });
    }
    if (msg.payload.weekEventsError && view.bot.visible) {
      view.notes.push({ tone: "info", text: `Grok Bot 本周用量未拉到：${msg.payload.weekEventsError}` });
    }
    const nextLearned = learnedFromView(view);
    if (nextLearned) {
      learnedFirstParty = nextLearned;
      void saveLearnedFirstParty(nextLearned);
    }
    const nextBot = learnedBotFromView(view);
    if (nextBot) {
      learnedBot = nextBot;
      void saveLearnedBot(nextBot);
    }
    const at = Date.now();
    lastAt = at;
    void markFetched(view, at);
    panel.setView(view, at);
  }
});

chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
  if (message?.type === "TOGGLE_PANEL") {
    panel?.toggleHidden();
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && isDashboardRoot()) refresh(false);
});

void boot();
