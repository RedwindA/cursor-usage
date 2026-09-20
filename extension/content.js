"use strict";
(() => {
  // src/lib/dom.ts
  function h(tag, attrs = null, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value == null || value === false) continue;
        if (key === "class") {
          el.className = String(value);
          continue;
        }
        if (value === true) {
          el.setAttribute(key, "");
          continue;
        }
        el.setAttribute(key, String(value));
      }
    }
    for (const child of children) {
      if (child == null || child === false) continue;
      el.append(typeof child === "string" ? document.createTextNode(child) : child);
    }
    return el;
  }
  function isDashboardPath(pathname = location.pathname) {
    return /\/dashboard(\/|$)/.test(pathname);
  }
  function isDashboardRoot(pathname = location.pathname) {
    return /(?:^|\/)dashboard\/?$/.test(pathname);
  }
  function detectTheme() {
    const bg = getComputedStyle(document.body).backgroundColor;
    const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return "dark";
    const r = Number(m[1]);
    const g = Number(m[2]);
    const b = Number(m[3]);
    const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return l > 0.65 ? "light" : "dark";
  }
  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  // src/lib/classify.ts
  var LANE_ORDER = ["cursor", "other", "bot", "unknown"];
  var LANE_META = {
    cursor: { label: "\u7B2C\u4E00\u65B9", short: "\u7B2C\u4E00\u65B9", hint: "\u8BA1\u5165 Cursor Models", tag: "\u7B2C\u4E00\u65B9" },
    other: { label: "\u5B98\u65B9 Other", short: "Other", hint: "\u8BA1\u5165\u5B98\u65B9\u989D\u5EA6", tag: "\u5B98\u65B9 Other" },
    bot: { label: "Grok Bot", short: "Bot", hint: "\u4E0D\u8BA1\u5165\u5B98\u65B9\u989D\u5EA6", tag: "Grok Bot" },
    unknown: { label: "\u672A\u5206\u7C7B", short: "\u672A\u5206\u7C7B", hint: "\u672A\u5F52\u5165\u4EFB\u4E00\u6C60", tag: "\u672A\u5206\u7C7B" }
  };
  var MODEL_FILTERS = [
    { id: "all", label: "\u5168\u90E8" },
    { id: "cursor", label: LANE_META.cursor.label },
    { id: "other", label: LANE_META.other.label },
    { id: "bot", label: LANE_META.bot.label },
    { id: "unknown", label: LANE_META.unknown.label }
  ];
  var BOT_TOKEN = /(^|[-_\s.])bot($|[-_\s.])/i;
  var SAND_SKU = /(^|[-_\s.])sand($|[-_\s.])/i;
  var GROK_BOT = /grok[-_\s]?bot/i;
  var CURSOR_GROK = /(^|[-_\s.])cursor-grok([$_\s.-]|$)|\bcursor\s+grok\b/i;
  function compactId(model) {
    return `${model.id} ${model.name}`.toLowerCase().replace(/[_\s]+/g, "-");
  }
  function isBotModel(model) {
    const id = model.id || "";
    const name = model.name || "";
    const compact = compactId(model);
    if (CURSOR_GROK.test(id) || CURSOR_GROK.test(name) || compact.includes("cursor-grok")) return false;
    if (BOT_TOKEN.test(id) || BOT_TOKEN.test(name) || GROK_BOT.test(compact)) return true;
    if (SAND_SKU.test(id) || SAND_SKU.test(name) || compact.startsWith("sand-") || compact === "sand") return true;
    if (compact.includes("grok-api") || compact.includes("grok-agents")) return true;
    return false;
  }
  function modelLane(model) {
    if (isBotModel(model)) return "bot";
    if (model.pool === "cursor") return "cursor";
    if (model.pool === "other") return "other";
    return "unknown";
  }
  function modelMatchesFilter(model, filter) {
    if (filter === "all") return true;
    return modelLane(model) === filter;
  }
  function parseModelFilter(value) {
    if (value === "unattributed") return "bot";
    return MODEL_FILTERS.some((item) => item.id === value) ? value : "all";
  }
  function summarizeLanes(models) {
    const out = {
      cursor: { count: 0, amount: 0 },
      other: { count: 0, amount: 0 },
      bot: { count: 0, amount: 0 },
      unknown: { count: 0, amount: 0 }
    };
    for (const model of models) {
      const lane = modelLane(model);
      out[lane].count += 1;
      out[lane].amount += model.cost;
    }
    return out;
  }
  var CURSOR_NAME = /^(composer|cursor-grok)([-_]|$)/i;
  function classifyModel(modelIntent, tier) {
    const name = (modelIntent || "").trim();
    if (!name) return "unknown";
    if (tier === 2) return "cursor";
    if (CURSOR_NAME.test(name)) return "cursor";
    if (tier === 1) return "other";
    return "unknown";
  }
  function normalizePlan(membershipType) {
    const raw = String(membershipType || "").trim().toLowerCase().replace(/\+/g, "_plus").replace(/[\s-]+/g, "_");
    if (!raw) return "unknown";
    if (/(^|_)ultra(_|$)/.test(raw)) return "ultra";
    if (/(^|_)pro_plus(_|$)/.test(raw) || raw === "proplus") return "pro_plus";
    if (/(^|_)pro(_|$)/.test(raw)) return "pro";
    return "unknown";
  }
  function planLabelOf(planKey) {
    switch (planKey) {
      case "ultra":
        return "Ultra";
      case "pro_plus":
        return "Pro+";
      case "pro":
        return "Pro";
      default:
        return "\u672A\u77E5\u5957\u9910";
    }
  }
  function hasTeamData(teamUsage) {
    if (teamUsage == null) return false;
    if (Array.isArray(teamUsage)) return teamUsage.length > 0;
    if (typeof teamUsage === "object") return Object.keys(teamUsage).length > 0;
    return false;
  }

  // src/lib/format.ts
  function num(value) {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
  }
  function centsToUsd(cents) {
    return num(cents) / 100;
  }
  function formatMoney(value, digits = 2) {
    if (value == null || !Number.isFinite(value)) return "\u2014";
    const abs = Math.abs(value);
    const formatted = abs.toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
    return value < 0 ? `-$${formatted}` : `$${formatted}`;
  }
  function formatPct(value) {
    if (value == null || !Number.isFinite(value)) return "\u2014";
    const digits = value > 0 && value < 1 ? 2 : value >= 10 ? 1 : 2;
    return `${value.toFixed(digits)}%`;
  }
  function formatTokens(value) {
    if (value == null || !Number.isFinite(value) || value <= 0) return "0";
    const abs = Math.abs(value);
    if (abs >= 1e9) return `${trimNum(abs / 1e9)}B`;
    if (abs >= 1e6) return `${trimNum(abs / 1e6)}M`;
    if (abs >= 1e3) return `${trimNum(abs / 1e3)}K`;
    return String(Math.round(abs));
  }
  function trimNum(n) {
    const s = n >= 10 ? n.toFixed(1) : n.toFixed(2);
    return s.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
  }
  function formatDaysLeft(days) {
    if (days == null) return "\u5468\u671F\u672A\u77E5";
    if (days <= 0) return "\u5373\u5C06\u91CD\u7F6E";
    return `${days} \u5929\u540E\u91CD\u7F6E`;
  }
  function formatResetAt(iso, now = Date.now()) {
    if (!iso) return "\u91CD\u7F6E\u672A\u77E5";
    const end = new Date(iso).getTime();
    if (!Number.isFinite(end)) return "\u91CD\u7F6E\u672A\u77E5";
    const ms = end - now;
    if (ms <= 0) return "\u5373\u5C06\u91CD\u7F6E";
    const hoursTotal = Math.floor(ms / 36e5);
    const days = Math.floor(hoursTotal / 24);
    const hours = hoursTotal % 24;
    const wait = days > 0 && hours > 0 ? `${days} \u5929 ${hours} \u5C0F\u65F6\u540E\u91CD\u7F6E` : days > 0 ? `${days} \u5929\u540E\u91CD\u7F6E` : hours > 0 ? `${hours} \u5C0F\u65F6\u540E\u91CD\u7F6E` : `${Math.max(1, Math.floor(ms / 6e4))} \u5206\u949F\u540E\u91CD\u7F6E`;
    const clock = formatLocalHour(end);
    return clock ? `${wait} \xB7 ${clock}` : wait;
  }
  function formatLocalHour(ms) {
    const d = new Date(ms);
    if (!Number.isFinite(d.getTime())) return "";
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const hour = String(d.getHours()).padStart(2, "0");
    const minute = String(d.getMinutes()).padStart(2, "0");
    return `${month}/${day} ${hour}:${minute}`;
  }
  function formatAgo(ts) {
    if (ts == null) return "\u5C1A\u672A\u5237\u65B0";
    const sec = Math.max(0, Math.round((Date.now() - ts) / 1e3));
    if (sec < 8) return "\u521A\u521A";
    if (sec < 60) return `${sec} \u79D2\u524D`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min} \u5206\u949F\u524D`;
    return `${Math.round(min / 60)} \u5C0F\u65F6\u524D`;
  }
  function displayModelName(id) {
    const base = humanizeModel(id);
    if (/^sand([-_]|$)/i.test(id)) {
      const rest = base.replace(/^Sand\s+/i, "").trim();
      return rest && !/^bot$/i.test(rest) ? `Grok Bot \xB7 ${rest}` : "Grok Bot";
    }
    return base;
  }
  function humanizeModel(id) {
    let s = id.replace(/^cursor-/i, "");
    const parts = s.split(/[-_]+/g).filter(Boolean);
    const special = {
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
      auto: "Auto"
    };
    return parts.map((part) => {
      const key = part.toLowerCase();
      if (special[key]) return special[key];
      if (/^\d+(\.\d+)?$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    }).join(" ");
  }

  // src/lib/estimate.ts
  var UNATTRIBUTED_MIN = 0.5;
  var MAX_INVERT_PCT = 99.5;
  function roundToTen(n) {
    if (!Number.isFinite(n) || n <= 0) return n;
    const rounded = Math.round(n / 10) * 10;
    return rounded > 0 ? rounded : n;
  }
  function canInvertCap(used, pct) {
    return used != null && pct != null && Number.isFinite(used) && Number.isFinite(pct) && used > 0 && pct > 0 && pct < MAX_INVERT_PCT;
  }
  function estimateInvertedCap(used, pct, learned = null) {
    const prior = learned && learned.value > 0 ? learned : null;
    if (canInvertCap(used, pct)) {
      return {
        value: roundToTen(used * 100 / pct),
        source: "inverted",
        label: "\u53CD\u63A8"
      };
    }
    if (prior) {
      return {
        value: prior.value,
        source: "learned",
        label: "\u6CBF\u7528\u4E0A\u6B21"
      };
    }
    return { value: null, source: "none", label: "\u65E0\u6CD5\u63A8\u65AD" };
  }
  function ratioPct(used, total) {
    if (used == null || total == null) return null;
    if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null;
    return used / total * 100;
  }
  function remainingUsd(used, total) {
    if (used == null || total == null) return null;
    if (!Number.isFinite(used) || !Number.isFinite(total)) return null;
    return Math.max(0, total - used);
  }
  function estimatePlanTotal(used, pct, planKey, learned = null) {
    const prior = learned && learned.planKey === planKey && learned.value > 0 ? learned : null;
    return estimateInvertedCap(used, pct, prior);
  }
  function estimateFirstPartyTotal(used, autoPct, planKey, opts = {}) {
    return estimatePlanTotal(used, autoPct, planKey, opts.learned);
  }
  function estimateOtherTotal(used, apiPct, planKey, opts = {}) {
    return estimatePlanTotal(used, apiPct, planKey, opts.learned);
  }
  function daysUntil(iso) {
    if (!iso) return null;
    const end = new Date(iso).getTime();
    if (!Number.isFinite(end)) return null;
    return Math.ceil((end - Date.now()) / 864e5);
  }
  function asFiniteNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }
  function asIso(value) {
    if (typeof value === "string" && value.trim()) {
      if (/^\d+$/.test(value.trim())) return asIso(Number(value.trim()));
      const time = Date.parse(value);
      return Number.isNaN(time) ? null : new Date(time).toISOString();
    }
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      const ms = value < 1e11 ? value * 1e3 : value;
      return new Date(ms).toISOString();
    }
    return null;
  }
  function unwrapRecord(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const rec = input;
    if (rec.data && typeof rec.data === "object" && !Array.isArray(rec.data) && rec.usagePercent == null) {
      return rec.data;
    }
    return rec;
  }
  function parseSandUsage(input) {
    const root = unwrapRecord(input);
    const pct = root ? asFiniteNumber(root.usagePercent) : null;
    const remainingPct = pct == null ? null : Math.min(100, Math.max(0, 100 - pct));
    const hasAvailableUsage = root && typeof root.hasAvailableUsage === "boolean" ? root.hasAvailableUsage : null;
    const hasLimit = root && typeof root.hasNonZeroIncludedLimit === "boolean" ? root.hasNonZeroIncludedLimit : null;
    return {
      pct,
      remainingPct,
      resetAt: root ? asIso(root.nextResetTimestampUtc) : null,
      weekStart: root ? asIso(root.currentPeriodStart) : null,
      hasAvailableUsage,
      hasLimit
    };
  }
  function toModelRow(item) {
    const id = String(item.modelIntent || "").trim();
    const cost = centsToUsd(item.totalCents);
    if (!id && cost <= 0) return null;
    const pool = classifyModel(id || null, item.tier ?? null);
    const rowId = id || "(unnamed)";
    const name = id ? displayModelName(id) : "\u672A\u547D\u540D";
    return {
      id: rowId,
      name,
      pool,
      lane: modelLane({ id: rowId, name, pool }),
      cost,
      inputTokens: num(item.inputTokens),
      outputTokens: num(item.outputTokens),
      cacheReadTokens: num(item.cacheReadTokens),
      cacheWriteTokens: num(item.cacheWriteTokens)
    };
  }
  function rowsFromEvents(events) {
    if (!events) return [];
    return (events.aggregations || []).map(toModelRow).filter((row) => row != null).sort((a, b) => b.cost - a.cost);
  }
  function laneSum(models, lane) {
    return models.filter((model) => model.lane === lane).reduce((sum, model) => sum + model.cost, 0);
  }
  function invertGapNote(source, pct, used, copy) {
    const full = pct != null && pct >= MAX_INVERT_PCT;
    if (source === "none") {
      return {
        tone: "info",
        text: full ? copy.noneFull : used == null ? copy.noneMissing : copy.noneZero
      };
    }
    if (source === "learned") {
      return {
        tone: "info",
        text: full ? copy.learnedFull : used == null ? copy.learnedMissing : copy.learnedZero
      };
    }
    return null;
  }
  function buildView(summary, events, sand = null, extras = {}) {
    const plan = summary.individualUsage?.plan;
    const onDemand = summary.individualUsage?.onDemand;
    const hasIndividual = !!plan;
    const teamUnsupported = !hasIndividual && hasTeamData(summary.teamUsage);
    const planKey = normalizePlan(summary.membershipType);
    const hasEvents = events != null;
    const autoPct = plan?.autoPercentUsed == null ? null : num(plan.autoPercentUsed);
    const apiPct = plan?.apiPercentUsed == null ? null : num(plan.apiPercentUsed);
    const bonus = plan?.breakdown?.bonus == null ? 0 : centsToUsd(plan.breakdown.bonus);
    const models = rowsFromEvents(events);
    const cursorUsed = hasEvents ? laneSum(models, "cursor") : null;
    const otherUsed = hasEvents ? laneSum(models, "other") : null;
    const botAmount = hasEvents ? laneSum(models, "bot") : 0;
    const unknownCost = hasEvents ? laneSum(models, "unknown") : 0;
    const first = estimateFirstPartyTotal(cursorUsed, autoPct, planKey, { learned: extras.learned });
    const otherEst = estimateOtherTotal(otherUsed, apiPct, planKey, { learned: extras.learnedOther });
    const otherRemaining = remainingUsd(otherUsed, otherEst.value);
    const otherOfficial = apiPct != null;
    const sandUsage = parseSandUsage(sand);
    const weekEvents = extras.weekEvents;
    const botUsed = weekEvents != null ? laneSum(rowsFromEvents(weekEvents), "bot") : null;
    const botEst = estimateInvertedCap(botUsed, sandUsage.pct, extras.learnedBot ?? null);
    const botRemaining = remainingUsd(botUsed, botEst.value);
    const cursorRemaining = remainingUsd(cursorUsed, first.value);
    const onDemandUsed = onDemand?.used == null ? null : centsToUsd(onDemand.used);
    const onDemandLimit = onDemand?.limit == null ? null : centsToUsd(onDemand.limit);
    const onDemandVisible = !!(onDemand?.enabled || onDemandUsed != null && onDemandUsed > 0);
    const notes = [];
    const firstNote = invertGapNote(first.source, autoPct, cursorUsed, {
      noneZero: "\u5F53\u524D\u65E0\u6CD5\u63A8\u65AD Cursor Models \u603B\u989D\u3002\u672C\u5468\u671F\u8FD8\u6CA1\u6709\u7B2C\u4E00\u65B9\u7528\u91CF\uFF0C\u4E5F\u6CA1\u6709\u5386\u53F2\u4F30\u7B97\u3002",
      noneMissing: "\u5F53\u524D\u65E0\u6CD5\u63A8\u65AD Cursor Models \u603B\u989D\u3002\u6CA1\u6709\u7B2C\u4E00\u65B9\u8D26\u5355\uFF0C\u4E5F\u6CA1\u6709\u5386\u53F2\u4F30\u7B97\u3002",
      noneFull: "\u7B2C\u4E00\u65B9\u8FDB\u5EA6\u5DF2\u6EE1\uFF0C\u65E0\u6CD5\u4ECE\u767E\u5206\u6BD4\u53CD\u63A8\u603B\u989D\u3002",
      learnedZero: "\u672C\u5468\u671F\u7B2C\u4E00\u65B9\u7528\u91CF\u4E3A 0\uFF0C\u603B\u989D\u6CBF\u7528\u4E0A\u6B21\u4F30\u7B97\u3002",
      learnedMissing: "\u6CA1\u6709\u7B2C\u4E00\u65B9\u8D26\u5355\uFF0C\u603B\u989D\u6CBF\u7528\u4E0A\u6B21\u4F30\u7B97\u3002",
      learnedFull: "\u7B2C\u4E00\u65B9\u8FDB\u5EA6\u5DF2\u6EE1\uFF0C\u603B\u989D\u6CBF\u7528\u4E0A\u6B21\u4F30\u7B97\u3002"
    });
    if (firstNote) notes.push(firstNote);
    const otherNote = invertGapNote(otherEst.source, apiPct, otherUsed, {
      noneZero: "\u5F53\u524D\u65E0\u6CD5\u63A8\u65AD Other Models \u603B\u989D\u3002\u672C\u5468\u671F\u8FD8\u6CA1\u6709\u7B2C\u4E09\u65B9\u7528\u91CF\uFF0C\u4E5F\u6CA1\u6709\u5386\u53F2\u4F30\u7B97\u3002",
      noneMissing: "\u5F53\u524D\u65E0\u6CD5\u63A8\u65AD Other Models \u603B\u989D\u3002\u6CA1\u6709\u7B2C\u4E09\u65B9\u8D26\u5355\uFF0C\u4E5F\u6CA1\u6709\u5386\u53F2\u4F30\u7B97\u3002",
      noneFull: "\u7B2C\u4E09\u65B9\u8FDB\u5EA6\u5DF2\u6EE1\uFF0C\u65E0\u6CD5\u4ECE\u767E\u5206\u6BD4\u53CD\u63A8\u603B\u989D\u3002",
      learnedZero: "\u672C\u5468\u671F\u7B2C\u4E09\u65B9\u7528\u91CF\u4E3A 0\uFF0C\u603B\u989D\u6CBF\u7528\u4E0A\u6B21\u4F30\u7B97\u3002",
      learnedMissing: "\u6CA1\u6709\u7B2C\u4E09\u65B9\u8D26\u5355\uFF0C\u603B\u989D\u6CBF\u7528\u4E0A\u6B21\u4F30\u7B97\u3002",
      learnedFull: "\u7B2C\u4E09\u65B9\u8FDB\u5EA6\u5DF2\u6EE1\uFF0C\u603B\u989D\u6CBF\u7528\u4E0A\u6B21\u4F30\u7B97\u3002"
    });
    if (otherNote && (apiPct != null || otherUsed != null || otherEst.source === "learned")) notes.push(otherNote);
    const botNote = invertGapNote(botEst.source, sandUsage.pct, botUsed, {
      noneZero: "\u5F53\u524D\u65E0\u6CD5\u63A8\u65AD Grok Bot \u5468\u9650\u989D\u3002\u672C\u5468\u8FD8\u6CA1\u6709 Bot \u7528\u91CF\uFF0C\u4E5F\u6CA1\u6709\u5386\u53F2\u4F30\u7B97\u3002",
      noneMissing: "\u5F53\u524D\u65E0\u6CD5\u63A8\u65AD Grok Bot \u5468\u9650\u989D\u3002\u6CA1\u6709\u672C\u5468 Bot \u8D26\u5355\uFF0C\u4E5F\u6CA1\u6709\u5386\u53F2\u4F30\u7B97\u3002",
      noneFull: "Grok Bot \u672C\u5468\u8FDB\u5EA6\u5DF2\u6EE1\uFF0C\u65E0\u6CD5\u4ECE\u767E\u5206\u6BD4\u53CD\u63A8\u603B\u989D\u3002",
      learnedZero: "\u672C\u5468 Grok Bot \u7528\u91CF\u4E3A 0\uFF0C\u603B\u989D\u6CBF\u7528\u4E0A\u6B21\u4F30\u7B97\u3002",
      learnedMissing: "\u6CA1\u6709\u672C\u5468 Bot \u8D26\u5355\uFF0C\u603B\u989D\u6CBF\u7528\u4E0A\u6B21\u4F30\u7B97\u3002",
      learnedFull: "Grok Bot \u672C\u5468\u8FDB\u5EA6\u5DF2\u6EE1\uFF0C\u603B\u989D\u6CBF\u7528\u4E0A\u6B21\u4F30\u7B97\u3002"
    });
    if (botNote && (sandUsage.pct != null || botUsed != null || botEst.source === "learned")) notes.push(botNote);
    if (autoPct != null && autoPct >= MAX_INVERT_PCT) {
      notes.push({
        tone: "warn",
        text: "\u7B2C\u4E00\u65B9\u6C60\u5DF2\u63A5\u8FD1\u6216\u8FBE\u5230\u4E0A\u9650\uFF0C\u8D85\u989D\u53EF\u80FD\u8BA1\u5165 Other Models \u6216\u6309\u9700\u7528\u91CF\u3002"
      });
    }
    if (unknownCost >= UNATTRIBUTED_MIN) {
      notes.push({
        tone: "info",
        text: `\u6709\u672A\u5F52\u7C7B\u6A21\u578B ${unknownCost.toFixed(2)} \u7F8E\u5143\uFF0C\u672A\u8BA1\u5165\u4EFB\u4E00\u8FDB\u5EA6\u6761\u3002`
      });
    }
    if (!hasEvents) {
      notes.push({
        tone: "warn",
        text: "\u7528\u91CF\u4E8B\u4EF6\u672A\u62C9\u5230\uFF0C\u7B2C\u4E00\u65B9\u548C\u7B2C\u4E09\u65B9\u5DF2\u7528\u91D1\u989D\u65E0\u6CD5\u6309\u6A21\u578B\u52A0\u603B\u3002"
      });
    }
    if (sandUsage.pct != null && sandUsage.pct >= MAX_INVERT_PCT) {
      notes.push({
        tone: "warn",
        text: "Grok Bot \u672C\u5468\u989D\u5EA6\u5DF2\u7528\u5B8C\uFF0C\u8D85\u989D\u53EF\u80FD\u8D70\u6309\u9700\u7528\u91CF\u3002"
      });
    } else if (sandUsage.hasAvailableUsage === false) {
      notes.push({
        tone: "warn",
        text: "Grok Bot \u5F53\u524D\u6CA1\u6709\u53EF\u7528\u5468\u989D\u5EA6\u3002"
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
        totalLabel: first.label
      },
      other: {
        used: otherUsed,
        total: otherEst.value,
        pct: apiPct,
        remaining: otherRemaining,
        totalSource: otherEst.source,
        totalLabel: otherEst.label,
        official: otherOfficial,
        bonus
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
        official: sandUsage.pct != null
      },
      onDemand: {
        visible: onDemandVisible,
        enabled: !!onDemand?.enabled,
        used: onDemandUsed,
        limit: onDemandLimit
      },
      models,
      notes
    };
  }
  function snapshotNeedsUpgrade(view) {
    if (!view || typeof view !== "object") return false;
    const rec = view;
    if (!("bot" in rec)) return true;
    if (!rec.bot || !("totalSource" in rec.bot)) return true;
    if (!rec.other || !("totalSource" in rec.other)) return true;
    return false;
  }
  function hydrateUsageView(view) {
    const other = view.other;
    const otherUsed = other?.used ?? null;
    const otherTotal = other?.total ?? null;
    const models = view.models || [];
    const botAmount = view.bot?.amount ?? models.filter((model) => modelLane(model) === "bot").reduce((sum, model) => sum + model.cost, 0);
    const resetAt = view.bot?.resetAt ?? null;
    const pct = view.bot?.pct ?? null;
    return {
      ...view,
      other: {
        used: otherUsed,
        total: otherTotal,
        pct: other?.pct ?? null,
        remaining: other?.remaining ?? remainingUsd(otherUsed, otherTotal),
        totalSource: other?.totalSource ?? (otherTotal != null ? "learned" : "none"),
        totalLabel: other?.totalLabel ?? (otherTotal != null ? "\u6CBF\u7528\u4E0A\u6B21" : "\u65E0\u6CD5\u63A8\u65AD"),
        official: other?.official ?? other?.pct != null,
        bonus: other?.bonus ?? 0
      },
      bot: {
        amount: botAmount,
        used: view.bot?.used ?? null,
        total: view.bot?.total ?? null,
        remaining: view.bot?.remaining ?? (view.bot?.total != null && view.bot?.used != null ? Math.max(0, view.bot.total - view.bot.used) : null),
        totalSource: view.bot?.totalSource ?? "none",
        totalLabel: view.bot?.totalLabel ?? (view.bot?.total != null ? "\u6CBF\u7528\u4E0A\u6B21" : "\u65E0\u6CD5\u63A8\u65AD"),
        visible: botAmount >= UNATTRIBUTED_MIN || pct != null || (view.bot?.total ?? null) != null,
        pct,
        remainingPct: view.bot?.remainingPct ?? null,
        resetAt,
        weekStart: view.bot?.weekStart ?? null,
        daysLeft: daysUntil(resetAt),
        hasAvailableUsage: view.bot?.hasAvailableUsage ?? null,
        official: view.bot?.official ?? pct != null
      },
      daysLeft: daysUntil(view.cycleEnd)
    };
  }

  // src/lib/settings.ts
  var DEFAULT_REFRESH_POLICY = "1m";
  var REFRESH_POLICY_OPTIONS = [
    { id: "always", label: "\u6BCF\u6B21\u8FDB\u5165\u90FD\u5237\u65B0", hint: "\u56DE\u5230 Dashboard \u5C31\u62C9\u4E00\u6B21" },
    { id: "1m", label: "1 \u5206\u949F\u5185\u4E0D\u5237\u65B0", hint: "\u9ED8\u8BA4" },
    { id: "5m", label: "5 \u5206\u949F\u5185\u4E0D\u5237\u65B0", hint: "" },
    { id: "10m", label: "10 \u5206\u949F\u5185\u4E0D\u5237\u65B0", hint: "" },
    { id: "manual", label: "\u4EC5\u624B\u52A8\u5237\u65B0", hint: "\u7B2C\u4E00\u6B21\u4ECD\u4F1A\u81EA\u52A8\u62C9" }
  ];
  var STORAGE_REFRESH_POLICY = "cu.refresh.policy";
  var STORAGE_REFRESH_LAST_AT = "cu.refresh.lastAt";
  var STORAGE_SNAPSHOT = "cu.refresh.snapshot";
  var STORAGE_LEARNED_FIRST_PARTY = "cu.learned.firstParty";
  var STORAGE_LEARNED_OTHER = "cu.learned.other";
  var STORAGE_LEARNED_BOT = "cu.learned.bot";
  function parsePolicy(value) {
    return REFRESH_POLICY_OPTIONS.some((item) => item.id === value) ? value : DEFAULT_REFRESH_POLICY;
  }
  function policyLabel(policy2) {
    return REFRESH_POLICY_OPTIONS.find((item) => item.id === policy2)?.label ?? "1 \u5206\u949F\u5185\u4E0D\u5237\u65B0";
  }
  function cooldownMs(policy2) {
    switch (policy2) {
      case "always":
        return 0;
      case "1m":
        return 6e4;
      case "5m":
        return 5 * 6e4;
      case "10m":
        return 10 * 6e4;
      case "manual":
        return Number.POSITIVE_INFINITY;
    }
  }
  function shouldAutoRefresh(policy2, lastAt2, now = Date.now()) {
    if (lastAt2 == null) return true;
    const wait = cooldownMs(policy2);
    if (wait === 0) return true;
    if (!Number.isFinite(wait)) return false;
    return now - lastAt2 >= wait;
  }
  async function loadRefreshSettings() {
    const stored = await chrome.storage.local.get([
      STORAGE_REFRESH_POLICY,
      STORAGE_REFRESH_LAST_AT,
      STORAGE_SNAPSHOT
    ]);
    const lastAt2 = typeof stored[STORAGE_REFRESH_LAST_AT] === "number" ? stored[STORAGE_REFRESH_LAST_AT] : null;
    const snapshot = isSnapshot(stored[STORAGE_SNAPSHOT]) ? stored[STORAGE_SNAPSHOT] : null;
    return { policy: parsePolicy(stored[STORAGE_REFRESH_POLICY]), lastAt: lastAt2, snapshot };
  }
  async function saveRefreshPolicy(policy2) {
    await chrome.storage.local.set({ [STORAGE_REFRESH_POLICY]: policy2 });
  }
  async function markFetched(view, at = Date.now()) {
    await chrome.storage.local.set({
      [STORAGE_REFRESH_LAST_AT]: at,
      [STORAGE_SNAPSHOT]: { view, updatedAt: at }
    });
  }
  async function loadLearnedFirstParty() {
    const stored = await chrome.storage.local.get(STORAGE_LEARNED_FIRST_PARTY);
    return parseLearned(stored[STORAGE_LEARNED_FIRST_PARTY]);
  }
  async function saveLearnedFirstParty(learned) {
    await chrome.storage.local.set({ [STORAGE_LEARNED_FIRST_PARTY]: learned });
  }
  async function loadLearnedOther() {
    const stored = await chrome.storage.local.get(STORAGE_LEARNED_OTHER);
    return parseLearned(stored[STORAGE_LEARNED_OTHER]);
  }
  async function saveLearnedOther(learned) {
    await chrome.storage.local.set({ [STORAGE_LEARNED_OTHER]: learned });
  }
  async function loadLearnedBot() {
    const stored = await chrome.storage.local.get(STORAGE_LEARNED_BOT);
    return parseLearnedCap(stored[STORAGE_LEARNED_BOT]);
  }
  async function saveLearnedBot(learned) {
    await chrome.storage.local.set({ [STORAGE_LEARNED_BOT]: learned });
  }
  function learnedFromView(view) {
    const cap = capFromInvert(view.cursor.used, view.cursor.pct, view.cursor.total, view.cursor.totalSource);
    return cap ? { planKey: view.planKey, ...cap } : null;
  }
  function learnedOtherFromView(view) {
    const cap = capFromInvert(view.other.used, view.other.pct, view.other.total, view.other.totalSource);
    return cap ? { planKey: view.planKey, ...cap } : null;
  }
  function learnedBotFromView(view) {
    return capFromInvert(view.bot.used, view.bot.pct, view.bot.total, view.bot.totalSource);
  }
  function capFromInvert(used, pct, value, source) {
    if (source !== "inverted") return null;
    if (used == null || pct == null || value == null) return null;
    if (!Number.isFinite(used) || !Number.isFinite(pct) || !Number.isFinite(value)) return null;
    if (used <= 0 || pct <= 0 || value <= 0) return null;
    return { used, pct, value };
  }
  function parseLearned(value) {
    const cap = parseLearnedCap(value);
    if (!cap) return null;
    const planKey = value.planKey;
    if (planKey !== "pro" && planKey !== "pro_plus" && planKey !== "ultra" && planKey !== "unknown") return null;
    return { planKey, ...cap };
  }
  function parseLearnedCap(value) {
    if (!value || typeof value !== "object") return null;
    const rec = value;
    if (![rec.used, rec.pct, rec.value].every((n) => typeof n === "number" && Number.isFinite(n) && n > 0)) {
      return null;
    }
    return { used: rec.used, pct: rec.pct, value: rec.value };
  }
  function isSnapshot(value) {
    if (!value || typeof value !== "object") return false;
    const rec = value;
    return !!rec.view && typeof rec.updatedAt === "number";
  }

  // src/lib/types.ts
  var CHANNEL = "CURSOR_USAGE_EXT";

  // src/lib/tokens.ts
  function toTokenStats(parts) {
    const input = Math.max(0, parts.inputTokens || 0);
    const output = Math.max(0, parts.outputTokens || 0);
    const cacheRead = Math.max(0, parts.cacheReadTokens || 0);
    const cacheWrite = Math.max(0, parts.cacheWriteTokens || 0);
    const prompt = input + cacheRead + cacheWrite;
    return {
      input,
      output,
      cache: cacheRead + cacheWrite,
      cacheRead,
      cacheWrite,
      total: prompt + output,
      hitRate: prompt > 0 ? cacheRead / prompt * 100 : null
    };
  }
  function addTokenStats(rows) {
    return toTokenStats(
      rows.reduce(
        (acc, row) => ({
          inputTokens: acc.inputTokens + (row.inputTokens || 0),
          outputTokens: acc.outputTokens + (row.outputTokens || 0),
          cacheReadTokens: acc.cacheReadTokens + (row.cacheReadTokens || 0),
          cacheWriteTokens: acc.cacheWriteTokens + (row.cacheWriteTokens || 0)
        }),
        { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
      )
    );
  }

  // src/content/ui.ts
  var STORAGE_POS = "cu.panel.pos";
  var STORAGE_COLLAPSED = "cu.panel.collapsed";
  var STORAGE_EXPANDED = "cu.panel.expanded";
  var STORAGE_HIDDEN = "cu.panel.hidden";
  var STORAGE_MODEL_FILTER = "cu.models.filter";
  var UsagePanel = class {
    host;
    root;
    callbacks;
    collapsed = false;
    expanded = false;
    hidden = false;
    pos = null;
    loading = false;
    error = null;
    view = null;
    updatedAt = null;
    dragging = false;
    mounted = false;
    settingsOpen = false;
    policy = DEFAULT_REFRESH_POLICY;
    modelFilter = "all";
    constructor(cssText, callbacks, policy2 = DEFAULT_REFRESH_POLICY) {
      this.callbacks = callbacks;
      this.policy = policy2;
      this.host = document.createElement("div");
      this.host.id = "cursor-usage-ext-host";
      this.host.style.all = "initial";
      this.root = this.host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = cssText;
      this.root.append(style, h("div", { class: "cu-mount" }));
    }
    async attach() {
      if (this.mounted) return;
      await this.restore();
      document.documentElement.append(this.host);
      this.mounted = true;
      window.addEventListener("resize", this.onResize);
      this.render();
    }
    detach() {
      window.removeEventListener("resize", this.onResize);
      this.host.remove();
      this.mounted = false;
    }
    setRouteVisible(onDashboard) {
      this.host.style.display = onDashboard ? "" : "none";
    }
    toggleHidden() {
      this.hidden = !this.hidden;
      this.render();
    }
    setLoading(loading) {
      this.loading = loading;
      const panel2 = this.root.querySelector(".cu-panel");
      if (panel2 && this.view && !this.error) {
        panel2.classList.toggle("is-refreshing", loading);
        const actions = panel2.querySelector(".cu-actions");
        const spin = panel2.querySelector(".cu-spin");
        if (loading && !spin && actions) {
          actions.prepend(h("span", { class: "cu-spin", "data-tip": "\u5237\u65B0\u4E2D", "aria-label": "\u5237\u65B0\u4E2D" }));
        } else if (!loading) {
          spin?.remove();
        }
        return;
      }
      this.render();
    }
    setError(error) {
      this.error = error;
      this.loading = false;
      if (this.dragging) return;
      this.render();
    }
    setView(view, updatedAt = Date.now()) {
      this.view = hydrateUsageView(view);
      this.error = null;
      this.loading = false;
      this.updatedAt = updatedAt;
      if (this.dragging) return;
      this.render();
    }
    setPolicy(policy2) {
      this.policy = policy2;
      this.render();
    }
    async restore() {
      const stored = await chrome.storage.local.get([
        STORAGE_POS,
        STORAGE_COLLAPSED,
        STORAGE_EXPANDED,
        STORAGE_MODEL_FILTER
      ]);
      this.pos = parsePos(stored[STORAGE_POS]);
      this.collapsed = !!stored[STORAGE_COLLAPSED];
      this.expanded = !!stored[STORAGE_EXPANDED] && !this.collapsed;
      this.hidden = false;
      this.modelFilter = parseModelFilter(stored[STORAGE_MODEL_FILTER]);
      void chrome.storage.local.remove(STORAGE_HIDDEN);
    }
    mountEl() {
      return this.root.querySelector(".cu-mount");
    }
    render() {
      const prevBody = this.root.querySelector(".cu-body");
      const scrollTop = prevBody?.scrollTop ?? 0;
      const mount = this.mountEl();
      mount.replaceChildren();
      const theme = detectTheme();
      if (this.hidden) {
        mount.append(this.buildRestore(theme));
        this.setRouteVisible(isDashboardPath());
        return;
      }
      const panel2 = this.buildPanel(theme);
      mount.append(panel2);
      this.applyPosition(panel2);
      this.bindChrome(panel2);
      this.bindTips(panel2);
      this.setRouteVisible(isDashboardPath());
      const nextBody = this.root.querySelector(".cu-body");
      if (nextBody) nextBody.scrollTop = scrollTop;
    }
    buildPanel(theme) {
      const collapsed = this.collapsed;
      const classes = [
        "cu-panel",
        `theme-${theme}`,
        collapsed ? "is-collapsed" : "",
        this.expanded && !collapsed ? "is-expanded" : "",
        this.loading && this.view ? "is-refreshing" : ""
      ].filter(Boolean).join(" ");
      return h(
        "section",
        { class: classes, role: "complementary", "aria-label": "Cursor \u7528\u91CF\u660E\u7EC6" },
        this.buildHeader(),
        this.settingsOpen ? this.buildSettings() : null,
        collapsed ? null : this.buildBody(),
        collapsed ? null : this.buildFooter()
      );
    }
    buildHeader() {
      const view = this.view;
      const title = this.collapsed && view ? [
        `${view.planLabel} \xB7 \u7B2C\u4E00\u65B9 ${formatMoney(view.cursor.used)} / ${formatMoney(view.cursor.total)} \xB7 ${formatPct(view.cursor.pct)}`,
        `\u7B2C\u4E09\u65B9 ${formatMoney(view.other.used)} / ${formatMoney(view.other.total)} \xB7 ${formatPct(view.other.pct)}`,
        view.bot.visible ? `Grok Bot ${formatMoney(view.bot.used)} / ${formatMoney(view.bot.total)} \xB7 ${formatPct(view.bot.pct)}` : ""
      ].filter(Boolean).join(" \xB7 ") : "Cursor \u7528\u91CF";
      return h(
        "header",
        { class: "cu-head", "data-drag": "1" },
        h(
          "div",
          { class: "cu-brand" },
          iconMark(),
          h(
            "div",
            { class: "cu-titles" },
            h("div", { class: "cu-title" }, title),
            this.collapsed ? null : h(
              "div",
              { class: "cu-sub" },
              view ? `${view.planLabel} \xB7 ${formatDaysLeft(view.daysLeft)}` : "\u4E2A\u4EBA\u8BA2\u9605\u660E\u7EC6"
            )
          )
        ),
        h(
          "div",
          { class: "cu-actions" },
          this.loading ? h("span", { class: "cu-spin", "data-tip": "\u5237\u65B0\u4E2D", "aria-label": "\u5237\u65B0\u4E2D" }) : null,
          button("cu-icon-btn", "\u5237\u65B0", iconRefresh(), () => this.callbacks.onRefresh()),
          button(
            `cu-icon-btn${this.expanded && !this.collapsed ? " is-on" : ""}`,
            this.expanded && !this.collapsed ? "\u8FD8\u539F" : "\u653E\u5927",
            iconExpand(this.expanded && !this.collapsed),
            () => this.toggleExpanded()
          ),
          this.collapsed || this.expanded ? null : button("cu-icon-btn", "\u56DE\u5230\u53F3\u4E0B\u89D2", iconDock(), () => this.resetToCorner()),
          this.collapsed ? null : button(
            `cu-icon-btn${this.settingsOpen ? " is-on" : ""}`,
            "\u5237\u65B0\u7B56\u7565",
            iconGear(),
            () => {
              this.settingsOpen = !this.settingsOpen;
              this.render();
            }
          ),
          button("cu-icon-btn", this.collapsed ? "\u5C55\u5F00" : "\u6536\u8D77", iconChevron(this.collapsed), () => {
            this.collapsed = !this.collapsed;
            if (this.collapsed) {
              this.expanded = false;
              this.settingsOpen = false;
            }
            void chrome.storage.local.set({
              [STORAGE_COLLAPSED]: this.collapsed,
              [STORAGE_EXPANDED]: this.expanded
            });
            this.render();
          }),
          button("cu-icon-btn", "\u9690\u85CF\u6D6E\u5C42\u3002\u5237\u65B0\u9875\u9762\u3001\u70B9\u53F3\u4E0B\u89D2\u300C\u7528\u91CF\u300D\u6216\u6269\u5C55\u56FE\u6807\u53EF\u518D\u6253\u5F00", iconClose(), () => this.toggleHidden())
        )
      );
    }
    buildBody() {
      if (this.loading && !this.view && !this.error) {
        return h("div", { class: "cu-body" }, skeleton());
      }
      if (this.error && !this.view) {
        return h(
          "div",
          { class: "cu-body" },
          h(
            "div",
            { class: "cu-empty" },
            h("div", { class: "cu-empty-title" }, this.error),
            h("div", { class: "cu-empty-sub" }, "\u6253\u5F00\u5DF2\u767B\u5F55\u7684 Dashboard \u540E\u4F1A\u81EA\u52A8\u91CD\u8BD5\u3002")
          )
        );
      }
      const view = this.view;
      if (!view) {
        return h(
          "div",
          { class: "cu-body" },
          h(
            "div",
            { class: "cu-empty" },
            h("div", { class: "cu-empty-title" }, "\u7B49\u5F85\u7528\u91CF\u6570\u636E"),
            h("div", { class: "cu-empty-sub" }, "\u6B63\u5728\u8BFB\u53D6\u5F53\u524D\u767B\u5F55\u4F1A\u8BDD\u3002")
          )
        );
      }
      if (view.teamUnsupported) {
        return h(
          "div",
          { class: "cu-body" },
          h(
            "div",
            { class: "cu-empty" },
            h("div", { class: "cu-empty-title" }, "\u4E00\u671F\u4EC5\u652F\u6301\u4E2A\u4EBA\u8BA2\u9605"),
            h("div", { class: "cu-empty-sub" }, "\u68C0\u6D4B\u5230\u56E2\u961F\u7528\u91CF\u7ED3\u6784\uFF0C\u6682\u4E0D\u4F30\u7B97\u56E2\u961F\u6C60\u5316\u989D\u5EA6\u3002")
          )
        );
      }
      return h(
        "div",
        { class: "cu-body" },
        this.error ? h("div", { class: "cu-note tone-warn" }, this.error) : null,
        h(
          "div",
          { class: "cu-pools" },
          poolCard({
            kind: "cursor",
            kicker: "Cursor Models",
            title: "\u7B2C\u4E00\u65B9\u6C60",
            used: view.cursor.used,
            total: view.cursor.total,
            pct: view.cursor.pct,
            remaining: view.cursor.remaining,
            badge: view.cursor.totalLabel,
            badgeTone: view.cursor.totalSource === "inverted" ? "ok" : view.cursor.totalSource === "learned" ? "warn" : "muted",
            selected: this.modelFilter === "cursor",
            onSelect: () => this.toggleFilter("cursor")
          }),
          poolCard({
            kind: "other",
            kicker: "Other Models",
            title: "\u7B2C\u4E09\u65B9\u6C60",
            used: view.other.used,
            total: view.other.total,
            pct: view.other.pct,
            remaining: view.other.remaining,
            badge: view.other.totalLabel,
            badgeTone: view.other.totalSource === "inverted" ? "ok" : view.other.totalSource === "learned" ? "warn" : "muted",
            selected: this.modelFilter === "other",
            onSelect: () => this.toggleFilter("other")
          }),
          view.bot.visible ? botCard({
            bot: view.bot,
            selected: this.modelFilter === "bot",
            onSelect: () => this.toggleFilter("bot")
          }) : null,
          view.onDemand.visible ? h(
            "div",
            { class: "cu-side-row" },
            h(
              "div",
              { class: "cu-side-copy" },
              h("div", { class: "cu-side-title" }, "\u6309\u9700\u7528\u91CF"),
              h("div", { class: "cu-side-sub" }, view.onDemand.enabled ? "\u5DF2\u5F00\u542F on-demand" : "\u672C\u5468\u671F\u5DF2\u4EA7\u751F\u6309\u9700\u8D39\u7528")
            ),
            h(
              "div",
              { class: "cu-side-val" },
              view.onDemand.limit != null ? `${formatMoney(view.onDemand.used)} / ${formatMoney(view.onDemand.limit)}` : formatMoney(view.onDemand.used)
            )
          ) : null
        ),
        this.buildModels(view.models),
        view.notes.length ? h(
          "div",
          { class: "cu-notes" },
          ...view.notes.map(
            (note) => h("div", { class: `cu-note tone-${note.tone}` }, note.text)
          )
        ) : null
      );
    }
    buildRestore(theme) {
      const btn = h("button", {
        class: `cu-restore theme-${theme}`,
        type: "button",
        "aria-label": "\u663E\u793A\u7528\u91CF\u6D6E\u5C42"
      }, iconMark(), h("span", { class: "cu-restore-label" }, "\u7528\u91CF"));
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.toggleHidden();
      });
      return btn;
    }
    toggleExpanded() {
      this.expanded = !(this.expanded && !this.collapsed);
      this.collapsed = false;
      void chrome.storage.local.set({
        [STORAGE_COLLAPSED]: false,
        [STORAGE_EXPANDED]: this.expanded
      });
      this.render();
    }
    toggleFilter(next) {
      this.modelFilter = this.modelFilter === next ? "all" : next;
      void chrome.storage.local.set({ [STORAGE_MODEL_FILTER]: this.modelFilter });
      this.render();
    }
    buildModels(models) {
      const lanes = summarizeLanes(models);
      const counts = Object.fromEntries(MODEL_FILTERS.map((item) => [item.id, 0]));
      counts.all = models.length;
      for (const lane of LANE_ORDER) counts[lane] = lanes[lane].count;
      const visible = models.filter((model) => modelMatchesFilter(model, this.modelFilter));
      const stats = addTokenStats(visible);
      const maxCost = Math.max(...visible.map((m) => m.cost), 0.01);
      const chips = MODEL_FILTERS.filter((item) => item.id === "all" || counts[item.id] > 0);
      const laneCount = LANE_ORDER.filter((lane) => lanes[lane].count > 0).length;
      const grouped = this.modelFilter === "all" && laneCount > 1;
      return h(
        "div",
        { class: "cu-models" },
        h(
          "div",
          { class: "cu-models-head" },
          h("div", { class: "cu-section-label" }, "\u6309\u6A21\u578B"),
          models.length ? modelsSum(this.modelFilter, visible, lanes) : null
        ),
        chips.length > 1 ? h(
          "div",
          { class: "cu-chips", role: "tablist", "aria-label": "\u6A21\u578B\u5206\u7C7B" },
          ...chips.map((item) => {
            const on = item.id === this.modelFilter;
            const chip = h("button", {
              class: `cu-chip${on ? " is-on" : ""}${item.id !== "all" ? ` lane-${item.id}` : ""}`,
              type: "button",
              role: "tab",
              "aria-selected": on ? "true" : "false",
              "data-tip": item.id === "all" ? "\u663E\u793A\u5168\u90E8\u6A21\u578B" : LANE_META[item.id].hint
            }, `${item.label} ${counts[item.id]}`);
            chip.addEventListener("click", (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              if (item.id === "all") {
                this.modelFilter = "all";
                void chrome.storage.local.set({ [STORAGE_MODEL_FILTER]: "all" });
                this.render();
                return;
              }
              this.toggleFilter(item.id);
            });
            return chip;
          })
        ) : null,
        visible.length ? tokenMetrics(stats) : null,
        !models.length ? h("div", { class: "cu-empty-sub" }, "\u5F53\u524D\u5468\u671F\u8FD8\u6CA1\u6709\u53EF\u5C55\u793A\u7684\u6A21\u578B\u4E8B\u4EF6\u3002") : !visible.length ? h("div", { class: "cu-empty-sub" }, "\u8FD9\u4E00\u7C7B\u6CA1\u6709\u6A21\u578B\u3002") : grouped ? h(
          "div",
          { class: `cu-lanes${this.expanded ? " is-cols" : ""}` },
          ...LANE_ORDER.map((lane) => {
            const items = visible.filter((model) => modelLane(model) === lane);
            if (!items.length) return null;
            const meta = LANE_META[lane];
            const head = h(
              "button",
              {
                class: `cu-lane-head lane-${lane}`,
                type: "button",
                "data-tip": `${meta.hint} \xB7 \u70B9\u51FB\u53EA\u770B\u8FD9\u7C7B`
              },
              h("span", { class: "cu-lane-dot" }),
              h(
                "span",
                { class: "cu-lane-copy" },
                h("span", { class: "cu-lane-title" }, meta.label),
                h("span", { class: "cu-lane-hint" }, meta.hint)
              ),
              h("span", { class: "cu-lane-sum" }, formatMoney(lanes[lane].amount))
            );
            head.addEventListener("click", (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              this.toggleFilter(lane);
            });
            return h(
              "div",
              { class: `cu-lane lane-${lane}` },
              head,
              h(
                "div",
                { class: "cu-table" },
                ...items.map((model) => modelRow(model, Math.max(...items.map((row) => row.cost), 0.01)))
              )
            );
          })
        ) : h(
          "div",
          { class: "cu-table" },
          ...visible.map((model) => modelRow(model, maxCost))
        )
      );
    }
    buildSettings() {
      return h(
        "div",
        { class: "cu-settings" },
        h("div", { class: "cu-section-label" }, "\u81EA\u52A8\u5237\u65B0"),
        h(
          "div",
          { class: "cu-policy-list" },
          ...REFRESH_POLICY_OPTIONS.map((option) => {
            const selected = option.id === this.policy;
            const row = h(
              "button",
              {
                class: `cu-policy${selected ? " is-selected" : ""}`,
                type: "button"
              },
              h("span", { class: "cu-policy-radio" }, selected ? "\u25CF" : "\u25CB"),
              h(
                "span",
                { class: "cu-policy-copy" },
                h("span", { class: "cu-policy-label" }, option.label),
                option.hint ? h("span", { class: "cu-policy-hint" }, option.hint) : null
              )
            );
            row.addEventListener("click", (ev) => {
              ev.stopPropagation();
              this.policy = option.id;
              this.callbacks.onPolicyChange(option.id);
              this.render();
            });
            return row;
          })
        )
      );
    }
    buildFooter() {
      return h(
        "footer",
        { class: "cu-foot" },
        h("span", null, `\u5237\u65B0 ${formatAgo(this.updatedAt)}`),
        h("span", { class: "cu-dot" }, "\xB7"),
        h("span", null, policyLabel(this.policy))
      );
    }
    resetToCorner() {
      this.pos = null;
      void chrome.storage.local.remove(STORAGE_POS);
      this.render();
    }
    applyPosition(panel2) {
      if (!this.pos || this.collapsed || this.expanded) {
        panel2.style.right = this.expanded ? "12px" : "16px";
        panel2.style.bottom = this.expanded ? "12px" : "16px";
        panel2.style.left = "auto";
        panel2.style.top = "auto";
        return;
      }
      panel2.style.right = "auto";
      panel2.style.bottom = "auto";
      panel2.style.left = `${this.pos.left}px`;
      panel2.style.top = `${this.pos.top}px`;
    }
    bindChrome(panel2) {
      const head = panel2.querySelector(".cu-head");
      if (!head) return;
      head.addEventListener("pointerdown", (event) => {
        if (this.collapsed || this.expanded || this.dragging) return;
        if (!(event.target instanceof Element)) return;
        if (event.target.closest("button")) return;
        this.startDrag(panel2, event);
      });
    }
    onResize = () => {
      if (!this.pos || this.collapsed || this.expanded) return;
      const panel2 = this.root.querySelector(".cu-panel");
      if (!panel2) return;
      const rect = panel2.getBoundingClientRect();
      this.pos = {
        left: clamp(this.pos.left, 8, Math.max(8, window.innerWidth - rect.width - 8)),
        top: clamp(this.pos.top, 8, Math.max(8, window.innerHeight - rect.height - 8))
      };
      this.applyPosition(panel2);
    };
    startDrag(panel2, event) {
      const rect = panel2.getBoundingClientRect();
      const dx = event.clientX - rect.left;
      const dy = event.clientY - rect.top;
      this.dragging = true;
      panel2.classList.add("is-dragging");
      headCapture(event.currentTarget, event.pointerId);
      const move = (ev) => {
        if (!this.dragging) return;
        const box = panel2.getBoundingClientRect();
        const left = clamp(ev.clientX - dx, 8, Math.max(8, window.innerWidth - box.width - 8));
        const top = clamp(ev.clientY - dy, 8, Math.max(8, window.innerHeight - box.height - 8));
        this.pos = { left, top };
        panel2.style.right = "auto";
        panel2.style.bottom = "auto";
        panel2.style.left = `${left}px`;
        panel2.style.top = `${top}px`;
      };
      const up = () => {
        this.dragging = false;
        panel2.classList.remove("is-dragging");
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        if (this.pos) void chrome.storage.local.set({ [STORAGE_POS]: this.pos });
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    }
    bindTips(panel2) {
      const tip = h("div", { class: `cu-tip${panel2.classList.contains("theme-light") ? " is-light" : ""}`, role: "tooltip" });
      tip.hidden = true;
      this.mountEl().append(tip);
      let timer = null;
      let current = null;
      const hide = () => {
        if (timer != null) {
          window.clearTimeout(timer);
          timer = null;
        }
        current = null;
        tip.hidden = true;
      };
      const place = (el) => {
        const text = el.getAttribute("data-tip");
        if (!text) return;
        tip.textContent = text;
        tip.hidden = false;
        const rect = el.getBoundingClientRect();
        const tipRect = tip.getBoundingClientRect();
        let left = rect.left + rect.width / 2 - tipRect.width / 2;
        let top = rect.bottom + 6;
        left = clamp(left, 8, window.innerWidth - tipRect.width - 8);
        if (top + tipRect.height > window.innerHeight - 8) {
          top = rect.top - tipRect.height - 6;
        }
        tip.style.left = `${Math.round(left)}px`;
        tip.style.top = `${Math.round(top)}px`;
      };
      panel2.addEventListener("pointerover", (event) => {
        const el = event.target?.closest?.("[data-tip]");
        if (!el || !panel2.contains(el) || current === el) return;
        if (timer != null) window.clearTimeout(timer);
        current = el;
        timer = window.setTimeout(() => {
          timer = null;
          if (current === el) place(el);
        }, 60);
      });
      panel2.addEventListener("pointerout", (event) => {
        const from = event.target?.closest?.("[data-tip]");
        const to = event.relatedTarget?.closest?.("[data-tip]");
        if (from && from === to) return;
        hide();
      });
      panel2.addEventListener("pointerdown", hide);
    }
  };
  function headCapture(el, pointerId) {
    try {
      el.setPointerCapture(pointerId);
    } catch {
    }
  }
  function parsePos(value) {
    if (!value || typeof value !== "object") return null;
    const rec = value;
    if (typeof rec.left !== "number" || typeof rec.top !== "number") return null;
    if (!Number.isFinite(rec.left) || !Number.isFinite(rec.top)) return null;
    return { left: rec.left, top: rec.top };
  }
  function button(cls, title, child, onClick) {
    const btn = h("button", {
      class: cls,
      type: "button",
      "aria-label": title,
      "data-tip": title
    }, child);
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onClick();
    });
    return btn;
  }
  function poolCard(opts) {
    const pct = opts.pct ?? ratioPct(opts.used, opts.total);
    const barTone = pct != null && pct >= 90 ? "hot" : pct != null && pct >= 70 ? "warm" : "ok";
    const lookHint = opts.kind === "cursor" ? "\u7B2C\u4E00\u65B9" : opts.kind === "bot" ? "Grok Bot" : "\u5B98\u65B9 Other";
    const card = h(
      "article",
      {
        class: `cu-card kind-${opts.kind}${opts.onSelect ? " is-clickable" : ""}${opts.selected ? " is-on" : ""}`,
        role: opts.onSelect ? "button" : void 0,
        tabindex: opts.onSelect ? "0" : void 0,
        "aria-pressed": opts.onSelect ? opts.selected ? "true" : "false" : void 0,
        "data-tip": opts.onSelect ? opts.selected ? "\u70B9\u51FB\u663E\u793A\u5168\u90E8\u6A21\u578B" : `\u70B9\u51FB\u53EA\u770B${lookHint}` : void 0
      },
      h(
        "div",
        { class: "cu-card-top" },
        h(
          "div",
          { class: "cu-card-heading" },
          h("div", { class: "cu-kicker" }, opts.kicker),
          h("div", { class: "cu-card-name" }, opts.title)
        ),
        h("span", { class: "cu-pct" }, `${formatPct(pct)} \u5DF2\u7528`)
      ),
      h(
        "div",
        { class: "cu-metric" },
        h("span", { class: "cu-used" }, formatMoney(opts.used)),
        h("span", { class: "cu-slash" }, "/"),
        h("span", { class: "cu-total" }, formatMoney(opts.total)),
        h("span", { class: `cu-badge tone-${opts.badgeTone}` }, opts.badge)
      ),
      h(
        "div",
        { class: "cu-bar" },
        h("div", {
          class: `cu-bar-fill tone-${barTone}`,
          style: `width:${clamp(pct ?? 0, 0, 100).toFixed(2)}%;min-width:${pct != null && pct > 0 ? 2 : 0}px`
        })
      ),
      h(
        "div",
        { class: "cu-card-foot" },
        opts.remaining != null ? `\u5269\u4F59 ${formatMoney(opts.remaining)}` : "\u5269\u4F59\u672A\u77E5",
        opts.extra ? ` \xB7 ${opts.extra}` : "",
        opts.selected ? " \xB7 \u6B63\u5728\u67E5\u770B" : ""
      )
    );
    if (opts.onSelect) bindSelect(card, opts.onSelect);
    return card;
  }
  function botCard(opts) {
    const bot = opts.bot;
    const extra = [
      bot.resetAt ? formatResetAt(bot.resetAt) : bot.daysLeft != null ? formatDaysLeft(bot.daysLeft) : null,
      bot.amount > 0 ? `\u672C\u5468\u671F\u8D26\u5355 ${formatMoney(bot.amount)}` : null
    ].filter(Boolean).join(" \xB7 ");
    return poolCard({
      kind: "bot",
      kicker: "Grok Bot",
      title: "\u5468\u9650\u989D",
      used: bot.used,
      total: bot.total,
      pct: bot.pct,
      remaining: bot.remaining,
      badge: bot.totalLabel,
      badgeTone: bot.totalSource === "inverted" ? "bot" : bot.totalSource === "learned" ? "warn" : "muted",
      extra: extra || null,
      selected: opts.selected,
      onSelect: opts.onSelect
    });
  }
  function bindSelect(el, onSelect) {
    el.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      onSelect();
    });
    el.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      ev.preventDefault();
      onSelect();
    });
  }
  function modelsSum(filter, visible, lanes) {
    if (filter !== "all") {
      return h("div", { class: "cu-models-sum" }, formatMoney(visible.reduce((s, model) => s + model.cost, 0)));
    }
    const parts = LANE_ORDER.filter((lane) => lanes[lane].count > 0);
    return h(
      "div",
      { class: "cu-models-split" },
      ...parts.flatMap((lane, i) => {
        const item = h("span", { class: `cu-split-item lane-${lane}` }, `${LANE_META[lane].short} ${formatMoney(lanes[lane].amount)}`);
        if (i === 0) return [item];
        return [h("span", { class: "cu-split-dot", "aria-hidden": "true" }, "\xB7"), item];
      })
    );
  }
  function modelRow(model, maxCost) {
    const lane = modelLane(model);
    const width = clamp(model.cost / maxCost * 100, 0, 100);
    const stats = toTokenStats(model);
    const meta = LANE_META[lane];
    return h(
      "div",
      { class: `cu-row lane-${lane}` },
      h("div", { class: "cu-row-bar", style: `width:${width.toFixed(2)}%` }),
      h(
        "div",
        { class: "cu-row-main" },
        h("div", { class: "cu-row-name" }, model.name),
        tokenMetrics(stats, true)
      ),
      h(
        "div",
        { class: "cu-row-side" },
        h("div", { class: "cu-row-cost" }, formatMoney(model.cost)),
        laneTag(lane, meta)
      )
    );
  }
  function tokenMetrics(stats, compact = false) {
    const cells = [
      ["\u603B\u91CF", formatTokens(stats.total)],
      ["\u8F93\u5165", formatTokens(stats.input)],
      ["\u8F93\u51FA", formatTokens(stats.output)],
      ["\u7F13\u5B58", formatTokens(stats.cacheRead)],
      [compact ? "\u547D\u4E2D" : "\u547D\u4E2D\u7387", formatPct(stats.hitRate)]
    ];
    return h(
      "div",
      { class: `cu-metrics${compact ? " is-compact" : ""}` },
      ...cells.map(
        ([label, value]) => h(
          "div",
          { class: "cu-metric-cell" },
          h("div", { class: "cu-metric-k" }, label),
          h("div", { class: "cu-metric-v" }, value)
        )
      )
    );
  }
  function laneTag(lane, meta) {
    return h("span", {
      class: `cu-tag tag-${lane}`,
      "data-tip": meta.hint
    }, meta.tag);
  }
  function skeleton() {
    return h(
      "div",
      { class: "cu-skel" },
      h("div", { class: "cu-skel-card" }),
      h("div", { class: "cu-skel-card" }),
      h("div", { class: "cu-skel-line" }),
      h("div", { class: "cu-skel-line" }),
      h("div", { class: "cu-skel-line short" })
    );
  }
  function svg(inner) {
    const wrap = document.createElement("span");
    wrap.className = "cu-svg";
    wrap.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
    return wrap;
  }
  function iconMark() {
    const wrap = document.createElement("span");
    wrap.className = "cu-mark";
    wrap.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M5 19V12M12 19V5M19 19V9"/></svg>`;
    return wrap;
  }
  function iconRefresh() {
    return svg('<path d="M20 12a8 8 0 1 1-2.2-5.5"/><path d="M20 5v5h-5"/>');
  }
  function iconChevron(collapsed) {
    return svg(collapsed ? '<path d="M6 14l6-6 6 6"/>' : '<path d="M6 10l6 6 6-6"/>');
  }
  function iconClose() {
    return svg('<path d="M7 7l10 10M17 7L7 17"/>');
  }
  function iconGear() {
    return svg('<path d="M4 8h16M4 16h16"/><circle cx="9" cy="8" r="2.1"/><circle cx="15" cy="16" r="2.1"/>');
  }
  function iconDock() {
    return svg('<rect x="4.5" y="4.5" width="15" height="15" rx="2"/><rect x="12.2" y="12.2" width="7.3" height="7.3" rx="1.2"/>');
  }
  function iconExpand(expanded) {
    return svg(
      expanded ? '<rect x="7" y="9" width="10" height="10" rx="1.4"/><path d="M9 7V5.6A1.6 1.6 0 0 1 10.6 4H18.4A1.6 1.6 0 0 1 20 5.6V13.4A1.6 1.6 0 0 1 18.4 15H17"/>' : '<path d="M9 4H4v5M15 4h5v5M4 15v5h5M20 15v5h-5"/>'
    );
  }

  // src/content/index.ts
  var CSS_URL = chrome.runtime.getURL("styles/panel.css");
  var panel = null;
  var requestId = 0;
  var lastPath = location.pathname;
  var loginRetry = 0;
  var policy = DEFAULT_REFRESH_POLICY;
  var lastAt = null;
  var upgradeFetch = false;
  var learnedFirstParty = null;
  var learnedOther = null;
  var learnedBot = null;
  function postToPage(type, extra = {}) {
    window.postMessage({ channel: CHANNEL, type, ...extra }, window.location.origin);
  }
  function isResponse(data) {
    if (!data || typeof data !== "object") return false;
    const rec = data;
    return rec.channel === CHANNEL && typeof rec.type === "string";
  }
  async function boot() {
    const [cssText, settings, learned, otherLearned, botLearned] = await Promise.all([
      fetch(CSS_URL).then((r) => r.text()),
      loadRefreshSettings(),
      loadLearnedFirstParty(),
      loadLearnedOther(),
      loadLearnedBot()
    ]);
    policy = settings.policy;
    lastAt = settings.lastAt;
    learnedFirstParty = learned;
    learnedOther = otherLearned;
    learnedBot = botLearned;
    panel = new UsagePanel(cssText, {
      onRefresh: () => refresh(true),
      onPolicyChange: (next) => {
        policy = next;
        void saveRefreshPolicy(next);
      }
    }, policy);
    await panel.attach();
    if (settings.snapshot) {
      panel.setView(settings.snapshot.view, settings.snapshot.updatedAt);
      upgradeFetch = snapshotNeedsUpgrade(settings.snapshot.view);
    }
    syncRoute();
  }
  function syncRoute() {
    const onDashboard = isDashboardPath();
    panel?.setRouteVisible(onDashboard);
    if (!onDashboard) return;
    refresh(false);
  }
  function refresh(manual) {
    if (!panel || !isDashboardPath()) return;
    if (!manual && !upgradeFetch) {
      if (!isDashboardRoot() && lastAt != null) return;
      if (!shouldAutoRefresh(policy, lastAt)) return;
    }
    upgradeFetch = false;
    if (manual || !document.hidden) panel.setLoading(true);
    requestId += 1;
    postToPage("FETCH", { requestId });
  }
  window.addEventListener("message", (event) => {
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
      panel.setError(msg.error || "\u62C9\u53D6\u5931\u8D25");
      if ((msg.status === 401 || /登录/.test(msg.error || "")) && loginRetry < 1) {
        loginRetry += 1;
        window.setTimeout(() => refresh(true), 2e3);
      }
      return;
    }
    loginRetry = 0;
    if (msg.type === "DATA") {
      const view = buildView(msg.payload.summary, msg.payload.events, msg.payload.sand, {
        planInfo: msg.payload.planInfo,
        learned: learnedFirstParty,
        learnedOther,
        learnedBot,
        weekEvents: msg.payload.weekEvents
      });
      if (msg.payload.eventsError) {
        view.notes.push({ tone: "warn", text: msg.payload.eventsError });
      }
      if (msg.payload.sandError && view.bot.amount >= UNATTRIBUTED_MIN) {
        view.notes.push({ tone: "info", text: `Grok Bot \u5468\u9650\u989D\u672A\u62C9\u5230\uFF1A${msg.payload.sandError}` });
      }
      if (msg.payload.weekEventsError && view.bot.visible) {
        view.notes.push({ tone: "info", text: `Grok Bot \u672C\u5468\u7528\u91CF\u672A\u62C9\u5230\uFF1A${msg.payload.weekEventsError}` });
      }
      const nextLearned = learnedFromView(view);
      if (nextLearned) {
        learnedFirstParty = nextLearned;
        void saveLearnedFirstParty(nextLearned);
      }
      const nextOther = learnedOtherFromView(view);
      if (nextOther) {
        learnedOther = nextOther;
        void saveLearnedOther(nextOther);
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
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
})();
//# sourceMappingURL=content.js.map
