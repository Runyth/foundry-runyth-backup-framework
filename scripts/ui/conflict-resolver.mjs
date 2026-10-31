// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Runyth. See the LICENSE file for rights and obligations.
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ConflictResolverApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "runyth-backup-framework-conflicts",
    classes: ["runyth-backup-framework", "rbf-conflicts"],
    position: { width: 980, height: 680 },
    window: { title: "Resolve Import Conflicts", resizable: true },
    actions: {
      resolve: this.#resolve,
      applyRule: this.#applyRule,
      reset: this.#reset,
      cancel: this.#cancel,
      continue: this.#continue
    }
  };

  static PARTS = { body: { template: "modules/runyth-backup-framework/templates/conflict-resolver.hbs", scrollable: [".rbf-conflict-list", ".rbf-category-list"] } };

  constructor(plan, engine, options = {}) {
    super(options);
    this.plan = plan;
    this.engine = engine;
    this.initialResolutions = new Map(plan.entries.map((item) => [item.schema.id, item.resolution]));
    this.resultPromise = new Promise((resolve) => { this._resolvePromise = resolve; });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const categories = categoryPrefixes(this.plan.entries);
    return {
      ...context,
      moduleTitle: this.plan.registration.title,
      conflicts: this.plan.entries.map((item) => ({
        id: item.schema.id,
        label: item.schema.label,
        category: item.schema.category.join(" / ") || "Uncategorized",
        archivePath: item.schema.zipPath,
        target: describeTarget(item.schema),
        reason: stateReason(item.state),
        state: item.state,
        resolution: item.resolution,
        allowKeep: item.schema.conflict.allowed.includes("keep"),
        allowImport: item.schema.conflict.allowed.includes("import"),
        allowMerge: item.schema.conflict.allowed.includes("merge") && Boolean(item.schema.conflict.merge),
        isKeep: item.resolution === "keep",
        isImport: item.resolution === "import",
        isMerge: item.resolution === "merge",
        live: preview(item.live),
        incoming: preview(item.incoming)
      })),
      categories
    };
  }

  static async #resolve(event, target) {
    this.engine.setResolution(this.plan, target.dataset.entryId, target.dataset.resolution);
    await this.render({ force: true });
  }

  static async #applyRule(event, target) {
    const category = target.closest("[data-category]")?.dataset.category ?? "";
    this.engine.applyCategoryRule(this.plan, category === "Uncategorized" ? [] : category.split("/"), target.dataset.resolution);
    await this.render({ force: true });
  }

  static async #reset() {
    for (const item of this.plan.entries) item.resolution = this.initialResolutions.get(item.schema.id) ?? null;
    await this.render({ force: true });
  }

  static async #cancel() {
    const resolve = this._resolvePromise;
    this._resolvePromise = null;
    resolve?.(null);
    await this.close();
  }
  static async #continue() {
    if (this.plan.entries.some((entry) => entry.state === "conflict" && !entry.resolution)) {
      ui.notifications.warn("Resolve every conflict before continuing.");
      return;
    }
    const resolve = this._resolvePromise;
    this._resolvePromise = null;
    resolve?.(this.plan);
    await this.close();
  }

  async _preClose(options) {
    const resolve = this._resolvePromise;
    this._resolvePromise = null;
    resolve?.(null);
    return super._preClose(options);
  }
}

function preview(value) {
  if (value instanceof Uint8Array) return `${value.length} bytes`;
  let text;
  try { text = JSON.stringify(value); } catch { text = String(value); }
  return text.length > 220 ? `${text.slice(0, 217)}...` : text;
}


function categoryPrefixes(entries) {
  const prefixes = new Map();
  let hasUncategorized = false;
  for (const item of entries) {
    const category = item.schema.category ?? [];
    if (!category.length) { hasUncategorized = true; continue; }
    for (let depth = 1; depth <= category.length; depth += 1) {
      const parts = category.slice(0, depth);
      const key = parts.join("/");
      prefixes.set(key, { key, label: parts.at(-1), fullLabel: parts.join(" / "), depth: depth - 1 });
    }
  }
  const result = [...prefixes.values()].sort((a, b) => a.key.localeCompare(b.key));
  if (hasUncategorized) result.unshift({ key: "Uncategorized", label: "Uncategorized", fullLabel: "Uncategorized", depth: 0 });
  return result;
}

function stateReason(state) {
  if (state === "same") return "Live and incoming values are identical.";
  if (state === "safe-import") return "Live state matches the declared baseline or is absent, so importing is non-conflicting.";
  return "Live state differs from the incoming value and does not match the declared baseline.";
}

function describeTarget(schema) {
  const driver = schema.driver ?? {};
  if (driver.type === "setting") return `Setting ${driver.namespace}.${driver.key}${driver.path ? `:${driver.path}` : ""}`;
  if (driver.type === "document") return `${driver.uuid}${driver.path ? `:${driver.path}` : ""}`;
  if (driver.type === "document-fields") return `${driver.uuid}: ${driver.paths.join(", ")}`;
  if (driver.type === "file" || driver.type === "json-file") return driver.path;
  return `Custom target (${schema.id})`;
}
