import type { LearnedCap, LearnedFirstParty, LearnedOther } from "./estimate";
import type { PlanKey, UsageView } from "./types";

export type RefreshPolicy = "always" | "1m" | "5m" | "10m" | "manual";

export type UsageSnapshot = {
  view: UsageView;
  updatedAt: number;
};

export const DEFAULT_REFRESH_POLICY: RefreshPolicy = "1m";

export const REFRESH_POLICY_OPTIONS: { id: RefreshPolicy; label: string; hint: string }[] = [
  { id: "always", label: "每次进入都刷新", hint: "回到 Dashboard 就拉一次" },
  { id: "1m", label: "1 分钟内不刷新", hint: "默认" },
  { id: "5m", label: "5 分钟内不刷新", hint: "" },
  { id: "10m", label: "10 分钟内不刷新", hint: "" },
  { id: "manual", label: "仅手动刷新", hint: "第一次仍会自动拉" },
];

export const STORAGE_REFRESH_POLICY = "cu.refresh.policy";
export const STORAGE_REFRESH_LAST_AT = "cu.refresh.lastAt";
export const STORAGE_SNAPSHOT = "cu.refresh.snapshot";
export const STORAGE_LEARNED_FIRST_PARTY = "cu.learned.firstParty";
export const STORAGE_LEARNED_OTHER = "cu.learned.other";
export const STORAGE_LEARNED_BOT = "cu.learned.bot";

export function parsePolicy(value: unknown): RefreshPolicy {
  return REFRESH_POLICY_OPTIONS.some((item) => item.id === value)
    ? (value as RefreshPolicy)
    : DEFAULT_REFRESH_POLICY;
}

export function policyLabel(policy: RefreshPolicy): string {
  return REFRESH_POLICY_OPTIONS.find((item) => item.id === policy)?.label ?? "1 分钟内不刷新";
}

export function cooldownMs(policy: RefreshPolicy): number {
  switch (policy) {
    case "always":
      return 0;
    case "1m":
      return 60_000;
    case "5m":
      return 5 * 60_000;
    case "10m":
      return 10 * 60_000;
    case "manual":
      return Number.POSITIVE_INFINITY;
  }
}

/** First visit always refreshes. Later visits follow the cooldown. */
export function shouldAutoRefresh(policy: RefreshPolicy, lastAt: number | null, now = Date.now()): boolean {
  if (lastAt == null) return true;
  const wait = cooldownMs(policy);
  if (wait === 0) return true;
  if (!Number.isFinite(wait)) return false;
  return now - lastAt >= wait;
}

export async function loadRefreshSettings(): Promise<{
  policy: RefreshPolicy;
  lastAt: number | null;
  snapshot: UsageSnapshot | null;
}> {
  const stored = await chrome.storage.local.get([
    STORAGE_REFRESH_POLICY,
    STORAGE_REFRESH_LAST_AT,
    STORAGE_SNAPSHOT,
  ]);
  const lastAt = typeof stored[STORAGE_REFRESH_LAST_AT] === "number" ? stored[STORAGE_REFRESH_LAST_AT] : null;
  const snapshot = isSnapshot(stored[STORAGE_SNAPSHOT]) ? stored[STORAGE_SNAPSHOT] : null;
  return { policy: parsePolicy(stored[STORAGE_REFRESH_POLICY]), lastAt, snapshot };
}

export async function saveRefreshPolicy(policy: RefreshPolicy): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_REFRESH_POLICY]: policy });
}

export async function markFetched(view: UsageView, at = Date.now()): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_REFRESH_LAST_AT]: at,
    [STORAGE_SNAPSHOT]: { view, updatedAt: at } satisfies UsageSnapshot,
  });
}

export async function loadLearnedFirstParty(): Promise<LearnedFirstParty | null> {
  const stored = await chrome.storage.local.get(STORAGE_LEARNED_FIRST_PARTY);
  return parseLearned(stored[STORAGE_LEARNED_FIRST_PARTY]);
}

export async function saveLearnedFirstParty(learned: LearnedFirstParty): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_LEARNED_FIRST_PARTY]: learned });
}

export async function loadLearnedOther(): Promise<LearnedOther | null> {
  const stored = await chrome.storage.local.get(STORAGE_LEARNED_OTHER);
  return parseLearned(stored[STORAGE_LEARNED_OTHER]);
}

export async function saveLearnedOther(learned: LearnedOther): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_LEARNED_OTHER]: learned });
}

export async function loadLearnedBot(): Promise<LearnedCap | null> {
  const stored = await chrome.storage.local.get(STORAGE_LEARNED_BOT);
  return parseLearnedCap(stored[STORAGE_LEARNED_BOT]);
}

export async function saveLearnedBot(learned: LearnedCap): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_LEARNED_BOT]: learned });
}

export function learnedFromView(view: UsageView): LearnedFirstParty | null {
  const cap = capFromInvert(view.cursor.used, view.cursor.pct, view.cursor.total, view.cursor.totalSource);
  return cap ? { planKey: view.planKey, ...cap } : null;
}

export function learnedOtherFromView(view: UsageView): LearnedOther | null {
  const cap = capFromInvert(view.other.used, view.other.pct, view.other.total, view.other.totalSource);
  return cap ? { planKey: view.planKey, ...cap } : null;
}

export function learnedBotFromView(view: UsageView): LearnedCap | null {
  return capFromInvert(view.bot.used, view.bot.pct, view.bot.total, view.bot.totalSource);
}

function capFromInvert(
  used: number | null | undefined,
  pct: number | null | undefined,
  value: number | null | undefined,
  source: string | undefined,
): LearnedCap | null {
  if (source !== "inverted") return null;
  if (used == null || pct == null || value == null) return null;
  if (!Number.isFinite(used) || !Number.isFinite(pct) || !Number.isFinite(value)) return null;
  if (used <= 0 || pct <= 0 || value <= 0) return null;
  return { used, pct, value };
}

function parseLearned(value: unknown): LearnedFirstParty | null {
  const cap = parseLearnedCap(value);
  if (!cap) return null;
  const planKey = (value as LearnedFirstParty).planKey as PlanKey;
  if (planKey !== "pro" && planKey !== "pro_plus" && planKey !== "ultra" && planKey !== "unknown") return null;
  return { planKey, ...cap };
}

function parseLearnedCap(value: unknown): LearnedCap | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as LearnedCap;
  if (![rec.used, rec.pct, rec.value].every((n) => typeof n === "number" && Number.isFinite(n) && n > 0)) {
    return null;
  }
  return { used: rec.used, pct: rec.pct, value: rec.value };
}

function isSnapshot(value: unknown): value is UsageSnapshot {
  if (!value || typeof value !== "object") return false;
  const rec = value as UsageSnapshot;
  return !!rec.view && typeof rec.updatedAt === "number";
}
