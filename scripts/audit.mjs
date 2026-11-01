// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import { AUDIT_FORMAT_ID, AUDIT_FORMAT_VERSION, MODULE_ID } from "./constants.mjs";
import { digestObject } from "./integrity.mjs";
import { selectRetained } from "./retention.mjs";
import { canonicalJson, utf8Decode, utf8Encode } from "./util.mjs";

const STORE_PREFIX = "audit-store";

export class AuditStore {
  constructor(compat) { this.compat = compat; }

  storePath() {
    const world = String(this.compat.worldId()).replace(/[^A-Za-z0-9._-]/g, "_");
    return `${STORE_PREFIX}-${world}.json`;
  }

  async load() {
    try {
      const parsed = JSON.parse(utf8Decode(await this.compat.readPersistent(this.storePath())));
      if (parsed.format !== AUDIT_FORMAT_ID || parsed.version !== AUDIT_FORMAT_VERSION) throw new Error("Unsupported audit store format.");
      return parsed;
    } catch (error) {
      if (String(error).includes("HTTP 404")) return this.#empty();
      throw error;
    }
  }

  #empty() {
    return { format: AUDIT_FORMAT_ID, version: AUDIT_FORMAT_VERSION, worldId: this.compat.worldId(), entries: [], digest: null };
  }

  async #seal(store) {
    const unsigned = { ...store, digest: null };
    store.digest = await digestObject(unsigned);
    return store;
  }

  async verify(store = null) {
    const value = store ?? await this.load();
    const expected = await digestObject({ ...value, digest: null });
    let previousHash = null;
    const entryFailures = [];
    for (const entry of value.entries) {
      if ((entry.previousHash ?? null) !== previousHash) entryFailures.push({ id: entry.id, reason: "chain" });
      const hash = await digestObject({ ...entry, hash: undefined });
      if (hash !== entry.hash) entryFailures.push({ id: entry.id, reason: "hash" });
      previousHash = entry.hash;
    }
    const storeValid = expected === value.digest || (value.entries.length === 0 && value.digest === null);
    return { valid: storeValid && entryFailures.length === 0, expected, actual: value.digest, entryFailures };
  }

  async append(record) {
    const store = await this.load();
    const previousHash = store.entries.at(-1)?.hash ?? null;
    const entry = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), previousHash, ...record };
    entry.hash = await digestObject({ ...entry, hash: undefined });
    store.entries.push(entry);
    await this.#save(await this.#seal(store));
    return entry;
  }

  async prune(policyText) {
    const store = await this.load();
    const before = store.entries.length;
    store.entries = selectRetained(store.entries, policyText)
      .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
    await this.#rechain(store.entries);
    const retained = store.entries.length;
    const removed = before - retained;

    const maintenance = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      previousHash: store.entries.at(-1)?.hash ?? null,
      moduleId: MODULE_ID,
      operation: "audit-prune",
      status: "success",
      retentionPolicy: policyText,
      removed,
      changes: []
    };
    maintenance.hash = await digestObject({ ...maintenance, hash: undefined });
    store.entries.push(maintenance);

    await this.#save(await this.#seal(store));
    return { before, after: store.entries.length, removed, maintenance };
  }

  async #rechain(entries) {
    let previousHash = null;
    for (const entry of entries) {
      entry.previousHash = previousHash;
      entry.hash = await digestObject({ ...entry, hash: undefined });
      previousHash = entry.hash;
    }
  }

  async #save(store) {
    await this.compat.uploadPersistent(this.storePath(), utf8Encode(JSON.stringify(store, null, 2)), "application/json");
  }

  async downloadEntry(id) {
    const store = await this.load();
    const entry = store.entries.find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`Audit log not found: ${id}`);
    const safeTime = entry.timestamp.replaceAll(":", "-");
    this.compat.saveText(`${canonicalJson(entry)}\n`, "application/json", `runyth-backup-framework-audit-${safeTime}-${entry.moduleId ?? "framework"}.json`);
  }
}
