import type { ModelLane, ModelRow, PlanKey, Pool } from "./types";

export type { ModelLane };

export type ModelFilter = "all" | "cursor" | "other" | "bot" | "unknown";

export const LANE_ORDER: ModelLane[] = ["cursor", "other", "bot", "unknown"];

export const LANE_META: Record<ModelLane, { label: string; short: string; hint: string; tag: string }> = {
  cursor: { label: "第一方", short: "第一方", hint: "计入 Cursor Models", tag: "第一方" },
  other: { label: "官方 Other", short: "Other", hint: "计入官方额度", tag: "官方 Other" },
  bot: { label: "Grok Bot", short: "Bot", hint: "不计入官方额度", tag: "Grok Bot" },
  unknown: { label: "未分类", short: "未分类", hint: "未归入任一池", tag: "未分类" },
};

export const MODEL_FILTERS: { id: ModelFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "cursor", label: LANE_META.cursor.label },
  { id: "other", label: LANE_META.other.label },
  { id: "bot", label: LANE_META.bot.label },
  { id: "unknown", label: LANE_META.unknown.label },
];

const BOT_TOKEN = /(^|[-_\s.])bot($|[-_\s.])/i;
const SAND_SKU = /(^|[-_\s.])sand($|[-_\s.])/i;
const GROK_BOT = /grok[-_\s]?bot/i;
const CURSOR_GROK = /(^|[-_\s.])cursor-grok([$_\s.-]|$)|\bcursor\s+grok\b/i;

function compactId(model: Pick<ModelRow, "id" | "name">): string {
  return `${model.id} ${model.name}`.toLowerCase().replace(/[_\s]+/g, "-");
}

export function isBotModel(model: Pick<ModelRow, "id" | "name">): boolean {
  const id = model.id || "";
  const name = model.name || "";
  const compact = compactId(model);
  if (CURSOR_GROK.test(id) || CURSOR_GROK.test(name) || compact.includes("cursor-grok")) return false;
  if (BOT_TOKEN.test(id) || BOT_TOKEN.test(name) || GROK_BOT.test(compact)) return true;
  if (SAND_SKU.test(id) || SAND_SKU.test(name) || compact.startsWith("sand-") || compact === "sand") return true;
  if (compact.includes("grok-api") || compact.includes("grok-agents")) return true;
  return false;
}

export function modelLane(model: Pick<ModelRow, "id" | "name" | "pool"> & { lane?: ModelLane }): ModelLane {
  if (isBotModel(model)) return "bot";
  if (model.pool === "cursor") return "cursor";
  if (model.pool === "other") return "other";
  return "unknown";
}

export function modelMatchesFilter(
  model: Pick<ModelRow, "id" | "name" | "pool"> & { lane?: ModelLane },
  filter: ModelFilter,
): boolean {
  if (filter === "all") return true;
  return modelLane(model) === filter;
}

export function parseModelFilter(value: unknown): ModelFilter {
  if (value === "unattributed") return "bot";
  return MODEL_FILTERS.some((item) => item.id === value) ? (value as ModelFilter) : "all";
}

export function summarizeLanes(
  models: Array<Pick<ModelRow, "id" | "name" | "pool" | "cost"> & { lane?: ModelLane }>,
): Record<ModelLane, { count: number; amount: number }> {
  const out: Record<ModelLane, { count: number; amount: number }> = {
    cursor: { count: 0, amount: 0 },
    other: { count: 0, amount: 0 },
    bot: { count: 0, amount: 0 },
    unknown: { count: 0, amount: 0 },
  };
  for (const model of models) {
    const lane = modelLane(model);
    out[lane].count += 1;
    out[lane].amount += model.cost;
  }
  return out;
}

const CURSOR_NAME = /^(composer|cursor-grok)([-_]|$)/i;

export function classifyModel(modelIntent: string | null | undefined, tier: number | null | undefined): Pool {
  const name = (modelIntent || "").trim();
  if (!name) return "unknown";
  if (tier === 2) return "cursor";
  if (CURSOR_NAME.test(name)) return "cursor";
  if (tier === 1) return "other";
  return "unknown";
}

export function normalizePlan(membershipType: string | null | undefined): PlanKey {
  const raw = String(membershipType || "")
    .trim()
    .toLowerCase()
    .replace(/\+/g, "_plus")
    .replace(/[\s-]+/g, "_");
  if (!raw) return "unknown";
  if (/(^|_)ultra(_|$)/.test(raw)) return "ultra";
  if (/(^|_)pro_plus(_|$)/.test(raw) || raw === "proplus") return "pro_plus";
  if (/(^|_)pro(_|$)/.test(raw)) return "pro";
  return "unknown";
}

export function planLabelOf(planKey: PlanKey): string {
  switch (planKey) {
    case "ultra":
      return "Ultra";
    case "pro_plus":
      return "Pro+";
    case "pro":
      return "Pro";
    default:
      return "未知套餐";
  }
}

export function hasTeamData(teamUsage: unknown): boolean {
  if (teamUsage == null) return false;
  if (Array.isArray(teamUsage)) return teamUsage.length > 0;
  if (typeof teamUsage === "object") return Object.keys(teamUsage as object).length > 0;
  return false;
}
