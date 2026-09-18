import { classifyModel, hasTeamData, modelLane, normalizePlan, planLabelOf } from "./classify";

export {
  classifyModel,
  isBotModel,
  modelLane,
  modelMatchesFilter,
  normalizePlan,
  parseModelFilter,
  planLabelOf,
  summarizeLanes,
} from "./classify";
import { centsToUsd, displayModelName, num } from "./format";
import type {
  AggregatedUsage,
  CapEstimate,
  EstimateSource,
  ModelRow,
  PlanKey,
  UsageNote,
  UsageSummary,
  UsageView,
} from "./types";

export type LearnedCap = {
  used: number;
  pct: number;
  value: number;
};

export type LearnedFirstParty = LearnedCap & { planKey: PlanKey };

export type PlanInfoCaps = {
  planName: string | null;
  /** Other Models / included API allowance in dollars. */
  otherUsd: number | null;
  /** Present if plan-info ever includes a first-party cap field. Display still inverts from usage. */
  firstPartyUsd: number | null;
};

export const UNATTRIBUTED_MIN = 0.5;
export const MAX_INVERT_PCT = 99.5;

/** Round an inferred cap to the nearest $10. Keep sub-$5 values so they do not collapse to $0. */
export function roundToTen(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return n;
  const rounded = Math.round(n / 10) * 10;
  return rounded > 0 ? rounded : n;
}

export function canInvertCap(used: number | null, pct: number | null): boolean {
  return (
    used != null &&
    pct != null &&
    Number.isFinite(used) &&
    Number.isFinite(pct) &&
    used > 0 &&
    pct > 0 &&
    pct < MAX_INVERT_PCT
  );
}

export const canInvertFirstParty = canInvertCap;

export function estimateInvertedCap(
  used: number | null,
  pct: number | null,
  learned: LearnedCap | null = null,
): CapEstimate {
  const prior = learned && learned.value > 0 ? learned : null;
  if (canInvertCap(used, pct)) {
    return {
      value: roundToTen(((used as number) * 100) / (pct as number)),
      source: "inverted",
      label: "反推",
    };
  }
  if (prior) {
    return {
      value: prior.value,
      source: "learned",
      label: "沿用上次",
    };
  }
  return { value: null, source: "none", label: "无法推断" };
}

/** used/total as a percent. Null when either side is missing or total is not positive. */
export function ratioPct(used: number | null, total: number | null): number | null {
  if (used == null || total == null) return null;
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null;
  return (used / total) * 100;
}

/**
 * Other Models dollars. Cursor's plan.used/limit is an included meter that
 * saturates at the API cap; it is not this pool. Official Other spend is
 * limit × apiPercentUsed / 100 (same as the dashboard "included API usage").
 */
export function estimateOtherPool(
  officialLimitUsd: number | null,
  apiPct: number | null,
): { used: number | null; total: number | null; pct: number | null; remaining: number | null } {
  const total =
    officialLimitUsd != null && Number.isFinite(officialLimitUsd) && officialLimitUsd > 0
      ? officialLimitUsd
      : null;
  if (total == null || apiPct == null || !Number.isFinite(apiPct)) {
    return { used: null, total, pct: apiPct, remaining: null };
  }
  const used = (total * apiPct) / 100;
  return {
    used,
    total,
    pct: apiPct,
    remaining: Math.max(0, total - used),
  };
}

export function estimateFirstPartyTotal(
  used: number | null,
  autoPct: number | null,
  planKey: PlanKey,
  opts: { learned?: LearnedFirstParty | null } = {},
): CapEstimate {
  const learned =
    opts.learned && opts.learned.planKey === planKey && opts.learned.value > 0 ? opts.learned : null;
  return estimateInvertedCap(used, autoPct, learned);
}

export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const end = new Date(iso).getTime();
  if (!Number.isFinite(end)) return null;
  return Math.ceil((end - Date.now()) / 86_400_000);
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asIso(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    if (/^\d+$/.test(value.trim())) return asIso(Number(value.trim()));
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : new Date(time).toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const ms = value < 1e11 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }
  return null;
}

function unwrapRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const rec = input as Record<string, unknown>;
  if (rec.data && typeof rec.data === "object" && !Array.isArray(rec.data) && rec.usagePercent == null) {
    return rec.data as Record<string, unknown>;
  }
  return rec;
}

const FIRST_PARTY_CENTS_KEY =
  /(auto|cursor.?model|first.?party|composer).*(cents|limit|included|allowance|cap)/i;

/** Plan-info from POST /api/dashboard/get-plan-info. Other cap is includedAmountCents. */
export function parsePlanInfo(input: unknown): PlanInfoCaps {
  const root = unwrapRecord(input);
  const info = unwrapRecord(root?.planInfo) ?? (root && "includedAmountCents" in root ? root : null);
  if (!info) return { planName: null, otherUsd: null, firstPartyUsd: null };

  const planName = typeof info.planName === "string" && info.planName.trim() ? info.planName.trim() : null;
  const otherUsd = centsFieldToUsd(info.includedAmountCents);
  let firstPartyUsd: number | null = null;
  for (const [key, value] of Object.entries(info)) {
    if (key === "includedAmountCents") continue;
    if (!FIRST_PARTY_CENTS_KEY.test(key)) continue;
    const usd = centsFieldToUsd(value);
    if (usd != null && (firstPartyUsd == null || usd > firstPartyUsd)) firstPartyUsd = usd;
  }
  return { planName, otherUsd, firstPartyUsd };
}

function centsFieldToUsd(value: unknown): number | null {
  const n = asFiniteNumber(value);
  if (n == null || n <= 0) return null;
  return n / 100;
}

/** Official Grok Bot weekly meter from POST /api/dashboard/get-sand-usage-status. */
export function parseSandUsage(input: unknown): {
  pct: number | null;
  remainingPct: number | null;
  resetAt: string | null;
  weekStart: string | null;
  hasAvailableUsage: boolean | null;
  hasLimit: boolean | null;
} {
  const root = unwrapRecord(input);
  const pct = root ? asFiniteNumber(root.usagePercent) : null;
  const remainingPct = pct == null ? null : Math.min(100, Math.max(0, 100 - pct));
  const hasAvailableUsage =
    root && typeof root.hasAvailableUsage === "boolean" ? root.hasAvailableUsage : null;
  const hasLimit =
    root && typeof root.hasNonZeroIncludedLimit === "boolean" ? root.hasNonZeroIncludedLimit : null;
  return {
    pct,
    remainingPct,
    resetAt: root ? asIso(root.nextResetTimestampUtc) : null,
    weekStart: root ? asIso(root.currentPeriodStart) : null,
    hasAvailableUsage,
    hasLimit,
  };
}

function toModelRow(item: {
  modelIntent?: string | null;
  inputTokens?: string | number;
  outputTokens?: string | number;
  cacheReadTokens?: string | number;
  cacheWriteTokens?: string | number;
  totalCents?: string | number;
  tier?: number;
}): ModelRow | null {
  const id = String(item.modelIntent || "").trim();
  const cost = centsToUsd(item.totalCents);
  if (!id && cost <= 0) return null;
  const pool = classifyModel(id || null, item.tier ?? null);
  const rowId = id || "(unnamed)";
  const name = id ? displayModelName(id) : "未命名";
  return {
    id: rowId,
    name,
    pool,
    lane: modelLane({ id: rowId, name, pool }),
    cost,
    inputTokens: num(item.inputTokens),
    outputTokens: num(item.outputTokens),
    cacheReadTokens: num(item.cacheReadTokens),
    cacheWriteTokens: num(item.cacheWriteTokens),
  };
}

function rowsFromEvents(events: AggregatedUsage | null): ModelRow[] {
  if (!events) return [];
  return (events.aggregations || [])
    .map(toModelRow)
    .filter((row): row is ModelRow => row != null)
    .sort((a, b) => b.cost - a.cost);
}

function laneSum(models: ModelRow[], lane: ModelRow["lane"]): number {
  return models.filter((model) => model.lane === lane).reduce((sum, model) => sum + model.cost, 0);
}

function invertGapNote(
  source: EstimateSource,
  pct: number | null,
  used: number | null,
  copy: {
    noneZero: string;
    noneMissing: string;
    noneFull: string;
    learnedZero: string;
    learnedMissing: string;
    learnedFull: string;
  },
): UsageNote | null {
  const full = pct != null && pct >= MAX_INVERT_PCT;
  if (source === "none") {
    return {
      tone: "info",
      text: full ? copy.noneFull : used == null ? copy.noneMissing : copy.noneZero,
    };
  }
  if (source === "learned") {
    return {
      tone: "info",
      text: full ? copy.learnedFull : used == null ? copy.learnedMissing : copy.learnedZero,
    };
  }
  return null;
}

export function buildView(
  summary: UsageSummary,
  events: AggregatedUsage | null,
  sand: unknown = null,
  extras: {
    planInfo?: unknown;
    learned?: LearnedFirstParty | null;
    learnedBot?: LearnedCap | null;
    weekEvents?: AggregatedUsage | null;
  } = {},
): UsageView {
  const plan = summary.individualUsage?.plan;
  const onDemand = summary.individualUsage?.onDemand;
  const hasIndividual = !!plan;
  const teamUnsupported = !hasIndividual && hasTeamData(summary.teamUsage);
  const planKey = normalizePlan(summary.membershipType);
  const hasEvents = events != null;
  const planCaps = parsePlanInfo(extras.planInfo);

  const autoPct = plan?.autoPercentUsed == null ? null : num(plan.autoPercentUsed);
  const apiPct = plan?.apiPercentUsed == null ? null : num(plan.apiPercentUsed);
  const otherFromSummary = plan?.limit == null ? null : centsToUsd(plan.limit);
  const otherLimitOfficial =
    otherFromSummary != null && otherFromSummary > 0 ? otherFromSummary : planCaps.otherUsd;
  const bonus = plan?.breakdown?.bonus == null ? 0 : centsToUsd(plan.breakdown.bonus);

  const models = rowsFromEvents(events);
  const cursorUsed = hasEvents ? laneSum(models, "cursor") : null;
  const botAmount = hasEvents ? laneSum(models, "bot") : 0;
  const unknownCost = hasEvents ? laneSum(models, "unknown") : 0;

  const first = estimateFirstPartyTotal(cursorUsed, autoPct, planKey, { learned: extras.learned });
  const otherPool = estimateOtherPool(otherLimitOfficial, apiPct);
  const otherUsed = otherPool.used;
  const otherLimit = otherPool.total;
  const otherPct = otherPool.pct;
  const otherRemaining = otherPool.remaining;
  const otherOfficial = otherUsed != null && otherLimit != null && otherPct != null;
  const sandUsage = parseSandUsage(sand);
  const weekEvents = extras.weekEvents;
  const botUsed = weekEvents != null ? laneSum(rowsFromEvents(weekEvents), "bot") : null;
  const botEst = estimateInvertedCap(botUsed, sandUsage.pct, extras.learnedBot ?? null);
  const botRemaining =
    botEst.value != null && botUsed != null ? Math.max(0, botEst.value - botUsed) : null;

  const cursorRemaining =
    first.value != null && cursorUsed != null ? Math.max(0, first.value - cursorUsed) : null;

  const onDemandUsed = onDemand?.used == null ? null : centsToUsd(onDemand.used);
  const onDemandLimit = onDemand?.limit == null ? null : centsToUsd(onDemand.limit);
  const onDemandVisible = !!(onDemand?.enabled || (onDemandUsed != null && onDemandUsed > 0));

  const notes: UsageView["notes"] = [];
  const firstNote = invertGapNote(first.source, autoPct, cursorUsed, {
    noneZero: "当前无法推断 Cursor Models 总额。本周期还没有第一方用量，也没有历史估算。",
    noneMissing: "当前无法推断 Cursor Models 总额。没有第一方账单，也没有历史估算。",
    noneFull: "第一方进度已满，无法从百分比反推总额。",
    learnedZero: "本周期第一方用量为 0，总额沿用上次估算。",
    learnedMissing: "没有第一方账单，总额沿用上次估算。",
    learnedFull: "第一方进度已满，总额沿用上次估算。",
  });
  if (firstNote) notes.push(firstNote);
  const botNote = invertGapNote(botEst.source, sandUsage.pct, botUsed, {
    noneZero: "当前无法推断 Grok Bot 周限额。本周还没有 Bot 用量，也没有历史估算。",
    noneMissing: "当前无法推断 Grok Bot 周限额。没有本周 Bot 账单，也没有历史估算。",
    noneFull: "Grok Bot 本周进度已满，无法从百分比反推总额。",
    learnedZero: "本周 Grok Bot 用量为 0，总额沿用上次估算。",
    learnedMissing: "没有本周 Bot 账单，总额沿用上次估算。",
    learnedFull: "Grok Bot 本周进度已满，总额沿用上次估算。",
  });
  if (botNote && (sandUsage.pct != null || botUsed != null || botEst.source === "learned")) notes.push(botNote);
  if (autoPct != null && autoPct >= MAX_INVERT_PCT) {
    notes.push({
      tone: "warn",
      text: "第一方池已接近或达到上限，超额可能计入 Other Models 或按需用量。",
    });
  }
  if (unknownCost >= UNATTRIBUTED_MIN) {
    notes.push({
      tone: "info",
      text: `有未归类模型 ${unknownCost.toFixed(2)} 美元，未计入任一进度条。`,
    });
  }
  if (!hasEvents) {
    notes.push({
      tone: "warn",
      text: "用量事件未拉到，第一方已用金额无法按模型加总。",
    });
  }
  if (sandUsage.pct != null && sandUsage.pct >= MAX_INVERT_PCT) {
    notes.push({
      tone: "warn",
      text: "Grok Bot 本周额度已用完，超额可能走按需用量。",
    });
  } else if (sandUsage.hasAvailableUsage === false) {
    notes.push({
      tone: "warn",
      text: "Grok Bot 当前没有可用周额度。",
    });
  }

  return {
    planKey,
    planLabel: planLabelOf(planKey),
    membershipType: String(summary.membershipType || ""),
    cycleStart: summary.billingCycleStart || null,
    cycleEnd: summary.billingCycleEnd || null,
    daysLeft: daysUntil(summary.billingCycleEnd),
    teamUnsupported,
    hasEvents,
    cursor: {
      used: cursorUsed,
      total: first.value,
      pct: autoPct,
      remaining: cursorRemaining,
      totalSource: first.source,
      totalLabel: first.label,
    },
    other: {
      used: otherUsed,
      total: otherLimit,
      pct: otherPct,
      remaining: otherRemaining,
      official: otherOfficial,
      bonus,
    },
    bot: {
      amount: botAmount,
      used: botUsed,
      total: botEst.value,
      remaining: botRemaining,
      totalSource: botEst.source,
      totalLabel: botEst.label,
      visible: botAmount >= UNATTRIBUTED_MIN || sandUsage.pct != null || botEst.value != null,
      pct: sandUsage.pct,
      remainingPct: sandUsage.remainingPct,
      resetAt: sandUsage.resetAt,
      weekStart: sandUsage.weekStart,
      daysLeft: daysUntil(sandUsage.resetAt),
      hasAvailableUsage: sandUsage.hasAvailableUsage,
      official: sandUsage.pct != null,
    },
    onDemand: {
      visible: onDemandVisible,
      enabled: !!onDemand?.enabled,
      used: onDemandUsed,
      limit: onDemandLimit,
    },
    models,
    notes,
  };
}

export function snapshotNeedsUpgrade(view: unknown): boolean {
  if (!view || typeof view !== "object") return false;
  if (!("bot" in view)) return true;
  const bot = (view as UsageView).bot;
  return !bot || !("totalSource" in bot);
}

/** Fill fields that older stored snapshots may omit. */
export function hydrateUsageView(view: UsageView): UsageView {
  const other = view.other;
  const otherPool = estimateOtherPool(other?.total ?? null, other?.pct ?? null);
  const models = view.models || [];
  const botAmount =
    view.bot?.amount ??
    models.filter((model) => modelLane(model) === "bot").reduce((sum, model) => sum + model.cost, 0);
  const resetAt = view.bot?.resetAt ?? null;
  const pct = view.bot?.pct ?? null;
  return {
    ...view,
    other: {
      used: otherPool.used,
      total: otherPool.total,
      pct: otherPool.pct,
      remaining: otherPool.remaining,
      official: otherPool.used != null && otherPool.total != null && otherPool.pct != null,
      bonus: other?.bonus ?? 0,
    },
    bot: {
      amount: botAmount,
      used: view.bot?.used ?? null,
      total: view.bot?.total ?? null,
      remaining:
        view.bot?.remaining ??
        (view.bot?.total != null && view.bot?.used != null ? Math.max(0, view.bot.total - view.bot.used) : null),
      totalSource: view.bot?.totalSource ?? "none",
      totalLabel: view.bot?.totalLabel ?? (view.bot?.total != null ? "沿用上次" : "无法推断"),
      visible: botAmount >= UNATTRIBUTED_MIN || pct != null || (view.bot?.total ?? null) != null,
      pct,
      remainingPct: view.bot?.remainingPct ?? null,
      resetAt,
      weekStart: view.bot?.weekStart ?? null,
      daysLeft: daysUntil(resetAt),
      hasAvailableUsage: view.bot?.hasAvailableUsage ?? null,
      official: view.bot?.official ?? pct != null,
    },
    daysLeft: daysUntil(view.cycleEnd),
  };
}
