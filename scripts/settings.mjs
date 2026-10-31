// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Runyth. See the LICENSE file for rights and obligations.
import { DEFAULT_FILENAME_REGEX, MODULE_ID } from "./constants.mjs";

const SETTINGS = Object.freeze({
  archiveFilenameRegex: { scope: "world", config: true, type: String, default: DEFAULT_FILENAME_REGEX, name: "RBF.Settings.ArchiveFilenameRegex", hint: "RBF.Settings.ArchiveFilenameRegexHint" },
  moduleIncludeRegex: { scope: "world", config: true, type: String, default: "", name: "RBF.Settings.ModuleIncludeRegex", hint: "RBF.Settings.ModuleIncludeRegexHint" },
  moduleExcludeRegex: { scope: "world", config: true, type: String, default: "", name: "RBF.Settings.ModuleExcludeRegex", hint: "RBF.Settings.ModuleExcludeRegexHint" },
  maxArchiveMiB: { scope: "world", config: true, type: Number, default: 256, range: { min: 1, max: 2048, step: 1 }, name: "RBF.Settings.MaxArchiveMiB" },
  maxEntryMiB: { scope: "world", config: true, type: Number, default: 64, range: { min: 1, max: 1024, step: 1 }, name: "RBF.Settings.MaxEntryMiB" },
  maxEntries: { scope: "world", config: true, type: Number, default: 4096, range: { min: 1, max: 20000, step: 1 }, name: "RBF.Settings.MaxEntries" },
  concurrentReads: { scope: "world", config: true, type: Number, default: 4, range: { min: 1, max: 16, step: 1 }, name: "RBF.Settings.ConcurrentReads" },
  defaultConflictPolicy: { scope: "world", config: true, type: String, default: "ask", choices: { ask: "Ask", keep: "Keep live", import: "Import" }, name: "RBF.Settings.DefaultConflictPolicy" },
  auditRetention: { scope: "world", config: true, type: String, default: "0-7d=all;8-30d=daily;31-180d=weekly;181-730d=monthly;>730d=yearly", name: "RBF.Settings.AuditRetention", hint: "RBF.Settings.AuditRetentionHint" },
  autoReload: { scope: "world", config: true, type: Boolean, default: true, name: "RBF.Settings.AutoReload" },
  autoProcessDrop: { scope: "world", config: true, type: Boolean, default: true, name: "RBF.Settings.AutoProcessDrop", hint: "RBF.Settings.AutoProcessDropHint" },
  stopBulkOnFailure: { scope: "world", config: true, type: Boolean, default: true, name: "RBF.Settings.StopBulkOnFailure", hint: "RBF.Settings.StopBulkOnFailureHint" },
  confirmWrites: { scope: "world", config: true, type: Boolean, default: true, name: "RBF.Settings.ConfirmWrites" },
  dashboardDensity: { scope: "client", config: true, type: String, default: "comfortable", choices: { comfortable: "Comfortable", compact: "Compact" }, name: "RBF.Settings.DashboardDensity" },
  dashboardGeometry: { scope: "client", config: false, type: Object, default: {} }
});

export function registerSettings() {
  for (const [key, config] of Object.entries(SETTINGS)) game.settings.register(MODULE_ID, key, config);
}

export const settings = Object.freeze({
  get(key) { return game.settings.get(MODULE_ID, key); },
  async set(key, value) { return game.settings.set(MODULE_ID, key, value); },
  validateRegex(key) {
    const text = this.get(key);
    if (!text) return null;
    try { return new RegExp(text); }
    catch (error) { throw new Error(`Invalid regular expression in ${key}: ${error.message}`); }
  }
});
