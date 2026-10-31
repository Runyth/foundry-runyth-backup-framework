// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Runyth. See the LICENSE file for rights and obligations.
import assert from "node:assert/strict";
import test from "node:test";

import { AuditStore } from "../scripts/audit.mjs";
import { BackupEngine } from "../scripts/engine.mjs";
import { crc32, sha256 } from "../scripts/integrity.mjs";
import { mergeValues } from "../scripts/merge.mjs";
import { expandEntries, RegistrationRegistry } from "../scripts/registry.mjs";
import { parseRetentionPolicy, selectRetained } from "../scripts/retention.mjs";
import { utf8Decode, utf8Encode } from "../scripts/util.mjs";
import { createStoreZip, parseStoreZip } from "../scripts/zip-store.mjs";

const settings = (values = {}) => ({
  get(key) {
    const defaults = {
      maxArchiveMiB: 32,
      maxEntryMiB: 8,
      maxEntries: 1024,
      concurrentReads: 4,
      defaultConflictPolicy: "ask",
      confirmWrites: false
    };
    return values[key] ?? defaults[key];
  }
});

test("ZIP32 STORE round-trips deterministic entries", () => {
  const zip = createStoreZip([
    { path: "alpha.txt", data: utf8Encode("alpha") },
    { path: "nested/beta.json", data: utf8Encode('{"beta":true}') }
  ]);
  const parsed = parseStoreZip(zip);
  assert.equal(utf8Decode(parsed.get("alpha.txt")), "alpha");
  assert.equal(utf8Decode(parsed.get("nested/beta.json")), '{"beta":true}');
  assert.equal(crc32(utf8Encode("123456789")), 0xcbf43926);
});

test("ZIP parser rejects path traversal and trailing data", () => {
  assert.throws(() => createStoreZip([{ path: "../escape.txt", data: utf8Encode("x") }]), /Unsafe archive path/);
  const zip = createStoreZip([{ path: "ok.txt", data: utf8Encode("ok") }]);
  const tainted = new Uint8Array(zip.length + 1);
  tainted.set(zip);
  tainted[tainted.length - 1] = 1;
  assert.throws(() => parseStoreZip(tainted), /Trailing data|end-of-central-directory/);
});

test("retention parser and tiering keep newest sample per bucket", () => {
  const policy = "0-7d=all;8-30d=daily;31-180d=weekly;181-730d=monthly;>730d=yearly";
  assert.equal(parseRetentionPolicy(policy).length, 5);
  const now = new Date("2026-08-09T12:00:00Z");
  const entries = [
    { id: "recent", timestamp: "2026-08-09T10:00:00Z" },
    { id: "day-new", timestamp: "2026-07-20T11:00:00Z" },
    { id: "day-old", timestamp: "2026-07-20T09:00:00Z" },
    { id: "week", timestamp: "2026-06-10T10:00:00Z" }
  ];
  const retained = selectRetained(entries, policy, now).map((entry) => entry.id);
  assert.deepEqual(retained, ["recent", "day-new", "week"]);
});

test("registry validates conflicts and dependencies", async () => {
  const registry = new RegistrationRegistry();
  registry.register({
    moduleId: "example-module",
    moduleVersion: "1.2.3",
    capabilities: ["backup", "import"],
    schema: {
      id: "example",
      version: 1,
      entries: [
        { id: "base", codec: "json", driver: { type: "custom", read: async () => ({}), apply: async () => {} } },
        { id: "child", dependencies: ["base"], conflict: { allowed: ["keep", "merge", "import"], merge: "deep-object" }, driver: { type: "custom", read: async () => ({}), apply: async () => {} } }
      ]
    }
  });
  assert.equal(registry.list().length, 1);
  const invalid = registry.register({
    moduleId: "bad-module",
    schema: { entries: [{ id: "x", dependencies: ["missing"], driver: { type: "custom" } }] }
  });
  await assert.rejects(() => expandEntries(invalid), /depends on unknown entry/i);
});

test("merge strategies are deterministic", () => {
  assert.deepEqual(mergeValues("deep-object", { a: { x: 1 }, keep: true }, { a: { y: 2 } }), { a: { x: 1, y: 2 }, keep: true });
  assert.deepEqual(mergeValues("union-by-id", [{ id: "a", v: 1 }], [{ id: "a", v: 2 }, { id: "b", v: 3 }]), [{ id: "a", v: 2 }, { id: "b", v: 3 }]);
});

test("audit store seals, chains, verifies and detects tampering", async () => {
  const files = new Map();
  const compat = {
    worldId: () => "test-world",
    async readPersistent(path) {
      if (!files.has(path)) throw new Error("Failed to read: HTTP 404");
      return files.get(path);
    },
    async uploadPersistent(path, bytes) { files.set(path, new Uint8Array(bytes)); },
    saveText() {}
  };
  const audit = new AuditStore(compat);
  await audit.append({ moduleId: "example", operation: "import", status: "success", changes: [] });
  await audit.append({ moduleId: "example", operation: "import", status: "success", changes: [] });
  assert.equal((await audit.verify()).valid, true);
  const store = await audit.load();
  store.entries[0].status = "tampered";
  assert.equal((await audit.verify(store)).valid, false);
});

test("engine creates, verifies, imports and resolves a live conflict", async () => {
  let live = { answer: 42 };
  const baseline = { answer: 42 };
  const registry = new RegistrationRegistry();
  registry.register({
    moduleId: "example-module",
    title: "Example Module",
    moduleVersion: "1.0.0",
    capabilities: ["backup", "import", "export"],
    schema: {
      id: "example-schema",
      version: 1,
      entries: [{
        id: "state",
        label: "State",
        category: ["Data"],
        driver: { type: "custom" },
        conflict: { allowed: ["keep", "merge", "import"], merge: "deep-object" }
      }]
    }
  });
  const drivers = {
    create() {
      return {
        exists: async () => true,
        read: async () => structuredClone(live),
        baseline: async () => structuredClone(baseline),
        snapshot: async () => structuredClone(live),
        apply: async (value) => { live = structuredClone(value); },
        rollback: async (value) => { live = structuredClone(value); }
      };
    }
  };
  const compat = {
    foundryVersion: () => "13.350",
    worldId: () => "world",
    userId: () => "gm",
    confirm: async () => true,
    saveFile() {}
  };
  const audits = [];
  const audit = { append: async (entry) => (audits.push(entry), entry) };
  const engine = new BackupEngine({ registry, drivers, audit, compat, settings: settings() });

  const created = await engine.createArchive("example-module", { save: false });
  assert.match(created.filename, /^example-module-backup-1\.0\.0-/);
  assert.equal(await sha256(created.bytes), await sha256(created.bytes));

  live = { answer: 7 };
  const inspection = await engine.inspectArchive(created.bytes);
  const plan = await engine.prepareImport(inspection);
  assert.equal(plan.conflicts.length, 1);
  engine.setResolution(plan, "state", "import");
  const result = await engine.executeImport(plan);
  assert.equal(result.success, true);
  assert.deepEqual(live, { answer: 42 });
  assert.equal(audits.at(-1).status, "success");
});

test("engine rolls back prior writes when a later entry fails", async () => {
  const live = { first: 1, second: 2 };
  const registry = new RegistrationRegistry();
  registry.register({
    moduleId: "rollback-module",
    moduleVersion: "1.0.0",
    capabilities: ["backup", "import"],
    schema: {
      id: "rollback-schema",
      version: 1,
      entries: ["first", "second"].map((id) => ({ id, driver: { type: "custom" }, conflict: { allowed: ["import"] } }))
    }
  });
  const makeDriver = (entry) => ({
    exists: async () => true,
    read: async () => live[entry.id],
    baseline: async () => 0,
    snapshot: async () => live[entry.id],
    apply: async (value) => {
      if (entry.id === "second" && value === 2) throw new Error("synthetic failure");
      live[entry.id] = value;
    },
    rollback: async (snapshot) => { live[entry.id] = snapshot; }
  });
  const compat = { foundryVersion: () => "13.350", worldId: () => "world", userId: () => "gm", confirm: async () => true, saveFile() {} };
  const auditEntries = [];
  const engine = new BackupEngine({ registry, drivers: { create: makeDriver }, audit: { append: async (v) => (auditEntries.push(v), v) }, compat, settings: settings() });
  const archive = await engine.createArchive("rollback-module", { save: false });
  live.first = 9;
  live.second = 9;
  const plan = await engine.prepareImport(await engine.inspectArchive(archive.bytes));
  await assert.rejects(() => engine.executeImport(plan), /synthetic failure/);
  assert.deepEqual(live, { first: 9, second: 9 });
  assert.equal(auditEntries.at(-1).status, "failed-rolled-back");
});

test("schema entries can participate in different backup/import/export operations", async () => {
  const registry = new RegistrationRegistry();
  const registration = registry.register({
    moduleId: "operation-module",
    moduleVersion: "1.0.0",
    capabilities: ["backup", "import", "export"],
    schema: {
      id: "operation-schema",
      version: 1,
      entries: [
        { id: "backup-import", operations: ["backup", "import"], driver: { type: "custom", read: async () => ({}), apply: async () => {} } },
        { id: "export-only", operations: ["export"], driver: { type: "custom", read: async () => ({}), apply: async () => {} } }
      ]
    }
  });
  assert.deepEqual((await expandEntries(registration, { operation: "backup" })).map((entry) => entry.id), ["backup-import"]);
  assert.deepEqual((await expandEntries(registration, { operation: "import" })).map((entry) => entry.id), ["backup-import"]);
  assert.deepEqual((await expandEntries(registration, { operation: "export" })).map((entry) => entry.id), ["export-only"]);
});

test("import snapshot preflight prevents all writes when a later snapshot fails", async () => {
  const live = { first: 1, second: 2 };
  let failSnapshots = false;
  let applyCount = 0;
  const registry = new RegistrationRegistry();
  registry.register({
    moduleId: "preflight-module",
    moduleVersion: "1.0.0",
    capabilities: ["backup", "import"],
    schema: {
      id: "preflight-schema",
      version: 1,
      entries: ["first", "second"].map((id) => ({ id, driver: { type: "custom" }, conflict: { allowed: ["import"] } }))
    }
  });
  const drivers = {
    create(entry) {
      return {
        exists: async () => true,
        read: async () => live[entry.id],
        baseline: async () => 0,
        snapshot: async () => {
          if (failSnapshots && entry.id === "second") throw new Error("snapshot failure");
          return live[entry.id];
        },
        apply: async (value) => { applyCount += 1; live[entry.id] = value; },
        rollback: async (snapshot) => { live[entry.id] = snapshot; }
      };
    }
  };
  const compat = { foundryVersion: () => "13.350", worldId: () => "world", userId: () => "gm", confirm: async () => true, saveFile() {} };
  const audits = [];
  const engine = new BackupEngine({ registry, drivers, audit: { append: async (entry) => (audits.push(entry), entry) }, compat, settings: settings() });
  const archive = await engine.createArchive("preflight-module", { save: false });
  live.first = 9;
  live.second = 9;
  failSnapshots = true;
  const plan = await engine.prepareImport(await engine.inspectArchive(archive.bytes));
  await assert.rejects(() => engine.executeImport(plan), /snapshot failure/);
  assert.equal(applyCount, 0);
  assert.deepEqual(live, { first: 9, second: 9 });
  assert.equal(audits.at(-1).status, "failed-rolled-back");
});

test("audit pruning records its own maintenance event and preserves integrity", async () => {
  const files = new Map();
  const compat = {
    worldId: () => "prune-world",
    async readPersistent(path) {
      if (!files.has(path)) throw new Error("Failed to read: HTTP 404");
      return files.get(path);
    },
    async uploadPersistent(path, bytes) { files.set(path, new Uint8Array(bytes)); },
    saveText() {}
  };
  const audit = new AuditStore(compat);
  await audit.append({ moduleId: "example", operation: "import", status: "success", changes: [] });
  const result = await audit.prune("0-99999d=all");
  assert.equal(result.removed, 0);
  const store = await audit.load();
  assert.equal(store.entries.at(-1).operation, "audit-prune");
  assert.equal((await audit.verify(store)).valid, true);
});

test("ten-module backup set restores into a fresh instance-equivalent registry", async () => {
  const createRegistry = () => {
    const registry = new RegistrationRegistry();
    for (let index = 0; index < 10; index += 1) {
      const moduleId = `bulk-module-${index}`;
      registry.register({
        moduleId,
        moduleVersion: "1.0.0",
        capabilities: ["backup", "import"],
        schema: {
          id: `${moduleId}-schema`,
          version: 1,
          entries: [{ id: "state", driver: { type: "custom", key: moduleId }, conflict: { allowed: ["import"] } }]
        }
      });
    }
    return registry;
  };

  const oldLive = new Map(Array.from({ length: 10 }, (_, index) => [`bulk-module-${index}`, { value: index }]));
  const newLive = new Map(Array.from({ length: 10 }, (_, index) => [`bulk-module-${index}`, { value: -1 }]));
  const makeDrivers = (live) => ({
    create(entry) {
      const key = entry.driver.key;
      return {
        exists: async () => true,
        read: async () => structuredClone(live.get(key)),
        baseline: async () => ({ value: -1 }),
        snapshot: async () => structuredClone(live.get(key)),
        apply: async (value) => { live.set(key, structuredClone(value)); },
        rollback: async (snapshot) => { live.set(key, structuredClone(snapshot)); }
      };
    }
  });
  const compat = { foundryVersion: () => "13.350", worldId: () => "world", userId: () => "gm", confirm: async () => true, saveFile() {} };
  const audit = { append: async (entry) => entry };
  const oldEngine = new BackupEngine({ registry: createRegistry(), drivers: makeDrivers(oldLive), audit, compat, settings: settings() });
  const archives = [];
  for (let index = 0; index < 10; index += 1) archives.push(await oldEngine.createArchive(`bulk-module-${index}`, { save: false }));

  const newEngine = new BackupEngine({ registry: createRegistry(), drivers: makeDrivers(newLive), audit, compat, settings: settings() });
  for (const archive of archives) {
    const plan = await newEngine.prepareImport(await newEngine.inspectArchive(archive.bytes));
    await newEngine.executeImport(plan);
  }
  assert.deepEqual([...newLive.values()], [...oldLive.values()]);
});
