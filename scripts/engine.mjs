// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Runyth. See the LICENSE file for rights and obligations.
import { API_VERSION, FORMAT_ID, FORMAT_VERSION, MANIFEST_PATH, MODULE_VERSION } from "./constants.mjs";
import { decodeValue, encodeValue } from "./drivers.mjs";
import { digestObject, sha256 } from "./integrity.mjs";
import { mergeValues } from "./merge.mjs";
import { createStoreZip, parseStoreZip } from "./zip-store.mjs";
import { expandEntries, resolveModuleVersion } from "./registry.mjs";
import { bytesEqual, canonicalJson, compactTimestamp, deepClone, escapeHtml, mapLimit, semverLike, utf8Decode, utf8Encode } from "./util.mjs";

export class BackupEngine {
  constructor({ registry, drivers, audit, compat, settings }) {
    this.registry = registry;
    this.drivers = drivers;
    this.audit = audit;
    this.compat = compat;
    this.settings = settings;
  }

  archiveLimits() {
    return {
      maxArchiveBytes: this.settings.get("maxArchiveMiB") * 1024 * 1024,
      maxEntryBytes: this.settings.get("maxEntryMiB") * 1024 * 1024,
      maxEntries: this.settings.get("maxEntries")
    };
  }

  async createArchive(moduleId, { operation = "backup", selection = null, save = true } = {}) {
    const registration = this.#requireRegistration(moduleId, operation);
    const entries = await expandEntries(registration, { operation });
    const selected = dependencyClosure(entries, selection);
    await registration.hooks?.beforeArchive?.({ operation, moduleId, selection: selected.map((entry) => entry.id) });
    const capturedRaw = await mapLimit(selected, this.settings.get("concurrentReads"), async (entry) => {
      const driver = this.drivers.create(entry);
      const exists = driver.exists ? await driver.exists() : true;
      if (!exists) {
        if (entry.required) throw new Error(`Required schema entry is missing: ${entry.id}`);
        return null;
      }
      const value = await driver.read();
      if (typeof entry.validate === "function") await entry.validate(value, { phase: "archive", entry });
      assertJsonCompatible(entry.metadata, `metadata for schema entry ${entry.id}`);
      const bytes = encodeValue(entry.codec, value);
      return { entry, bytes, sha256: await sha256(bytes) };
    });
    const captured = capturedRaw.filter(Boolean);

    const moduleVersion = resolveModuleVersion(registration);
    const integrationMetadata = typeof registration.schema.metadata === "function"
      ? await registration.schema.metadata({ operation, moduleId, moduleVersion })
      : (registration.schema.metadata ?? null);
    assertJsonCompatible(integrationMetadata, "schema metadata");
    const createdAt = new Date().toISOString();
    const archiveId = crypto.randomUUID();
    const manifest = {
      format: FORMAT_ID,
      formatVersion: FORMAT_VERSION,
      frameworkVersion: MODULE_VERSION,
      frameworkApiVersion: API_VERSION,
      archiveId,
      operation,
      moduleId,
      moduleTitle: registration.title,
      moduleVersion,
      schemaId: registration.schema.id,
      schemaVersion: registration.schema.version,
      integrationMetadata,
      createdAt,
      foundryVersion: this.compat.foundryVersion(),
      worldId: this.compat.worldId(),
      entries: captured.map(({ entry, bytes, sha256: digest }) => ({
        id: entry.id,
        label: entry.label,
        category: entry.category,
        zipPath: entry.zipPath,
        codec: entry.codec,
        required: entry.required,
        metadata: entry.metadata ?? null,
        size: bytes.length,
        sha256: digest
      }))
    };
    manifest.manifestDigest = await digestObject(manifest);
    const zipEntries = [
      { path: MANIFEST_PATH, data: utf8Encode(canonicalJson(manifest)) },
      ...captured.map(({ entry, bytes }) => ({ path: entry.zipPath, data: bytes }))
    ];
    const zip = createStoreZip(zipEntries);
    const filename = `${moduleId}-${operation}-${moduleVersion}-${compactTimestamp(new Date(createdAt))}.zip`;
    if (save) this.compat.saveFile(zip, "application/zip", filename);
    await registration.hooks?.afterArchive?.({ operation, moduleId, filename, manifest });
    return { filename, bytes: zip, manifest };
  }

  async inspectArchive(file) {
    const array = file instanceof Uint8Array ? file : new Uint8Array(await file.arrayBuffer());
    const archiveSha256 = await sha256(array);
    const zip = parseStoreZip(array, this.archiveLimits());
    const manifestBytes = zip.get(MANIFEST_PATH);
    if (!manifestBytes) throw new Error(`Archive is missing ${MANIFEST_PATH}.`);
    const manifest = JSON.parse(utf8Decode(manifestBytes));
    await this.#validateManifest(manifest, zip);
    return { file, bytes: array, zip, manifest, archiveSha256 };
  }

  async prepareImport(inspection, { selection = null } = {}) {
    const { manifest, zip } = inspection;
    const registration = this.#requireRegistration(manifest.moduleId, "import");
    if (manifest.schemaId !== registration.schema.id) throw new Error(`Schema ID mismatch for ${manifest.moduleId}: ${manifest.schemaId} != ${registration.schema.id}`);
    const migrated = await this.#migrateManifestEntries(registration, manifest, zip);
    const allCurrentEntries = await expandEntries(registration, { archiveOperation: migrated.operation, manifest: migrated });
    const allEntryById = new Map(allCurrentEntries.map((entry) => [entry.id, entry]));
    const currentEntries = allCurrentEntries.filter((entry) => entry.operations.includes("import"));
    const entryById = new Map(currentEntries.map((entry) => [entry.id, entry]));
    const archivedIds = new Set(migrated.entries.map((entry) => entry.id));
    for (const entry of currentEntries) {
      if (entry.required && !archivedIds.has(entry.id)) throw new Error(`Archive is missing required schema entry: ${entry.id}`);
    }
    for (const stored of migrated.entries) {
      if (!allEntryById.has(stored.id)) throw new Error(`Archive entry is not defined by the current schema: ${stored.id}`);
    }
    await registration.hooks?.validateArchive?.({ manifest: migrated, inspection, entries: currentEntries });
    const defaultSelection = migrated.entries.filter((entry) => entryById.has(entry.id)).map((entry) => entry.id);
    const selectedIds = new Set(selection ?? defaultSelection);
    for (const id of selectedIds) {
      if (!allEntryById.has(id)) throw new Error(`Unknown schema selection: ${id}`);
      if (!entryById.has(id)) throw new Error(`Schema entry ${id} is not importable.`);
    }
    const selectedSchemaEntries = dependencyClosure(currentEntries, selectedIds);
    const selectedClosure = new Set(selectedSchemaEntries.map((entry) => entry.id));
    const planned = [];

    for (const stored of migrated.entries) {
      if (!selectedClosure.has(stored.id)) continue;
      const schema = entryById.get(stored.id);
      if (!schema) continue;
      if (stored.zipPath !== schema.zipPath) throw new Error(`Archive path for ${stored.id} does not match the current schema: ${stored.zipPath} != ${schema.zipPath}`);
      if (stored.codec !== schema.codec) throw new Error(`Archive codec for ${stored.id} does not match the current schema: ${stored.codec} != ${schema.codec}`);
      const bytes = zip.get(stored.zipPath);
      const incoming = decodeValue(schema.codec, bytes);
      if (typeof schema.validate === "function") await schema.validate(incoming, { phase: "import", schema, manifest: migrated });
      const driver = this.drivers.create(schema);
      const live = await driver.read();
      const baseline = await driver.baseline();
      const baselineDescriptor = (schema.driver.baselineSha256 || schema.driver.baselineMissing) ? baseline : null;
      const defaultState = await classifyState({
        live,
        incoming,
        baseline,
        codec: schema.codec,
        baselineDescriptor,
        autoImportWhenLiveIsBaseline: schema.conflict.autoImportWhenLiveIsBaseline
      });
      const state = schema.conflict.classify
        ? await schema.conflict.classify({ live: deepClone(live), incoming: deepClone(incoming), baseline: deepClone(baseline), defaultState, schema, manifest: migrated })
        : defaultState;
      if (!["same", "safe-import", "conflict"].includes(state)) throw new Error(`Custom conflict classifier for ${schema.id} returned invalid state: ${state}`);
      const configuredPolicy = this.settings.get("defaultConflictPolicy");
      planned.push({
        schema,
        stored,
        driver,
        live,
        incoming,
        baseline,
        state,
        resolution: defaultResolution(schema, state, configuredPolicy)
      });
    }

    return {
      inspection,
      registration,
      manifest: migrated,
      entries: planned,
      conflicts: planned.filter((entry) => entry.state === "conflict"),
      requiresDecision: planned.some((entry) => entry.state === "conflict")
    };
  }

  applyCategoryRule(plan, categoryPrefix, resolution) {
    const prefix = Array.isArray(categoryPrefix) ? categoryPrefix : String(categoryPrefix).split("/").filter(Boolean);
    for (const item of plan.entries) {
      const matches = prefix.every((part, index) => item.schema.category[index] === part);
      if (matches && item.schema.conflict.allowed.includes(resolution)) item.resolution = resolution;
    }
    return plan;
  }

  setResolution(plan, entryId, resolution) {
    const item = plan.entries.find((candidate) => candidate.schema.id === entryId);
    if (!item) throw new Error(`Import plan entry not found: ${entryId}`);
    if (!item.schema.conflict.allowed.includes(resolution)) throw new Error(`Resolution ${resolution} is not allowed for ${entryId}.`);
    item.resolution = resolution;
  }

  async executeImport(plan, { skipConfirmation = false } = {}) {
    if (plan.entries.some((entry) => entry.state === "conflict" && !entry.resolution)) throw new Error("Import plan contains unresolved conflicts.");
    if (!skipConfirmation && this.settings.get("confirmWrites")) {
      const confirmed = await this.compat.confirm({
        title: "Apply import",
        content: `<p>Apply ${plan.entries.length} selected element(s) for <strong>${escapeHtml(plan.registration.title)}</strong>?</p>`,
        yes: "Apply import",
        no: "Cancel"
      });
      if (!confirmed) return { cancelled: true };
    }

    await plan.registration.hooks?.beforeImport?.({ plan });
    const transaction = [];
    const changes = [];
    try {
      // Apply file-backed entries last because Foundry v13 exposes no public FilePicker delete API.
      // This minimizes the chance of non-removable newly-created files if an earlier operation fails.
      const isFileBacked = (item) => ["file", "json-file"].includes(item.schema.driver.type);
      const ordered = [...plan.entries].sort((a, b) => Number(isFileBacked(a)) - Number(isFileBacked(b)));
      const operations = [];

      for (const item of ordered) {
        const resolution = item.resolution ?? defaultResolution(item.schema, item.state);
        if (resolution === "keep" || item.state === "same") {
          changes.push(changeRecord(item, "kept"));
          continue;
        }
        let value = item.incoming;
        if (resolution === "merge") value = mergeValues(item.schema.conflict.merge, item.live, item.incoming, plan.registration.mergeStrategies);
        operations.push({ item, resolution, value });
      }

      // Preflight every rollback snapshot before the first write. A read/snapshot failure therefore
      // aborts without changing the live world.
      for (const operation of operations) operation.snapshot = await operation.item.driver.snapshot();

      for (const operation of operations) {
        transaction.push({ item: operation.item, snapshot: operation.snapshot });
        const result = await operation.item.driver.apply(deepClone(operation.value));
        changes.push(changeRecord(operation.item, operation.resolution === "merge" ? "merged" : "imported", result));
      }
      const audit = await this.audit.append({
        moduleId: plan.registration.moduleId,
        moduleVersion: plan.manifest.moduleVersion,
        operation: "import",
        archiveId: plan.manifest.archiveId,
        archiveSha256: plan.inspection.archiveSha256,
        userId: this.compat.userId(),
        status: "success",
        changes
      });
      await plan.registration.hooks?.afterImport?.({ plan, changes, audit });
      return { cancelled: false, success: true, changes, audit };
    } catch (error) {
      const rollbackErrors = [];
      for (const step of transaction.reverse()) {
        try { await step.item.driver.rollback(step.snapshot); }
        catch (rollbackError) { rollbackErrors.push({ entryId: step.item.schema.id, error: String(rollbackError) }); }
      }
      await this.audit.append({
        moduleId: plan.registration.moduleId,
        moduleVersion: plan.manifest.moduleVersion,
        operation: "import",
        archiveId: plan.manifest.archiveId,
        archiveSha256: plan.inspection.archiveSha256,
        userId: this.compat.userId(),
        status: rollbackErrors.length ? "failed-rollback-incomplete" : "failed-rolled-back",
        error: String(error),
        rollbackErrors,
        changes
      });
      error.rollbackErrors = rollbackErrors;
      throw error;
    }
  }

  async bulkCreate(moduleIds, operation = "backup") {
    const results = [];
    for (const moduleId of moduleIds) results.push(await this.createArchive(moduleId, { operation, save: true }));
    return results;
  }

  async bulkInspect(files) {
    const results = [];
    for (const file of files) {
      try { results.push({ ok: true, inspection: await this.inspectArchive(file), file }); }
      catch (error) { results.push({ ok: false, error, file }); }
    }
    return results;
  }

  #requireRegistration(moduleId, capability) {
    const registration = this.registry.get(moduleId);
    if (!registration) throw new Error(`No registered integration for module: ${moduleId}`);
    if (!registration.capabilities.includes(capability)) throw new Error(`${moduleId} does not implement ${capability}.`);
    return registration;
  }

  async #validateManifest(manifest, zip) {
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("Archive manifest must be an object.");
    if (manifest.format !== FORMAT_ID || manifest.formatVersion !== FORMAT_VERSION) throw new Error("Unsupported backup framework archive format.");
    if (!Number.isInteger(manifest.frameworkApiVersion) || manifest.frameworkApiVersion < 1 || manifest.frameworkApiVersion > API_VERSION) throw new Error(`Unsupported framework API version: ${manifest.frameworkApiVersion}`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(String(manifest.moduleId ?? ""))) throw new Error("Archive manifest contains an invalid module ID.");
    if (!semverLike(String(manifest.moduleVersion ?? ""))) throw new Error("Archive manifest contains an invalid module version.");
    if (!semverLike(String(manifest.frameworkVersion ?? ""))) throw new Error("Archive manifest contains an invalid framework version.");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(manifest.archiveId ?? ""))) throw new Error("Archive manifest contains an invalid archive ID.");
    if (!Number.isFinite(Date.parse(String(manifest.createdAt ?? "")))) throw new Error("Archive manifest contains an invalid creation timestamp.");
    if (!["backup", "export"].includes(manifest.operation)) throw new Error(`Unsupported archive operation: ${manifest.operation}`);
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(String(manifest.schemaId ?? ""))) throw new Error("Archive manifest contains an invalid schema ID.");
    if (!Number.isInteger(manifest.schemaVersion) || manifest.schemaVersion < 1) throw new Error("Archive manifest contains an invalid schema version.");
    if (!Array.isArray(manifest.entries)) throw new Error("Archive manifest entries must be an array.");
    const expectedManifestDigest = await digestObject({ ...manifest, manifestDigest: undefined });
    if (manifest.manifestDigest !== expectedManifestDigest) throw new Error("Archive manifest SHA-256 digest mismatch.");
    const paths = new Set([MANIFEST_PATH]);
    const ids = new Set();
    for (const entry of manifest.entries) {
      if (!entry || typeof entry !== "object") throw new Error("Archive manifest contains a malformed entry.");
      if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(String(entry.id ?? ""))) throw new Error("Archive manifest contains an invalid entry ID.");
      if (!["json", "text", "binary"].includes(entry.codec)) throw new Error(`Archive manifest contains an invalid codec for ${entry.id}.`);
      if (ids.has(entry.id)) throw new Error(`Duplicate manifest entry ID: ${entry.id}`);
      ids.add(entry.id);
      if (!Number.isInteger(entry.size) || entry.size < 0) throw new Error(`Invalid archive entry size: ${entry.id}`);
      if (!/^[a-f0-9]{64}$/.test(String(entry.sha256 ?? ""))) throw new Error(`Invalid archive entry SHA-256: ${entry.id}`);
      if (paths.has(entry.zipPath)) throw new Error(`Duplicate manifest ZIP path: ${entry.zipPath}`);
      paths.add(entry.zipPath);
      const bytes = zip.get(entry.zipPath);
      if (!bytes) throw new Error(`Archive is missing declared entry: ${entry.zipPath}`);
      if (bytes.length !== entry.size) throw new Error(`Archive entry size mismatch: ${entry.zipPath}`);
      if (await sha256(bytes) !== entry.sha256) throw new Error(`Archive entry SHA-256 mismatch: ${entry.zipPath}`);
    }
    for (const path of zip.keys()) if (!paths.has(path)) throw new Error(`Archive contains undeclared entry: ${path}`);
  }

  async #migrateManifestEntries(registration, manifest, zip) {
    if (manifest.schemaVersion === registration.schema.version) return manifest;
    let current = deepClone(manifest);
    while (current.schemaVersion < registration.schema.version) {
      const migration = registration.migrations.find((candidate) => candidate.from === current.schemaVersion);
      if (!migration) throw new Error(`No migration from schema ${current.schemaVersion} to ${registration.schema.version} for ${registration.moduleId}.`);
      current = await migration.migrate({ manifest: current, zip });
      current.schemaVersion = migration.to;
    }
    if (current.schemaVersion !== registration.schema.version) throw new Error(`Unsupported future schema version ${current.schemaVersion}.`);
    return current;
  }
}

function assertJsonCompatible(value, label) {
  if (value === undefined) return;
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("not serializable");
  } catch (error) {
    throw new Error(`${label} must be JSON-serializable.`, { cause: error });
  }
}

function dependencyClosure(entries, selection) {
  if (selection == null) return [...entries];
  const requested = new Set(selection instanceof Set ? selection : selection);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...requested]) {
      const entry = byId.get(id);
      if (!entry) throw new Error(`Unknown schema selection: ${id}`);
      for (const dependency of entry.dependencies) if (!requested.has(dependency)) { requested.add(dependency); changed = true; }
    }
  }
  for (const entry of entries) if (entry.partial === false) requested.add(entry.id);
  return entries.filter((entry) => requested.has(entry.id));
}

async function classifyState({ live, incoming, baseline, codec, baselineDescriptor, autoImportWhenLiveIsBaseline = true }) {
  if (codec === "binary") {
    if (live === null || live === undefined) return "safe-import";
    if (bytesEqual(live, incoming)) return "same";
    if (baselineDescriptor?.sha256 && await sha256(live) === baselineDescriptor.sha256) return autoImportWhenLiveIsBaseline ? "safe-import" : "conflict";
    return "conflict";
  }
  if (canonicalJson(live) === canonicalJson(incoming)) return "same";
  if (live === null || live === undefined) return "safe-import";
  if (baseline !== undefined && canonicalJson(live) === canonicalJson(baseline)) return autoImportWhenLiveIsBaseline ? "safe-import" : "conflict";
  return "conflict";
}

function defaultResolution(schema, state, configuredPolicy = "ask") {
  if (state === "same") return "keep";
  if (state === "safe-import") return "import";
  if (configuredPolicy !== "ask" && schema.conflict.allowed.includes(configuredPolicy)) return configuredPolicy;
  return schema.conflict.allowed.length === 1 ? schema.conflict.allowed[0] : null;
}

function summarize(value) {
  if (value instanceof Uint8Array) return `${value.length} bytes`;
  const text = canonicalJson(value);
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

function changeRecord(item, action, result = undefined) {
  return {
    entryId: item.schema.id,
    label: item.schema.label,
    category: item.schema.category,
    path: item.schema.zipPath,
    state: item.state,
    action,
    live: summarize(item.live),
    incoming: summarize(item.incoming),
    result
  };
}
