// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import { RegistrationRegistry } from "./registry.mjs";
import { DriverRegistry } from "./drivers.mjs";
import { AuditStore } from "./audit.mjs";
import { BackupEngine } from "./engine.mjs";
import { FoundryV13Adapter } from "./compat/foundry-v13.mjs";
import { settings } from "./settings.mjs";
import { API_VERSION, MODULE_VERSION } from "./constants.mjs";

export function createApi() {
  const compat = new FoundryV13Adapter();
  const registry = new RegistrationRegistry();
  const drivers = new DriverRegistry(compat);
  const audit = new AuditStore(compat);
  const engine = new BackupEngine({ registry, drivers, audit, compat, settings });
  return Object.freeze({
    version: MODULE_VERSION,
    apiVersion: API_VERSION,
    capabilities: Object.freeze({
      codecs: Object.freeze(["json", "text", "binary"]),
      drivers: Object.freeze(["setting", "document", "document-fields", "file", "json-file", "custom"]),
      mergeStrategies: Object.freeze(["keep", "replace", "shallow-object", "deep-object", "append-unique", "union-by-id"]),
      archiveFormatVersion: 1
    }),
    compat,
    registry,
    drivers,
    audit,
    engine,
    settings,
    register(definition) { return registry.register(definition); },
    unregister(moduleId) { return registry.unregister(moduleId); },
    list() { return registry.list(); },
    get(moduleId) { return registry.get(moduleId); },
    createBackup(moduleId, options = {}) { return engine.createArchive(moduleId, { ...options, operation: "backup" }); },
    createExport(moduleId, options = {}) { return engine.createArchive(moduleId, { ...options, operation: "export" }); },
    inspectArchive(file) { return engine.inspectArchive(file); },
    prepareImport(inspection, options = {}) { return engine.prepareImport(inspection, options); },
    executeImport(plan, options = {}) { return engine.executeImport(plan, options); },
    createMany(moduleIds, operation = "backup") { return engine.bulkCreate(moduleIds, operation); },
    inspectMany(files) { return engine.bulkInspect(files); },
    setResolution(plan, entryId, resolution) { return engine.setResolution(plan, entryId, resolution); },
    applyCategoryRule(plan, categoryPrefix, resolution) { return engine.applyCategoryRule(plan, categoryPrefix, resolution); }
  });
}
