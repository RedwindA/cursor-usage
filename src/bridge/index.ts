import { ApiError, loadUsagePayload } from "../lib/api";
import { CHANNEL, type BridgeRequest } from "../lib/types";

function isRequest(data: unknown): data is BridgeRequest {
  if (!data || typeof data !== "object") return false;
  const rec = data as { channel?: unknown; type?: unknown };
  return rec.channel === CHANNEL && rec.type === "FETCH";
}

function post(data: Record<string, unknown>): void {
  window.postMessage({ channel: CHANNEL, ...data }, window.location.origin);
}

function hookHistory(): void {
  const wrap = (fn: typeof history.pushState) =>
    function (this: History, ...args: Parameters<typeof history.pushState>) {
      const result = fn.apply(this, args);
      post({ type: "NAV" });
      return result;
    };
  history.pushState = wrap(history.pushState);
  history.replaceState = wrap(history.replaceState);
  window.addEventListener("popstate", () => post({ type: "NAV" }));
}

let inflight = 0;

async function handleFetch(requestId: number): Promise<void> {
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
      error: err instanceof Error ? err.message : "拉取失败",
      status: err instanceof ApiError ? err.status : 0,
    });
  }
}

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window) return;
  if (!isRequest(event.data)) return;
  void handleFetch(event.data.requestId);
});

hookHistory();
