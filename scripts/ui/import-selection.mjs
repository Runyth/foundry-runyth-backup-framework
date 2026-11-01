// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import { MODULE_ID } from "../constants.mjs";
import { expandEntries } from "../registry.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ImportSelectionApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-import-selection`,
    classes: [MODULE_ID, "rbf-selection"],
    position: { width: 900, height: 650 },
    window: { title: "Choose Import Contents", resizable: true },
    actions: {
      toggleEntry: this.#toggleEntry,
      selectCategory: this.#selectCategory,
      clearCategory: this.#clearCategory,
      selectAll: this.#selectAll,
      clearOptional: this.#clearOptional,
      cancel: this.#cancel,
      apply: this.#apply
    }
  };

  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/import-selection.hbs`,
      scrollable: [".rbf-selection-list", ".rbf-category-list"]
    }
  };

  constructor(inspection, registration, options = {}) {
    super(options);
    this.inspection = inspection;
    this.registration = registration;
    this.schemaEntries = [];
    this.selected = new Set(inspection.manifest.entries.map((entry) => entry.id));
    this.resultPromise = new Promise((resolve) => { this._resolvePromise = resolve; });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    this.schemaEntries = await expandEntries(this.registration, { operation: "import", archiveOperation: this.inspection.manifest.operation, manifest: this.inspection.manifest });
    const archived = new Map(this.inspection.manifest.entries.map((entry) => [entry.id, entry]));
    const rows = this.schemaEntries.filter((entry) => archived.has(entry.id)).map((entry) => ({
      id: entry.id,
      label: entry.label,
      description: entry.description ?? "",
      category: entry.category.join(" / ") || "Uncategorized",
      categoryKey: entry.category.join("/") || "Uncategorized",
      selected: entry.partial === false || this.selected.has(entry.id),
      locked: entry.partial === false,
      dependencies: entry.dependencies.join(", "),
      size: archived.get(entry.id).size
    }));
    const categories = buildCategoryPrefixes(rows.map((row) => row.categoryKey));
    return {
      ...context,
      moduleTitle: this.registration.title,
      rows,
      categories,
      selectedCount: rows.filter((row) => row.selected).length,
      totalCount: rows.length
    };
  }

  static async #toggleEntry(event, target) {
    const id = target.dataset.entryId;
    const schema = this.schemaEntries.find((entry) => entry.id === id);
    if (!schema || schema.partial === false) return;
    this.selected.has(id) ? this.selected.delete(id) : this.selected.add(id);
    await this.render({ force: true });
  }

  static async #selectCategory(event, target) {
    this.#setCategory(target.dataset.category, true);
    await this.render({ force: true });
  }

  static async #clearCategory(event, target) {
    this.#setCategory(target.dataset.category, false);
    await this.render({ force: true });
  }

  #setCategory(category, selected) {
    const prefix = category === "Uncategorized" ? [] : category.split("/");
    for (const entry of this.schemaEntries) {
      if (entry.partial === false) continue;
      const matches = prefix.every((part, index) => entry.category[index] === part);
      if (!matches) continue;
      selected ? this.selected.add(entry.id) : this.selected.delete(entry.id);
    }
  }

  static async #selectAll() {
    for (const entry of this.schemaEntries) this.selected.add(entry.id);
    await this.render({ force: true });
  }

  static async #clearOptional() {
    this.selected.clear();
    for (const entry of this.schemaEntries) if (entry.partial === false) this.selected.add(entry.id);
    await this.render({ force: true });
  }

  static async #cancel() {
    const resolve = this._resolvePromise;
    this._resolvePromise = null;
    resolve?.(null);
    await this.close();
  }

  static async #apply() {
    const resolve = this._resolvePromise;
    this._resolvePromise = null;
    resolve?.(new Set(this.selected));
    await this.close();
  }

  async _preClose(options) {
    const resolve = this._resolvePromise;
    this._resolvePromise = null;
    resolve?.(null);
    return super._preClose(options);
  }
}

function buildCategoryPrefixes(categoryKeys) {
  const seen = new Set();
  const result = [];
  for (const key of [...new Set(categoryKeys)].sort()) {
    if (key === "Uncategorized") {
      if (!seen.has(key)) result.push({ key, label: key, depth: 0 });
      seen.add(key);
      continue;
    }
    const parts = key.split("/");
    for (let depth = 0; depth < parts.length; depth += 1) {
      const prefix = parts.slice(0, depth + 1).join("/");
      if (seen.has(prefix)) continue;
      seen.add(prefix);
      result.push({ key: prefix, label: parts[depth], depth });
    }
  }
  return result;
}
