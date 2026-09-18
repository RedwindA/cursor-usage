import { build } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const outfile = join(mkdtempSync(join(tmpdir(), "cu-")), "lib.mjs");

await build({
  entryPoints: ["src/lib/estimate.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile,
  logLevel: "silent",
});

const { buildView, canInvertFirstParty, estimateFirstPartyTotal, estimateInvertedCap, estimateOtherTotal, hydrateUsageView, parsePlanInfo, parseSandUsage, ratioPct, roundToTen, snapshotNeedsUpgrade } = await import(pathToFileURL(outfile).href);
const { classifyModel, isBotModel, modelLane, modelMatchesFilter, normalizePlan, parseModelFilter } = await import(pathToFileURL(outfile).href);

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function nearly(a, b, eps = 0.02) {
  return Math.abs(a - b) <= eps;
}

assert(roundToTen(3000.29) === 3000, "round 3000.29");
assert(roundToTen(2944) === 2940, "round 2944");
assert(roundToTen(2945) === 2950, "round 2945");
assert(roundToTen(4) === 4, "do not round a tiny invert to 0");
assert(roundToTen(45) === 50, "round 45 to 50");
assert(canInvertFirstParty(0, 0) === false, "zero spend cannot invert");
assert(canInvertFirstParty(864.53, 28.815) === true, "live spend can invert");
assert(canInvertFirstParty(300, 100) === false, "100% cannot invert");

const ultra = estimateFirstPartyTotal(22.7, 1.135, "ultra");
assert(ultra.source === "inverted", "ultra should invert");
assert(ultra.value === 2000, `ultra invert got ${ultra.value}`);

const proPlus = estimateFirstPartyTotal(778.25, 97.28125, "pro_plus");
assert(proPlus.value === 800, `pro+ invert got ${proPlus.value}`);

const pro = estimateFirstPartyTotal(85.46, 28.486666666666665, "pro");
assert(pro.value === 300, `pro invert got ${pro.value}`);

const tiny = estimateFirstPartyTotal(0.1, 0.005, "ultra");
assert(tiny.source === "inverted", "tiny but non-zero still inverts");
assert(tiny.value === 2000, `tiny invert got ${tiny.value}`);

const zeroNone = estimateFirstPartyTotal(0, 0, "ultra");
assert(zeroNone.source === "none", "zero with no history cannot infer");
assert(zeroNone.value == null, "zero with no history has no total");

const zeroHist = estimateFirstPartyTotal(0, 0, "ultra", {
  learned: { planKey: "ultra", used: 864.53, pct: 28.815, value: 3000 },
});
assert(zeroHist.source === "learned", "zero with history uses last invert");
assert(zeroHist.value === 3000, "zero history is 3000");

const full = estimateFirstPartyTotal(299.86, 100, "pro");
assert(full.source === "none", "100% without history cannot infer");
assert(full.value == null, "100% without history has no total");

const fullHist = estimateFirstPartyTotal(299.86, 100, "pro", {
  learned: { planKey: "pro", used: 85.46, pct: 28.49, value: 300 },
});
assert(fullHist.source === "learned", "100% with history uses last invert");
assert(fullHist.value === 300, "100% history is 300");

const student = estimateFirstPartyTotal(41.13, 91.4, "pro");
assert(student.source === "inverted", "student-like should invert");
assert(student.value === 50, `student invert got ${student.value}`);

const liveUltra = estimateFirstPartyTotal(864.5323, 28.815, "ultra");
assert(liveUltra.source === "inverted", "live ultra should invert");
assert(liveUltra.value === 3000, `live ultra invert got ${liveUltra.value}`);

const boosted = estimateFirstPartyTotal(45.4, 1.135, "ultra");
assert(boosted.source === "inverted", "2x pool should invert");
assert(boosted.value === 4000, `2x invert got ${boosted.value}`);

const wrongPlanHistory = estimateFirstPartyTotal(0, 0, "ultra", {
  learned: { planKey: "pro", used: 85, pct: 28, value: 300 },
});
assert(wrongPlanHistory.source === "none", "do not reuse another plan's history");

const planInfo = parsePlanInfo({
  planInfo: { planName: "Ultra", includedAmountCents: 40000, autoIncludedAmountCents: 200000 },
});
assert(planInfo.planName === "Ultra", "plan name");
assert(planInfo.otherUsd === 400, `other from includedAmountCents ${planInfo.otherUsd}`);
assert(planInfo.firstPartyUsd === 2000, `first party from autoIncludedAmountCents ${planInfo.firstPartyUsd}`);
assert(parsePlanInfo({ includedAmountCents: 7000 }).otherUsd === 70, "pro+ includedAmountCents");
assert(parsePlanInfo(null).otherUsd == null, "empty plan info");

const otherFromPlanInfo = buildView(
  { membershipType: "ultra", individualUsage: { plan: { apiPercentUsed: 18.1 } } },
  null,
  null,
  { planInfo: { planInfo: { includedAmountCents: 40000 } } },
);
assert(otherFromPlanInfo.other.total == null, "plan-info cap is not the other pool");
assert(otherFromPlanInfo.other.used == null, "other used needs model events");
assert(otherFromPlanInfo.other.totalSource === "none", "no events cannot invert other");

const otherInverted = estimateOtherTotal(72.4, 18.1, "ultra");
assert(otherInverted.source === "inverted", "other should invert");
assert(otherInverted.value === 400, `other invert got ${otherInverted.value}`);

const otherFromEvents = buildView(
  { membershipType: "ultra", individualUsage: { plan: { apiPercentUsed: 18.1 } } },
  { aggregations: [{ modelIntent: "claude-4.6-opus", totalCents: 7240, tier: 1 }] },
);
assert(nearly(otherFromEvents.other.used, 72.4), `other used ${otherFromEvents.other.used}`);
assert(otherFromEvents.other.total === 400, `other total ${otherFromEvents.other.total}`);
assert(otherFromEvents.other.totalSource === "inverted", "other is inverted from events");
assert(nearly(otherFromEvents.other.remaining, 400 - 72.4), `other remaining ${otherFromEvents.other.remaining}`);

const otherExcludesBot = buildView(
  { membershipType: "ultra", individualUsage: { plan: { apiPercentUsed: 18.1 } } },
  {
    aggregations: [
      { modelIntent: "claude-4.6-opus", totalCents: 7240, tier: 1 },
      { modelIntent: "grok-bot", totalCents: 66026, tier: 1 },
    ],
  },
);
assert(nearly(otherExcludesBot.other.used, 72.4), "bot spend is not other-pool used");
assert(otherExcludesBot.other.total === 400, "bot spend does not inflate other total");

const firstIgnoresPlanInfoCap = buildView(
  { membershipType: "ultra", individualUsage: { plan: { autoPercentUsed: 1.135 } } },
  { aggregations: [{ modelIntent: "composer-2.5", totalCents: 2270, tier: 2 }] },
  null,
  { planInfo: { planInfo: { includedAmountCents: 40000, autoIncludedAmountCents: 400000 } } },
);
assert(firstIgnoresPlanInfoCap.cursor.totalSource === "inverted", "first-party is inverted, not a plan-info cap");
assert(firstIgnoresPlanInfoCap.cursor.total === 2000, `inverted first-party ${firstIgnoresPlanInfoCap.cursor.total}`);

assert(normalizePlan("professional") === "unknown", "professional is not pro");
assert(normalizePlan("enterprise_plus") === "unknown", "enterprise_plus is not pro+");
assert(!modelMatchesFilter({ id: "both-models", name: "Both", pool: "other" }, "bot"), "both is not bot");
assert(!isBotModel({ id: "cursor-grok-4.6-xhigh-fast", name: "Grok 4.6" }), "cursor grok is not bot");
assert(isBotModel({ id: "sand-default", name: "Sand Default" }), "sand-default is grok bot");
assert(isBotModel({ id: "sand-automation", name: "Sand Automation" }), "sand-automation is grok bot");
assert(isBotModel({ id: "grok-bot", name: "Grok Bot" }), "grok-bot is bot");
assert(!isBotModel({ id: "claude-4.6-opus", name: "Claude" }), "claude is not bot");
assert(!isBotModel({ id: "grok-4", name: "Grok 4" }), "grok-4 chat is not bot");
assert(parseModelFilter("unattributed") === "bot", "legacy unattributed filter maps to bot");

assert(classifyModel("cursor-grok-4.6-xhigh-fast", 2) === "cursor", "cursor grok");
assert(classifyModel("composer-2.5-fast", null) === "cursor", "composer by name");
assert(classifyModel("claude-4.6-opus-high-thinking", 1) === "other", "claude other");
assert(classifyModel("grok-bot", 1) === "other", "bot billing pool stays other");
assert(modelLane({ id: "grok-bot", name: "Grok Bot", pool: "other" }) === "bot", "grok-bot lane");
assert(modelLane({ id: "sand-default", name: "Sand Default", pool: "other" }) === "bot", "sand-default lane is bot not other");
assert(!modelMatchesFilter({ id: "sand-default", name: "Sand Default", pool: "other" }, "other"), "sand-default not in official other");
assert(modelMatchesFilter({ id: "sand-default", name: "Sand Default", pool: "other" }, "bot"), "sand-default in bot filter");
assert(modelLane({ id: "cursor-grok-4.6-xhigh-fast", name: "Grok 4.6", pool: "cursor" }) === "cursor", "cursor grok lane");
assert(modelLane({ id: "claude-4.6", name: "Claude", pool: "other" }) === "other", "claude lane");
assert(modelMatchesFilter({ id: "grok-bot", name: "Grok Bot", pool: "other" }, "bot"), "bot in bot filter");
assert(modelMatchesFilter({ id: "claude-4.6", name: "Claude", pool: "other" }, "other"), "claude in other");
assert(!modelMatchesFilter({ id: "grok-bot", name: "Grok Bot", pool: "other" }, "other"), "bot not in official other");
assert(normalizePlan("ultra") === "ultra", "normalize ultra");
assert(normalizePlan("pro_plus") === "pro_plus", "normalize pro+");
assert(normalizePlan("Pro+") === "pro_plus", "normalize Pro+");

const view = buildView(
  {
    membershipType: "ultra",
    billingCycleStart: "2026-08-01T00:00:00.000Z",
    billingCycleEnd: "2026-09-01T00:00:00.000Z",
    individualUsage: {
      plan: {
        used: 145,
        limit: 40000,
        autoPercentUsed: 1.135,
        apiPercentUsed: 0.362,
      },
    },
  },
  {
    aggregations: [
      { modelIntent: "cursor-grok-4.6-xhigh-fast", totalCents: 2270, tier: 2 },
      { modelIntent: "claude-4.6-opus", totalCents: 144.8, tier: 1 },
      { modelIntent: "grok-bot", totalCents: 7370, tier: 1 },
    ],
  },
);

assert(nearly(view.cursor.used, 22.7), `cursor used ${view.cursor.used}`);
assert(view.cursor.totalSource === "inverted", "view first-party is inverted");
assert(view.cursor.total === 2000, `view first-party total ${view.cursor.total}`);
assert(nearly(view.other.used, 1.448), `other used ${view.other.used}`);
assert(view.other.total === 400, `view other total ${view.other.total}`);
assert(view.other.totalSource === "inverted", "view other is inverted");
assert(nearly(view.other.pct, 0.362), `other pct is apiPercentUsed, got ${view.other.pct}`);
assert(view.bot.visible, "bot ledger should show");
assert(nearly(view.bot.amount, 73.7), `bot amount ${view.bot.amount}`);
assert(view.bot.pct == null, "without SAND, weekly pct is unknown");
assert(view.bot.official === false, "without SAND, bot is not official weekly");
assert(view.models.find((m) => m.id === "grok-bot")?.lane === "bot", "grok-bot row lane");

assert(ratioPct(400, 400) === 100, "full other pool is 100%");
assert(ratioPct(400, 0) == null, "zero total has no ratio");
assert(ratioPct(null, 400) == null, "missing used has no ratio");

const directOther = estimateOtherTotal(72.4, 18.1, "ultra");
assert(directOther.source === "inverted", "estimateOtherTotal inverts");
assert(directOther.value === 400, `estimateOtherTotal ${directOther.value}`);

const otherCappedMeter = buildView(
  {
    membershipType: "ultra",
    individualUsage: {
      plan: {
        used: 40000,
        limit: 40000,
        remaining: 0,
        autoPercentUsed: 29.2,
        apiPercentUsed: 18.1,
        breakdown: { bonus: 27455 },
      },
    },
  },
  {
    aggregations: [
      { modelIntent: "cursor-grok-4.6-xhigh-fast", totalCents: 58416, tier: 2 },
      { modelIntent: "claude-4.6-opus", totalCents: 40000, tier: 1 },
      { modelIntent: "grok-bot", totalCents: 66026, tier: 1 },
    ],
  },
);
assert(nearly(otherCappedMeter.other.pct, 18.1), `capped meter must keep api 18.1%, got ${otherCappedMeter.other.pct}`);
assert(nearly(otherCappedMeter.other.used, 400), `other used is accumulated claude spend, got ${otherCappedMeter.other.used}`);
assert(otherCappedMeter.other.total === 2210, `other total inverts from events, got ${otherCappedMeter.other.total}`);
assert(otherCappedMeter.other.totalSource === "inverted", "capped meter other is inverted");
assert(nearly(otherCappedMeter.other.remaining, 2210 - 400), `other remaining ${otherCappedMeter.other.remaining}`);
assert(otherCappedMeter.other.total !== 400, "must not treat plan.limit as Other total");
assert(nearly(otherCappedMeter.bot.amount, 660.26, 0.05), `screenshot bot ${otherCappedMeter.bot.amount}`);
assert(otherCappedMeter.bot.pct == null, "screenshot without SAND has no weekly pct");

const LIVE_SAND = {
  usagePercent: 36.327845,
  currentPeriodStart: "2026-08-17T01:40:00.748Z",
  nextResetTimestampUtc: "2026-08-24T01:40:00.748Z",
  hasAvailableUsage: true,
  hasNonZeroIncludedLimit: true,
};
const sandParsed = parseSandUsage(LIVE_SAND);
assert(nearly(sandParsed.pct, 36.327845, 0.0001), `sand pct ${sandParsed.pct}`);
assert(nearly(sandParsed.remainingPct, 63.672155, 0.0001), `sand remaining ${sandParsed.remainingPct}`);
assert(sandParsed.resetAt === "2026-08-24T01:40:00.748Z", `sand reset ${sandParsed.resetAt}`);
assert(sandParsed.hasAvailableUsage === true, "sand hasAvailableUsage");
assert(sandParsed.hasLimit === true, "sand hasLimit");
assert(parseSandUsage({ hasAvailableUsage: true, used: 999, limit: 50 }).pct == null, "flags without usagePercent are not a quota");
const sandNoReset = parseSandUsage({
  usagePercent: 10,
  currentPeriodStart: "2026-08-17T01:40:00.748Z",
});
assert(sandNoReset.resetAt == null, "missing nextReset is unknown, not period start");
assert(sandNoReset.weekStart === "2026-08-17T01:40:00.748Z", "weekStart stays period start");

const botWeekly = buildView(
  {
    membershipType: "ultra",
    individualUsage: {
      plan: { used: 40000, limit: 40000, autoPercentUsed: 29.2, apiPercentUsed: 18.1 },
    },
  },
  {
    aggregations: [
      { modelIntent: "cursor-grok-4.6-xhigh-fast", totalCents: 58416, tier: 2 },
      { modelIntent: "claude-4.6-opus", totalCents: 40000, tier: 1 },
      { modelIntent: "grok-bot", totalCents: 66026, tier: 1 },
    ],
  },
  LIVE_SAND,
);
assert(botWeekly.bot.official, "SAND makes bot weekly official");
assert(nearly(botWeekly.bot.pct, 36.327845, 0.0001), `weekly bot pct ${botWeekly.bot.pct}`);
assert(nearly(botWeekly.bot.remainingPct, 63.672155, 0.0001), `weekly remaining ${botWeekly.bot.remainingPct}`);
assert(botWeekly.bot.resetAt === "2026-08-24T01:40:00.748Z", "weekly reset");
assert(nearly(botWeekly.bot.amount, 660.26, 0.05), "cycle bot dollars stay event-based");
assert(botWeekly.bot.used == null, "without week events, weekly used is unknown");
assert(botWeekly.bot.total == null, "without week events, do not invert monthly spend");
assert(
  botWeekly.notes.some((n) => n.text.includes("没有本周 Bot 账单")),
  "missing week events is not reported as zero usage",
);
assert(!botWeekly.notes.some((n) => n.text.includes("本周还没有 Bot 用量")), "do not call missing bills zero usage");
assert(Math.abs(botWeekly.bot.pct - 100) > 40, "weekly percent is not the monthly Other 100%");
assert(botWeekly.other.pct === 18.1, "Other pool stays monthly apiPercentUsed");

const botWeekEvents = {
  aggregations: [{ modelIntent: "grok-bot", totalCents: 66026, tier: 1 }],
};
const botInverted = estimateInvertedCap(660.26, 36.327845);
assert(botInverted.source === "inverted", "bot cap inverts");
assert(botInverted.value === 1820, `bot cap ${botInverted.value}`);
const botWeeklyCap = buildView(
  {
    membershipType: "ultra",
    individualUsage: {
      plan: { used: 40000, limit: 40000, autoPercentUsed: 29.2, apiPercentUsed: 18.1 },
    },
  },
  {
    aggregations: [
      { modelIntent: "cursor-grok-4.6-xhigh-fast", totalCents: 58416, tier: 2 },
      { modelIntent: "claude-4.6-opus", totalCents: 40000, tier: 1 },
      { modelIntent: "grok-bot", totalCents: 66026, tier: 1 },
    ],
  },
  LIVE_SAND,
  { weekEvents: botWeekEvents },
);
assert(nearly(botWeeklyCap.bot.used, 660.26, 0.05), `week bot used ${botWeeklyCap.bot.used}`);
assert(botWeeklyCap.bot.total === 1820, `week bot total ${botWeeklyCap.bot.total}`);
assert(botWeeklyCap.bot.totalSource === "inverted", "week bot is inverted");
assert(nearly(botWeeklyCap.bot.remaining, 1820 - 660.26, 0.5), `week bot remaining ${botWeeklyCap.bot.remaining}`);
assert(nearly(botWeeklyCap.bot.amount, 660.26, 0.05), "monthly bot bill stays on the card");

const botZeroHist = buildView(
  { membershipType: "ultra", individualUsage: { plan: { autoPercentUsed: 0, apiPercentUsed: 0, limit: 40000 } } },
  { aggregations: [] },
  { ...LIVE_SAND, usagePercent: 0 },
  { weekEvents: { aggregations: [] }, learnedBot: { used: 660.26, pct: 36.327845, value: 1820 } },
);
assert(botZeroHist.bot.totalSource === "learned", "zero week bot uses history");
assert(botZeroHist.bot.total === 1820, "zero week bot history 1820");
assert(botZeroHist.notes.some((n) => n.text.includes("Grok Bot") && n.text.includes("沿用上次")), "bot history is explained");

const sandMixed = buildView(
  { membershipType: "ultra", individualUsage: { plan: { used: 40000, limit: 40000, apiPercentUsed: 18.1, autoPercentUsed: 10 } } },
  {
    aggregations: [
      { modelIntent: "composer-2.5-fast", totalCents: 1000, tier: 2 },
      { modelIntent: "claude-4.6-opus", totalCents: 2000, tier: 1 },
      { modelIntent: "sand-default", totalCents: 50000, tier: 1 },
      { modelIntent: "sand-automation", totalCents: 8000, tier: 1 },
      { modelIntent: "gpt-5.6-sol", totalCents: 1500, tier: 1 },
    ],
  },
);
assert(sandMixed.models.filter((m) => m.lane === "bot").length === 2, "two sand rows are bot");
assert(sandMixed.models.filter((m) => m.lane === "other").length === 2, "claude and gpt stay official other");
assert(sandMixed.models.find((m) => m.id === "sand-default")?.name.startsWith("Grok Bot"), "sand-default display name");
assert(nearly(sandMixed.bot.amount, 580, 0.05), `sand bot dollars ${sandMixed.bot.amount}`);
assert(!sandMixed.models.some((m) => m.lane === "bot" && modelMatchesFilter(m, "other")), "no bot row matches official other");
assert(otherCappedMeter.models.find((m) => m.id === "claude-4.6-opus")?.lane === "other", "claude is official other");
assert(otherCappedMeter.models.find((m) => m.id === "grok-bot")?.lane === "bot", "screenshot grok-bot is bot");
assert(otherCappedMeter.models.find((m) => m.id === "cursor-grok-4.6-xhigh-fast")?.lane === "cursor", "screenshot cursor grok is first party");

const legacySnap = {
  planKey: "ultra",
  planLabel: "Ultra",
  membershipType: "ultra",
  cycleStart: null,
  cycleEnd: "2026-09-01T00:00:00.000Z",
  daysLeft: 9,
  teamUnsupported: false,
  hasEvents: true,
  cursor: {
    used: 584.16,
    total: 2000,
    pct: 29.2,
    remaining: 1415.84,
    totalSource: "catalog",
    totalLabel: "经验值",
    catalogMatch: false,
    catalogValue: 2000,
  },
  other: { used: 400, total: 400, pct: 18.1, remaining: 0, official: true, bonus: 274.55 },
  onDemand: { visible: false, enabled: false, used: null, limit: null },
  models: [
    {
      id: "grok-bot",
      name: "Grok Bot",
      pool: "other",
      cost: 660.26,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  ],
  notes: [],
};
assert(snapshotNeedsUpgrade(legacySnap), "pre-bot snapshot needs upgrade fetch");
const hydratedLegacy = hydrateUsageView(legacySnap);
assert(!snapshotNeedsUpgrade(hydratedLegacy), "hydrated view has bot");
assert(nearly(hydratedLegacy.other.used, 400), `hydrate keeps stored other used until refetch, got ${hydratedLegacy.other.used}`);
assert(hydratedLegacy.other.totalSource === "learned", "legacy other without totalSource hydrates as learned");
assert(snapshotNeedsUpgrade(legacySnap), "legacy other without totalSource needs upgrade");
assert(nearly(hydratedLegacy.bot.amount, 660.26, 0.05), `hydrate bot from models ${hydratedLegacy.bot.amount}`);
assert(hydratedLegacy.bot.pct == null, "legacy snapshot has no weekly pct");
const hydratedFresh = hydrateUsageView(otherCappedMeter);
assert(nearly(hydratedFresh.other.used, otherCappedMeter.other.used), "hydrate is idempotent on new views");
assert(hydratedFresh.other.totalSource === otherCappedMeter.other.totalSource, "hydrate keeps other totalSource");
const otherWithoutSource = { ...hydratedFresh.other };
delete otherWithoutSource.totalSource;
assert(snapshotNeedsUpgrade({ ...hydratedFresh, other: otherWithoutSource }), "missing other.totalSource needs upgrade");

const forumSample = buildView(
  {
    membershipType: "ultra",
    individualUsage: {
      plan: {
        used: 2943,
        limit: 40000,
        remaining: 37057,
        autoPercentUsed: 2.755,
        apiPercentUsed: 0.376,
      },
    },
  },
  {
    aggregations: [
      { modelIntent: "composer-1.5", totalCents: 2782.59541, tier: 2 },
      { modelIntent: "claude-4.6-opus-high-thinking", totalCents: 188.128825, tier: 1 },
    ],
  },
);
assert(nearly(forumSample.other.used, 1.88128825), `forum other used ${forumSample.other.used} vs plan.used $29.43`);
assert(forumSample.other.used < 5, "forum other spend is the claude bill, not $29.43 included meter");
assert(forumSample.other.total === 500, `forum other total ${forumSample.other.total}`);
assert(forumSample.other.totalSource === "inverted", "forum other is inverted");
assert(nearly(forumSample.other.pct, 0.376), `forum api pct ${forumSample.other.pct}`);

const otherFallback = buildView(
  { membershipType: "ultra", individualUsage: { plan: { apiPercentUsed: 18.1 } } },
  null,
);
assert(nearly(otherFallback.other.pct, 18.1), `api pct ${otherFallback.other.pct}`);
assert(otherFallback.other.total == null, "no events cannot invert other total");
assert(otherFallback.other.used == null, "other used unknown without events");
assert(otherFallback.other.totalSource === "none", "other fallback source is none");

const zeroFirst = buildView(
  { membershipType: "ultra", individualUsage: { plan: { autoPercentUsed: 0, apiPercentUsed: 0, limit: 40000 } } },
  { aggregations: [] },
);
assert(zeroFirst.cursor.totalSource === "none", "zero first-party with no history");
assert(zeroFirst.cursor.total == null, "zero first-party total is unknown");
assert(zeroFirst.notes.some((n) => n.text.includes("无法推断")), "zero first-party explains it");

const zeroFirstHist = buildView(
  { membershipType: "ultra", individualUsage: { plan: { autoPercentUsed: 0, apiPercentUsed: 0, limit: 40000 } } },
  { aggregations: [] },
  null,
  { learned: { planKey: "ultra", used: 864.53, pct: 28.815, value: 3000 } },
);
assert(zeroFirstHist.cursor.totalSource === "learned", "zero first-party uses history");
assert(zeroFirstHist.cursor.total === 3000, "zero first-party history 3000");
assert(zeroFirstHist.notes.some((n) => n.text.includes("沿用上次")), "history is explained");

const zeroOtherHist = buildView(
  { membershipType: "ultra", individualUsage: { plan: { autoPercentUsed: 0, apiPercentUsed: 0, limit: 40000 } } },
  { aggregations: [] },
  null,
  { learnedOther: { planKey: "ultra", used: 72.4, pct: 18.1, value: 400 } },
);
assert(zeroOtherHist.other.totalSource === "learned", "zero other uses history");
assert(zeroOtherHist.other.total === 400, "zero other history 400");
assert(zeroOtherHist.notes.some((n) => n.text.includes("第三方") && n.text.includes("沿用上次")), "other history is explained");

const wrongOtherHistory = estimateOtherTotal(0, 0, "ultra", {
  learned: { planKey: "pro", used: 72.4, pct: 18.1, value: 400 },
});
assert(wrongOtherHistory.source === "none", "do not reuse another plan's other history");

const noApiPct = buildView(
  { membershipType: "ultra", individualUsage: { plan: { used: 40000, limit: 40000 } } },
  null,
);
assert(noApiPct.other.used == null, "without apiPercentUsed do not show plan.used as Other used");
assert(noApiPct.other.pct == null, "without apiPercentUsed Other pct is unknown");

const unnamed = buildView(
  { membershipType: "pro", individualUsage: { plan: { used: 0, limit: 2000, autoPercentUsed: 0 } } },
  { aggregations: [{ totalCents: 250, tier: 1 }] },
);
assert(unnamed.models.length === 1 && unnamed.models[0].pool === "unknown", "unnamed aggregation kept");

const formatOut = join(mkdtempSync(join(tmpdir(), "cu-f-")), "format.mjs");
await build({
  entryPoints: ["src/lib/format.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: formatOut,
  logLevel: "silent",
});
const { formatResetAt } = await import(pathToFileURL(formatOut).href);
const resetNow = Date.parse("2026-08-23T01:00:00.000Z");
assert(formatResetAt("2026-08-23T06:00:00.000Z", resetNow).startsWith("5 小时后重置"), `5h got ${formatResetAt("2026-08-23T06:00:00.000Z", resetNow)}`);
assert(formatResetAt("2026-08-24T13:00:00.000Z", resetNow).startsWith("1 天 12 小时后重置"), `36h got ${formatResetAt("2026-08-24T13:00:00.000Z", resetNow)}`);
assert(formatResetAt("2026-08-24T01:00:00.000Z", resetNow).startsWith("1 天后重置"), `24h got ${formatResetAt("2026-08-24T01:00:00.000Z", resetNow)}`);
assert(formatResetAt("2026-08-23T00:30:00.000Z", resetNow) === "即将重置", "past reset");
assert(formatResetAt(null, resetNow) === "重置未知", "missing reset");

const settingsOut = join(mkdtempSync(join(tmpdir(), "cu-s-")), "settings.mjs");
await build({
  entryPoints: ["src/lib/settings.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: settingsOut,
  logLevel: "silent",
  banner: { js: "const chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };" },
});
const { shouldAutoRefresh } = await import(pathToFileURL(settingsOut).href);
const now = 1_000_000;
assert(shouldAutoRefresh("1m", null, now) === true, "first visit always refreshes");
assert(shouldAutoRefresh("1m", now - 10_000, now) === false, "1m cooldown blocks");
assert(shouldAutoRefresh("1m", now - 61_000, now) === true, "1m cooldown expired");
assert(shouldAutoRefresh("always", now - 1_000, now) === true, "always refreshes");
assert(shouldAutoRefresh("manual", now - 3_600_000, now) === false, "manual never auto after first");

const tokensOut = join(mkdtempSync(join(tmpdir(), "cu-t-")), "tokens.mjs");
await build({
  entryPoints: ["src/lib/tokens.ts"],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: tokensOut,
  logLevel: "silent",
});
const { toTokenStats, addTokenStats } = await import(pathToFileURL(tokensOut).href);
const one = toTokenStats({
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 80,
  cacheWriteTokens: 10,
});
assert(one.total === 105, `total ${one.total}`);
assert(one.cache === 90, `cache ${one.cache}`);
assert(Math.abs(one.hitRate - 80) < 0.01, `hit ${one.hitRate}`);
const sumTok = addTokenStats([
  { inputTokens: 10, outputTokens: 5, cacheReadTokens: 80, cacheWriteTokens: 10 },
  { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
]);
assert(sumTok.total === 120, `sum total ${sumTok.total}`);
assert(Math.abs(sumTok.hitRate - (80 / 110) * 100) < 0.01, `sum hit ${sumTok.hitRate}`);

console.log("verify ok");
