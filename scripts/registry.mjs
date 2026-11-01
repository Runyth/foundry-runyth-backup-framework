// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import { API_VERSION } from "./constants.mjs";
import { assert, normalizeCategory, safeArchivePath, semverLike } from "./util.mjs";

const VALID_CAPABILITIES = new Set(["backup", "import", "export"]);
const VALID_CODECS = new Set(["json", "text", "binary"]);
const VALID_ENTRY_OPERATIONS = new Set(["backup", "import", "export"]);

export class RegistrationRegistry {
  #registrations = new Map();

  register(definition) {
    const normalized = normalizeRegistration(definition);
    assert(!this.#registrations.has(normalized.moduleId), `Module is already registered: ${normalized.moduleId}`);
    this.#registrations.set(normalized.moduleId, normalized);
    return normalized;
  }

  unregister(moduleId) { return this.#registrations.delete(moduleId); }
  get(moduleId) { return this.#registrations.get(moduleId); }
  has(moduleId) { return this.#registrations.has(moduleId); }
  list() { return [...this.#registrations.values()].sort((a, b) => a.title.localeCompare(b.title)); }
  clear() { this.#registrations.clear(); }
}

export function normalizeRegistration(definition) {
  assert(definition && typeof definition === "object", "Registration must be an object.");
  const moduleId = String(definition.moduleId ?? "").trim();
  assert(/^[a-z0-9][a-z0-9-]*$/.test(moduleId), `Invalid moduleId: ${moduleId}`);
  const capabilities = [...new Set(definition.capabilities ?? ["backup", "import", "export"])];
  assert(capabilities.length > 0 && capabilities.every((capability) => VALID_CAPABILITIES.has(capability)), "Registration capabilities are invalid.");
  const frameworkApi = { minimum: 1, maximum: API_VERSION, ...(definition.frameworkApi ?? {}) };
  assert(Number.isInteger(frameworkApi.minimum) && Number.isInteger(frameworkApi.maximum), `Registration ${moduleId} frameworkApi bounds must be integers.`);
  assert(frameworkApi.minimum <= API_VERSION && frameworkApi.maximum >= API_VERSION, `Registration ${moduleId} does not support framework API ${API_VERSION}.`);
  const schema = definition.schema;
  assert(schema && typeof schema === "object", `Registration ${moduleId} requires a schema.`);
  const schemaId = String(schema.id ?? `${moduleId}-default`);
  const schemaVersion = Number(schema.version ?? 1);
  assert(Number.isInteger(schemaVersion) && schemaVersion >= 1, `Invalid schema version for ${moduleId}.`);
  const entries = typeof schema.entries === "function" ? schema.entries : [...(schema.entries ?? [])];
  if (Array.isArray(entries)) entries.forEach((entry) => normalizeEntry(entry));
  return Object.freeze({
    moduleId,
    title: String(definition.title ?? moduleId),
    description: String(definition.description ?? ""),
    capabilities: Object.freeze(capabilities),
    frameworkApi: Object.freeze(frameworkApi),
    moduleVersion: definition.moduleVersion ?? (() => globalThis.game?.modules?.get(moduleId)?.version ?? "0.0.0"),
    schema: Object.freeze({ ...schema, id: schemaId, version: schemaVersion, entries }),
    migrations: Object.freeze([...(definition.migrations ?? [])]),
    mergeStrategies: Object.freeze({ ...(definition.mergeStrategies ?? {}) }),
    hooks: Object.freeze({ ...(definition.hooks ?? {}) })
  });
}

export function normalizeEntry(entry) {
  assert(entry && typeof entry === "object", "Schema entry must be an object.");
  assert(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(String(entry.id ?? "")), `Invalid schema entry id: ${entry.id}`);
  assert(VALID_CODECS.has(entry.codec ?? "json"), `Unsupported codec for ${entry.id}: ${entry.codec}`);
  safeArchivePath(entry.zipPath ?? `data/${entry.id}.${entry.codec === "binary" ? "bin" : entry.codec === "text" ? "txt" : "json"}`);
  assert(entry.driver && typeof entry.driver === "object", `Schema entry ${entry.id} requires a driver.`);
  const operations = [...new Set(entry.operations ?? ["backup", "import", "export"])];
  assert(operations.length > 0 && operations.every((operation) => VALID_ENTRY_OPERATIONS.has(operation)), `Invalid operations for ${entry.id}.`);
  const allowed = [...(entry.conflict?.allowed ?? ["keep", "import"])];
  assert(allowed.length > 0 && allowed.every((value) => ["keep", "merge", "import"].includes(value)), `Invalid conflict actions for ${entry.id}.`);
  if (allowed.includes("merge")) assert(Boolean(entry.conflict?.merge), `Schema entry ${entry.id} allows merge but defines no merge strategy.`);
  if (entry.conflict?.classify !== undefined) assert(typeof entry.conflict.classify === "function", `Schema entry ${entry.id} conflict.classify must be a function.`);
  if (entry.validate !== undefined) assert(typeof entry.validate === "function", `Schema entry ${entry.id} validate must be a function.`);
  return {
    ...entry,
    label: String(entry.label ?? entry.id),
    description: String(entry.description ?? ""),
    category: normalizeCategory(entry.category),
    metadata: entry.metadata ?? null,
    codec: entry.codec ?? "json",
    required: entry.required !== false,
    partial: entry.partial !== false,
    operations,
    dependencies: [...(entry.dependencies ?? [])],
    zipPath: entry.zipPath ?? `data/${entry.id}.${entry.codec === "binary" ? "bin" : entry.codec === "text" ? "txt" : "json"}`,
    conflict: {
      allowed,
      merge: entry.conflict?.merge ?? null,
      classify: entry.conflict?.classify ?? null,
      autoImportWhenLiveIsBaseline: entry.conflict?.autoImportWhenLiveIsBaseline !== false
    }
  };
}

export async function expandEntries(registration, context = {}) {
  const raw = typeof registration.schema.entries === "function"
    ? await registration.schema.entries({ moduleId: registration.moduleId, schemaVersion: registration.schema.version, ...context })
    : registration.schema.entries;
  assert(Array.isArray(raw), `Schema entries for ${registration.moduleId} must resolve to an array.`);
  const entries = raw.map(normalizeEntry);
  const ids = new Set();
  const paths = new Set();
  for (const entry of entries) {
    assert(!ids.has(entry.id), `Duplicate schema entry id: ${entry.id}`);
    assert(!paths.has(entry.zipPath), `Duplicate schema ZIP path: ${entry.zipPath}`);
    ids.add(entry.id);
    paths.add(entry.zipPath);
  }
  for (const entry of entries) {
    for (const dependency of entry.dependencies) assert(ids.has(dependency), `Schema entry ${entry.id} depends on unknown entry ${dependency}.`);
  }
  if (!context.operation) return entries;
  const selected = entries.filter((entry) => entry.operations.includes(context.operation));
  const selectedIds = new Set(selected.map((entry) => entry.id));
  for (const entry of selected) {
    for (const dependency of entry.dependencies) {
      assert(selectedIds.has(dependency), `Schema entry ${entry.id} depends on ${dependency}, but ${dependency} is excluded from operation ${context.operation}.`);
    }
  }
  return selected;
}

export function resolveModuleVersion(registration) {
  const value = typeof registration.moduleVersion === "function" ? registration.moduleVersion() : registration.moduleVersion;
  assert(semverLike(value), `Integrating module ${registration.moduleId} returned non-SemVer moduleVersion: ${value}`);
  return String(value);
}
