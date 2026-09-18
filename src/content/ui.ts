import {
  LANE_META,
  LANE_ORDER,
  MODEL_FILTERS,
  modelLane,
  modelMatchesFilter,
  parseModelFilter,
  summarizeLanes,
  type ModelFilter,
  type ModelLane,
} from "../lib/classify";
import { detectTheme, h, isDashboardPath, clamp } from "../lib/dom";
import { hydrateUsageView, ratioPct } from "../lib/estimate";
import { formatAgo, formatDaysLeft, formatMoney, formatPct, formatResetAt, formatTokens } from "../lib/format";
import { addTokenStats, toTokenStats, type TokenStats } from "../lib/tokens";
import {
  DEFAULT_REFRESH_POLICY,
  REFRESH_POLICY_OPTIONS,
  policyLabel,
  type RefreshPolicy,
} from "../lib/settings";
import type { ModelRow, UsageView } from "../lib/types";

const STORAGE_POS = "cu.panel.pos";
const STORAGE_COLLAPSED = "cu.panel.collapsed";
const STORAGE_EXPANDED = "cu.panel.expanded";
const STORAGE_HIDDEN = "cu.panel.hidden";
const STORAGE_MODEL_FILTER = "cu.models.filter";

export type PanelCallbacks = {
  onRefresh: () => void;
  onPolicyChange: (policy: RefreshPolicy) => void;
};

type PersistedPos = { left: number; top: number };

export class UsagePanel {
  private host: HTMLDivElement;
  private root: ShadowRoot;
  private callbacks: PanelCallbacks;
  private collapsed = false;
  private expanded = false;
  private hidden = false;
  private pos: PersistedPos | null = null;
  private loading = false;
  private error: string | null = null;
  private view: UsageView | null = null;
  private updatedAt: number | null = null;
  private dragging = false;
  private mounted = false;
  private settingsOpen = false;
  private policy: RefreshPolicy = DEFAULT_REFRESH_POLICY;
  private modelFilter: ModelFilter = "all";

  constructor(cssText: string, callbacks: PanelCallbacks, policy: RefreshPolicy = DEFAULT_REFRESH_POLICY) {
    this.callbacks = callbacks;
    this.policy = policy;
    this.host = document.createElement("div");
    this.host.id = "cursor-usage-ext-host";
    this.host.style.all = "initial";
    this.root = this.host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = cssText;
    this.root.append(style, h("div", { class: "cu-mount" }));
  }

  async attach(): Promise<void> {
    if (this.mounted) return;
    await this.restore();
    document.documentElement.append(this.host);
    this.mounted = true;
    window.addEventListener("resize", this.onResize);
    this.render();
  }

  detach(): void {
    window.removeEventListener("resize", this.onResize);
    this.host.remove();
    this.mounted = false;
  }

  setRouteVisible(onDashboard: boolean): void {
    this.host.style.display = onDashboard ? "" : "none";
  }

  toggleHidden(): void {
    this.hidden = !this.hidden;
    this.render();
  }

  setLoading(loading: boolean): void {
    this.loading = loading;
    const panel = this.root.querySelector(".cu-panel") as HTMLElement | null;
    if (panel && this.view && !this.error) {
      panel.classList.toggle("is-refreshing", loading);
      const actions = panel.querySelector(".cu-actions");
      const spin = panel.querySelector(".cu-spin");
      if (loading && !spin && actions) {
        actions.prepend(h("span", { class: "cu-spin", "data-tip": "刷新中", "aria-label": "刷新中" }));
      } else if (!loading) {
        spin?.remove();
      }
      return;
    }
    this.render();
  }

  setError(error: string): void {
    this.error = error;
    this.loading = false;
    if (this.dragging) return;
    this.render();
  }

  setView(view: UsageView, updatedAt = Date.now()): void {
    this.view = hydrateUsageView(view);
    this.error = null;
    this.loading = false;
    this.updatedAt = updatedAt;
    if (this.dragging) return;
    this.render();
  }

  setPolicy(policy: RefreshPolicy): void {
    this.policy = policy;
    this.render();
  }

  private async restore(): Promise<void> {
    const stored = await chrome.storage.local.get([
      STORAGE_POS,
      STORAGE_COLLAPSED,
      STORAGE_EXPANDED,
      STORAGE_MODEL_FILTER,
    ]);
    this.pos = parsePos(stored[STORAGE_POS]);
    this.collapsed = !!stored[STORAGE_COLLAPSED];
    this.expanded = !!stored[STORAGE_EXPANDED] && !this.collapsed;
    this.hidden = false;
    this.modelFilter = parseModelFilter(stored[STORAGE_MODEL_FILTER]);
    // Hide is session-only. Drop a leftover persist from older versions so refresh shows the panel.
    void chrome.storage.local.remove(STORAGE_HIDDEN);
  }

  private mountEl(): HTMLElement {
    return this.root.querySelector(".cu-mount") as HTMLElement;
  }

  private render(): void {
    const prevBody = this.root.querySelector(".cu-body") as HTMLElement | null;
    const scrollTop = prevBody?.scrollTop ?? 0;
    const mount = this.mountEl();
    mount.replaceChildren();
    const theme = detectTheme();
    if (this.hidden) {
      mount.append(this.buildRestore(theme));
      this.setRouteVisible(isDashboardPath());
      return;
    }
    const panel = this.buildPanel(theme);
    mount.append(panel);
    this.applyPosition(panel);
    this.bindChrome(panel);
    this.bindTips(panel);
    this.setRouteVisible(isDashboardPath());
    const nextBody = this.root.querySelector(".cu-body") as HTMLElement | null;
    if (nextBody) nextBody.scrollTop = scrollTop;
  }

  private buildPanel(theme: "light" | "dark"): HTMLElement {
    const collapsed = this.collapsed;
    const classes = [
      "cu-panel",
      `theme-${theme}`,
      collapsed ? "is-collapsed" : "",
      this.expanded && !collapsed ? "is-expanded" : "",
      this.loading && this.view ? "is-refreshing" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return h("section", { class: classes, role: "complementary", "aria-label": "Cursor 用量明细" },
      this.buildHeader(),
      this.settingsOpen ? this.buildSettings() : null,
      collapsed ? null : this.buildBody(),
      collapsed ? null : this.buildFooter(),
    );
  }

  private buildHeader(): HTMLElement {
    const view = this.view;
    const title = this.collapsed && view
      ? [
          `${view.planLabel} · 第一方 ${formatMoney(view.cursor.used)} / ${formatMoney(view.cursor.total)} · ${formatPct(view.cursor.pct)}`,
          `官方 Other ${formatMoney(view.other.used)} / ${formatMoney(view.other.total)} · ${formatPct(view.other.pct)}`,
          view.bot.visible
            ? `Grok Bot ${formatMoney(view.bot.used)} / ${formatMoney(view.bot.total)} · ${formatPct(view.bot.pct)}`
            : "",
        ].filter(Boolean).join(" · ")
      : "Cursor 用量";

    return h("header", { class: "cu-head", "data-drag": "1" },
      h("div", { class: "cu-brand" },
        iconMark(),
        h("div", { class: "cu-titles" },
          h("div", { class: "cu-title" }, title),
          this.collapsed ? null : h("div", { class: "cu-sub" },
            view ? `${view.planLabel} · ${formatDaysLeft(view.daysLeft)}` : "个人订阅明细",
          ),
        ),
      ),
      h("div", { class: "cu-actions" },
        this.loading ? h("span", { class: "cu-spin", "data-tip": "刷新中", "aria-label": "刷新中" }) : null,
        button("cu-icon-btn", "刷新", iconRefresh(), () => this.callbacks.onRefresh()),
        button(
          `cu-icon-btn${this.expanded && !this.collapsed ? " is-on" : ""}`,
          this.expanded && !this.collapsed ? "还原" : "放大",
          iconExpand(this.expanded && !this.collapsed),
          () => this.toggleExpanded(),
        ),
        this.collapsed || this.expanded
          ? null
          : button("cu-icon-btn", "回到右下角", iconDock(), () => this.resetToCorner()),
        this.collapsed
          ? null
          : button(
              `cu-icon-btn${this.settingsOpen ? " is-on" : ""}`,
              "刷新策略",
              iconGear(),
              () => {
                this.settingsOpen = !this.settingsOpen;
                this.render();
              },
            ),
        button("cu-icon-btn", this.collapsed ? "展开" : "收起", iconChevron(this.collapsed), () => {
          this.collapsed = !this.collapsed;
          if (this.collapsed) {
            this.expanded = false;
            this.settingsOpen = false;
          }
          void chrome.storage.local.set({
            [STORAGE_COLLAPSED]: this.collapsed,
            [STORAGE_EXPANDED]: this.expanded,
          });
          this.render();
        }),
        button("cu-icon-btn", "隐藏浮层。刷新页面、点右下角「用量」或扩展图标可再打开", iconClose(), () => this.toggleHidden()),
      ),
    );
  }

  private buildBody(): HTMLElement {
    if (this.loading && !this.view && !this.error) {
      return h("div", { class: "cu-body" }, skeleton());
    }
    if (this.error && !this.view) {
      return h("div", { class: "cu-body" },
        h("div", { class: "cu-empty" },
          h("div", { class: "cu-empty-title" }, this.error),
          h("div", { class: "cu-empty-sub" }, "打开已登录的 Dashboard 后会自动重试。"),
        ),
      );
    }
    const view = this.view;
    if (!view) {
      return h("div", { class: "cu-body" },
        h("div", { class: "cu-empty" },
          h("div", { class: "cu-empty-title" }, "等待用量数据"),
          h("div", { class: "cu-empty-sub" }, "正在读取当前登录会话。"),
        ),
      );
    }
    if (view.teamUnsupported) {
      return h("div", { class: "cu-body" },
        h("div", { class: "cu-empty" },
          h("div", { class: "cu-empty-title" }, "一期仅支持个人订阅"),
          h("div", { class: "cu-empty-sub" }, "检测到团队用量结构，暂不估算团队池化额度。"),
        ),
      );
    }

    return h("div", { class: "cu-body" },
      this.error ? h("div", { class: "cu-note tone-warn" }, this.error) : null,
      h("div", { class: "cu-pools" },
        poolCard({
          kind: "cursor",
          kicker: "Cursor Models",
          title: "第一方池",
          used: view.cursor.used,
          total: view.cursor.total,
          pct: view.cursor.pct,
          remaining: view.cursor.remaining,
          badge: view.cursor.totalLabel,
          badgeTone:
            view.cursor.totalSource === "inverted" ? "ok" : view.cursor.totalSource === "learned" ? "warn" : "muted",
          selected: this.modelFilter === "cursor",
          onSelect: () => this.toggleFilter("cursor"),
        }),
        poolCard({
          kind: "other",
          kicker: "Other Models",
          title: "官方第三方池",
          used: view.other.used,
          total: view.other.total,
          pct: view.other.pct,
          remaining: view.other.remaining,
          badge: view.other.official ? "计入额度" : "推算",
          badgeTone: view.other.official ? "ok" : "warn",
          selected: this.modelFilter === "other",
          onSelect: () => this.toggleFilter("other"),
        }),
        view.bot.visible
          ? botCard({
              bot: view.bot,
              selected: this.modelFilter === "bot",
              onSelect: () => this.toggleFilter("bot"),
            })
          : null,
        view.onDemand.visible
          ? h("div", { class: "cu-side-row" },
              h("div", { class: "cu-side-copy" },
                h("div", { class: "cu-side-title" }, "按需用量"),
                h("div", { class: "cu-side-sub" }, view.onDemand.enabled ? "已开启 on-demand" : "本周期已产生按需费用"),
              ),
              h("div", { class: "cu-side-val" },
                view.onDemand.limit != null
                  ? `${formatMoney(view.onDemand.used)} / ${formatMoney(view.onDemand.limit)}`
                  : formatMoney(view.onDemand.used),
              ),
            )
          : null,
      ),
      this.buildModels(view.models),
      view.notes.length
        ? h("div", { class: "cu-notes" },
            ...view.notes.map((note) =>
              h("div", { class: `cu-note tone-${note.tone}` }, note.text),
            ),
          )
        : null,
    );
  }

  private buildRestore(theme: "light" | "dark"): HTMLElement {
    const btn = h("button", {
      class: `cu-restore theme-${theme}`,
      type: "button",
      "aria-label": "显示用量浮层",
    }, iconMark(), h("span", { class: "cu-restore-label" }, "用量"));
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.toggleHidden();
    });
    return btn;
  }

  private toggleExpanded(): void {
    this.expanded = !(this.expanded && !this.collapsed);
    this.collapsed = false;
    void chrome.storage.local.set({
      [STORAGE_COLLAPSED]: false,
      [STORAGE_EXPANDED]: this.expanded,
    });
    this.render();
  }

  private toggleFilter(next: ModelFilter): void {
    this.modelFilter = this.modelFilter === next ? "all" : next;
    void chrome.storage.local.set({ [STORAGE_MODEL_FILTER]: this.modelFilter });
    this.render();
  }

  private buildModels(models: ModelRow[]): HTMLElement | null {
    const lanes = summarizeLanes(models);
    const counts = Object.fromEntries(MODEL_FILTERS.map((item) => [item.id, 0])) as Record<ModelFilter, number>;
    counts.all = models.length;
    for (const lane of LANE_ORDER) counts[lane] = lanes[lane].count;
    const visible = models.filter((model) => modelMatchesFilter(model, this.modelFilter));
    const stats = addTokenStats(visible);
    const maxCost = Math.max(...visible.map((m) => m.cost), 0.01);
    const chips = MODEL_FILTERS.filter((item) => item.id === "all" || counts[item.id] > 0);
    const laneCount = LANE_ORDER.filter((lane) => lanes[lane].count > 0).length;
    const grouped = this.modelFilter === "all" && laneCount > 1;

    return h("div", { class: "cu-models" },
      h("div", { class: "cu-models-head" },
        h("div", { class: "cu-section-label" }, "按模型"),
        models.length ? modelsSum(this.modelFilter, visible, lanes) : null,
      ),
      chips.length > 1
        ? h("div", { class: "cu-chips", role: "tablist", "aria-label": "模型分类" },
            ...chips.map((item) => {
              const on = item.id === this.modelFilter;
              const chip = h("button", {
                class: `cu-chip${on ? " is-on" : ""}${item.id !== "all" ? ` lane-${item.id}` : ""}`,
                type: "button",
                role: "tab",
                "aria-selected": on ? "true" : "false",
                "data-tip": item.id === "all" ? "显示全部模型" : LANE_META[item.id].hint,
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
            }),
          )
        : null,
      visible.length ? tokenMetrics(stats) : null,
      !models.length
        ? h("div", { class: "cu-empty-sub" }, "当前周期还没有可展示的模型事件。")
        : !visible.length
          ? h("div", { class: "cu-empty-sub" }, "这一类没有模型。")
          : grouped
            ? h("div", { class: `cu-lanes${this.expanded ? " is-cols" : ""}` },
                ...LANE_ORDER.map((lane) => {
                  const items = visible.filter((model) => modelLane(model) === lane);
                  if (!items.length) return null;
                  const meta = LANE_META[lane];
                  const head = h("button", {
                    class: `cu-lane-head lane-${lane}`,
                    type: "button",
                    "data-tip": `${meta.hint} · 点击只看这类`,
                  },
                    h("span", { class: "cu-lane-dot" }),
                    h("span", { class: "cu-lane-copy" },
                      h("span", { class: "cu-lane-title" }, meta.label),
                      h("span", { class: "cu-lane-hint" }, meta.hint),
                    ),
                    h("span", { class: "cu-lane-sum" }, formatMoney(lanes[lane].amount)),
                  );
                  head.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    this.toggleFilter(lane);
                  });
                  return h("div", { class: `cu-lane lane-${lane}` },
                    head,
                    h("div", { class: "cu-table" },
                      ...items.map((model) => modelRow(model, Math.max(...items.map((row) => row.cost), 0.01))),
                    ),
                  );
                }),
              )
            : h("div", { class: "cu-table" },
                ...visible.map((model) => modelRow(model, maxCost)),
              ),
    );
  }

  private buildSettings(): HTMLElement {
    return h("div", { class: "cu-settings" },
      h("div", { class: "cu-section-label" }, "自动刷新"),
      h("div", { class: "cu-policy-list" },
        ...REFRESH_POLICY_OPTIONS.map((option) => {
          const selected = option.id === this.policy;
          const row = h("button", {
            class: `cu-policy${selected ? " is-selected" : ""}`,
            type: "button",
          },
            h("span", { class: "cu-policy-radio" }, selected ? "●" : "○"),
            h("span", { class: "cu-policy-copy" },
              h("span", { class: "cu-policy-label" }, option.label),
              option.hint ? h("span", { class: "cu-policy-hint" }, option.hint) : null,
            ),
          );
          row.addEventListener("click", (ev) => {
            ev.stopPropagation();
            this.policy = option.id;
            this.callbacks.onPolicyChange(option.id);
            this.render();
          });
          return row;
        }),
      ),
    );
  }

  private buildFooter(): HTMLElement {
    return h("footer", { class: "cu-foot" },
      h("span", null, `刷新 ${formatAgo(this.updatedAt)}`),
      h("span", { class: "cu-dot" }, "·"),
      h("span", null, policyLabel(this.policy)),
    );
  }

  private resetToCorner(): void {
    this.pos = null;
    void chrome.storage.local.remove(STORAGE_POS);
    this.render();
  }

  private applyPosition(panel: HTMLElement): void {
    if (!this.pos || this.collapsed || this.expanded) {
      panel.style.right = this.expanded ? "12px" : "16px";
      panel.style.bottom = this.expanded ? "12px" : "16px";
      panel.style.left = "auto";
      panel.style.top = "auto";
      return;
    }
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.left = `${this.pos.left}px`;
    panel.style.top = `${this.pos.top}px`;
  }

  private bindChrome(panel: HTMLElement): void {
    const head = panel.querySelector(".cu-head") as HTMLElement | null;
    if (!head) return;
    head.addEventListener("pointerdown", (event) => {
      if (this.collapsed || this.expanded || this.dragging) return;
      if (!(event.target instanceof Element)) return;
      if (event.target.closest("button")) return;
      this.startDrag(panel, event);
    });
  }

  private onResize = (): void => {
    if (!this.pos || this.collapsed || this.expanded) return;
    const panel = this.root.querySelector(".cu-panel") as HTMLElement | null;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    this.pos = {
      left: clamp(this.pos.left, 8, Math.max(8, window.innerWidth - rect.width - 8)),
      top: clamp(this.pos.top, 8, Math.max(8, window.innerHeight - rect.height - 8)),
    };
    this.applyPosition(panel);
  };

  private startDrag(panel: HTMLElement, event: PointerEvent): void {
    const rect = panel.getBoundingClientRect();
    const dx = event.clientX - rect.left;
    const dy = event.clientY - rect.top;
    this.dragging = true;
    panel.classList.add("is-dragging");
    headCapture(event.currentTarget as HTMLElement, event.pointerId);

    const move = (ev: PointerEvent) => {
      if (!this.dragging) return;
      const box = panel.getBoundingClientRect();
      const left = clamp(ev.clientX - dx, 8, Math.max(8, window.innerWidth - box.width - 8));
      const top = clamp(ev.clientY - dy, 8, Math.max(8, window.innerHeight - box.height - 8));
      this.pos = { left, top };
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    };

    const up = () => {
      this.dragging = false;
      panel.classList.remove("is-dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (this.pos) void chrome.storage.local.set({ [STORAGE_POS]: this.pos });
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  private bindTips(panel: HTMLElement): void {
    const tip = h("div", { class: `cu-tip${panel.classList.contains("theme-light") ? " is-light" : ""}`, role: "tooltip" });
    tip.hidden = true;
    this.mountEl().append(tip);
    let timer: number | null = null;
    let current: HTMLElement | null = null;

    const hide = () => {
      if (timer != null) {
        window.clearTimeout(timer);
        timer = null;
      }
      current = null;
      tip.hidden = true;
    };

    const place = (el: HTMLElement) => {
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

    panel.addEventListener("pointerover", (event) => {
      const el = (event.target as Element | null)?.closest?.("[data-tip]") as HTMLElement | null;
      if (!el || !panel.contains(el) || current === el) return;
      if (timer != null) window.clearTimeout(timer);
      current = el;
      timer = window.setTimeout(() => {
        timer = null;
        if (current === el) place(el);
      }, 60);
    });

    panel.addEventListener("pointerout", (event) => {
      const from = (event.target as Element | null)?.closest?.("[data-tip]");
      const to = (event.relatedTarget as Element | null)?.closest?.("[data-tip]");
      if (from && from === to) return;
      hide();
    });

    panel.addEventListener("pointerdown", hide);
  }
}

function headCapture(el: HTMLElement, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    /* ignore */
  }
}

function parsePos(value: unknown): PersistedPos | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as { left?: unknown; top?: unknown };
  if (typeof rec.left !== "number" || typeof rec.top !== "number") return null;
  if (!Number.isFinite(rec.left) || !Number.isFinite(rec.top)) return null;
  return { left: rec.left, top: rec.top };
}

function button(cls: string, title: string, child: Node, onClick: () => void): HTMLButtonElement {
  const btn = h("button", {
    class: cls,
    type: "button",
    "aria-label": title,
    "data-tip": title,
  }, child);
  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    onClick();
  });
  return btn;
}

function poolCard(opts: {
  kind: "cursor" | "other" | "bot";
  kicker: string;
  title: string;
  used: number | null;
  total: number | null;
  pct: number | null;
  remaining: number | null;
  badge: string;
  badgeTone: "ok" | "warn" | "muted" | "bot";
  extra?: string | null;
  selected?: boolean;
  onSelect?: () => void;
}): HTMLElement {
  const pct = opts.pct ?? ratioPct(opts.used, opts.total);
  const barTone = pct != null && pct >= 90 ? "hot" : pct != null && pct >= 70 ? "warm" : "ok";
  const lookHint =
    opts.kind === "cursor" ? "第一方" : opts.kind === "bot" ? "Grok Bot" : "官方 Other";
  const card = h("article", {
    class: `cu-card kind-${opts.kind}${opts.onSelect ? " is-clickable" : ""}${opts.selected ? " is-on" : ""}`,
    role: opts.onSelect ? "button" : undefined,
    tabindex: opts.onSelect ? "0" : undefined,
    "aria-pressed": opts.onSelect ? (opts.selected ? "true" : "false") : undefined,
    "data-tip": opts.onSelect ? (opts.selected ? "点击显示全部模型" : `点击只看${lookHint}`) : undefined,
  },
    h("div", { class: "cu-card-top" },
      h("div", null,
        h("div", { class: "cu-kicker" }, opts.kicker),
        h("div", { class: "cu-card-name" }, opts.title),
      ),
      h("span", { class: `cu-badge tone-${opts.badgeTone}` }, opts.badge),
    ),
    h("div", { class: "cu-metric" },
      h("span", { class: "cu-used" }, formatMoney(opts.used)),
      h("span", { class: "cu-slash" }, "/"),
      h("span", { class: "cu-total" }, formatMoney(opts.total)),
      h("span", { class: "cu-pct" }, formatPct(pct)),
    ),
    h("div", { class: "cu-bar" },
      h("div", {
        class: `cu-bar-fill tone-${barTone}`,
        style: `width:${clamp(pct ?? 0, 0, 100).toFixed(2)}%`,
      }),
    ),
    h("div", { class: "cu-card-foot" },
      opts.remaining != null ? `剩余 ${formatMoney(opts.remaining)}` : "剩余未知",
      opts.extra ? ` · ${opts.extra}` : "",
      opts.selected ? " · 正在查看" : "",
    ),
  );
  if (opts.onSelect) bindSelect(card, opts.onSelect);
  return card;
}

function botCard(opts: { bot: UsageView["bot"]; selected: boolean; onSelect: () => void }): HTMLElement {
  const bot = opts.bot;
  const extra = [
    bot.resetAt ? formatResetAt(bot.resetAt) : bot.daysLeft != null ? formatDaysLeft(bot.daysLeft) : null,
    bot.amount > 0 ? `本周期账单 ${formatMoney(bot.amount)}` : null,
  ].filter(Boolean).join(" · ");
  return poolCard({
    kind: "bot",
    kicker: "Grok Bot",
    title: "周限额",
    used: bot.used,
    total: bot.total,
    pct: bot.pct,
    remaining: bot.remaining,
    badge: bot.totalLabel,
    badgeTone: bot.totalSource === "inverted" ? "bot" : bot.totalSource === "learned" ? "warn" : "muted",
    extra: extra || null,
    selected: opts.selected,
    onSelect: opts.onSelect,
  });
}

function bindSelect(el: HTMLElement, onSelect: () => void): void {
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

function modelsSum(
  filter: ModelFilter,
  visible: ModelRow[],
  lanes: ReturnType<typeof summarizeLanes>,
): HTMLElement {
  if (filter !== "all") {
    return h("div", { class: "cu-models-sum" }, formatMoney(visible.reduce((s, model) => s + model.cost, 0)));
  }
  const parts = LANE_ORDER.filter((lane) => lanes[lane].count > 0);
  return h("div", { class: "cu-models-split" },
    ...parts.flatMap((lane, i) => {
      const item = h("span", { class: `cu-split-item lane-${lane}` }, `${LANE_META[lane].short} ${formatMoney(lanes[lane].amount)}`);
      if (i === 0) return [item];
      return [h("span", { class: "cu-split-dot", "aria-hidden": "true" }, "·"), item];
    }),
  );
}

function modelRow(model: ModelRow, maxCost: number): HTMLElement {
  const lane = modelLane(model);
  const width = clamp((model.cost / maxCost) * 100, 0, 100);
  const stats = toTokenStats(model);
  const meta = LANE_META[lane];
  return h("div", { class: `cu-row lane-${lane}` },
    h("div", { class: "cu-row-bar", style: `width:${width.toFixed(2)}%` }),
    h("div", { class: "cu-row-main" },
      h("div", { class: "cu-row-name" }, model.name),
      tokenMetrics(stats, true),
    ),
    h("div", { class: "cu-row-side" },
      h("div", { class: "cu-row-cost" }, formatMoney(model.cost)),
      laneTag(lane, meta),
    ),
  );
}

function tokenMetrics(stats: TokenStats, compact = false): HTMLElement {
  const cells: Array<[string, string]> = [
    ["总量", formatTokens(stats.total)],
    ["输入", formatTokens(stats.input)],
    ["输出", formatTokens(stats.output)],
    ["缓存", formatTokens(stats.cacheRead)],
    [compact ? "命中" : "命中率", formatPct(stats.hitRate)],
  ];
  return h("div", { class: `cu-metrics${compact ? " is-compact" : ""}` },
    ...cells.map(([label, value]) =>
      h("div", { class: "cu-metric-cell" },
        h("div", { class: "cu-metric-k" }, label),
        h("div", { class: "cu-metric-v" }, value),
      ),
    ),
  );
}

function laneTag(lane: ModelLane, meta: (typeof LANE_META)[ModelLane]): HTMLElement {
  return h("span", {
    class: `cu-tag tag-${lane}`,
    "data-tip": meta.hint,
  }, meta.tag);
}

function skeleton(): HTMLElement {
  return h("div", { class: "cu-skel" },
    h("div", { class: "cu-skel-card" }),
    h("div", { class: "cu-skel-card" }),
    h("div", { class: "cu-skel-line" }),
    h("div", { class: "cu-skel-line" }),
    h("div", { class: "cu-skel-line short" }),
  );
}

function svg(inner: string): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "cu-svg";
  wrap.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  return wrap;
}

function iconMark(): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "cu-mark";
  wrap.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="6" fill="currentColor"/><rect x="6.2" y="8" width="11.6" height="2.6" rx="1.3" fill="#fff"/><rect x="6.2" y="13.4" width="7.2" height="2.6" rx="1.3" fill="#fff" fill-opacity=".88"/></svg>`;
  return wrap;
}

function iconRefresh(): HTMLElement {
  return svg('<path d="M20 12a8 8 0 1 1-2.2-5.5"/><path d="M20 5v5h-5"/>');
}

function iconChevron(collapsed: boolean): HTMLElement {
  return svg(collapsed ? '<path d="M6 14l6-6 6 6"/>' : '<path d="M6 10l6 6 6-6"/>');
}

function iconClose(): HTMLElement {
  return svg('<path d="M7 7l10 10M17 7L7 17"/>');
}

function iconGear(): HTMLElement {
  return svg('<path d="M4 8h16M4 16h16"/><circle cx="9" cy="8" r="2.1"/><circle cx="15" cy="16" r="2.1"/>');
}

function iconDock(): HTMLElement {
  return svg('<rect x="4.5" y="4.5" width="15" height="15" rx="2"/><rect x="12.2" y="12.2" width="7.3" height="7.3" rx="1.2"/>');
}

function iconExpand(expanded: boolean): HTMLElement {
  return svg(
    expanded
      ? '<rect x="7" y="9" width="10" height="10" rx="1.4"/><path d="M9 7V5.6A1.6 1.6 0 0 1 10.6 4H18.4A1.6 1.6 0 0 1 20 5.6V13.4A1.6 1.6 0 0 1 18.4 15H17"/>'
      : '<path d="M9 4H4v5M15 4h5v5M4 15v5h5M20 15v5h-5"/>',
  );
}
