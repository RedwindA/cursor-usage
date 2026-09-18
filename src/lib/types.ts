export type PlanKey = "pro" | "pro_plus" | "ultra" | "unknown";

export type Pool = "cursor" | "other" | "unknown";

export type ModelLane = "cursor" | "other" | "bot" | "unknown";

export type EstimateSource = "inverted" | "learned" | "none";

export type UsageSummary = {
  billingCycleStart?: string;
  billingCycleEnd?: string;
  membershipType?: string;
  individualUsage?: {
    plan?: {
      enabled?: boolean;
      used?: number;
      limit?: number;
      remaining?: number;
      breakdown?: {
        included?: number;
        bonus?: number;
        total?: number;
      };
      autoPercentUsed?: number;
      apiPercentUsed?: number;
      totalPercentUsed?: number;
    };
    onDemand?: {
      enabled?: boolean;
      used?: number | null;
      limit?: number | null;
      remaining?: number | null;
    };
  };
  teamUsage?: unknown;
};

export type UsageAggregation = {
  modelIntent?: string | null;
  inputTokens?: string | number;
  outputTokens?: string | number;
  cacheReadTokens?: string | number;
  cacheWriteTokens?: string | number;
  totalCents?: string | number;
  tier?: number;
};

export type AggregatedUsage = {
  aggregations?: UsageAggregation[];
  totalCostCents?: number;
};

export type ModelRow = {
  id: string;
  name: string;
  pool: Pool;
  lane: ModelLane;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type CapEstimate = {
  value: number | null;
  source: EstimateSource;
  label: string;
};

export type NoteTone = "info" | "warn";

export type UsageNote = {
  tone: NoteTone;
  text: string;
};

export type UsageView = {
  planKey: PlanKey;
  planLabel: string;
  membershipType: string;
  cycleStart: string | null;
  cycleEnd: string | null;
  daysLeft: number | null;
  teamUnsupported: boolean;
  hasEvents: boolean;
  cursor: {
    used: number | null;
    total: number | null;
    pct: number | null;
    remaining: number | null;
    totalSource: EstimateSource;
    totalLabel: string;
  };
  other: {
    used: number | null;
    total: number | null;
    pct: number | null;
    remaining: number | null;
    official: boolean;
    bonus: number;
  };
  bot: {
    amount: number;
    used: number | null;
    total: number | null;
    remaining: number | null;
    totalSource: EstimateSource;
    totalLabel: string;
    visible: boolean;
    pct: number | null;
    remainingPct: number | null;
    resetAt: string | null;
    weekStart: string | null;
    daysLeft: number | null;
    hasAvailableUsage: boolean | null;
    official: boolean;
  };
  onDemand: {
    visible: boolean;
    enabled: boolean;
    used: number | null;
    limit: number | null;
  };
  models: ModelRow[];
  notes: UsageNote[];
};

export const CHANNEL = "CURSOR_USAGE_EXT";

export type BridgeRequest = { channel: typeof CHANNEL; type: "FETCH"; requestId: number };

export type BridgeResponse =
  | {
      channel: typeof CHANNEL;
      type: "DATA";
      requestId: number;
      payload: {
        summary: UsageSummary;
        events: AggregatedUsage | null;
        eventsError: string | null;
        sand: unknown;
        sandError: string | null;
        planInfo: unknown;
        planInfoError: string | null;
        weekEvents: AggregatedUsage | null;
        weekEventsError: string | null;
      };
    }
  | {
      channel: typeof CHANNEL;
      type: "ERROR";
      requestId: number;
      error: string;
      status?: number;
    }
  | { channel: typeof CHANNEL; type: "NAV" };
