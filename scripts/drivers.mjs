// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import { asUint8Array, deepClone, getPath, setPath, utf8Decode, utf8Encode } from "./util.mjs";

export class DriverRegistry {
  constructor(compat) {
    this.compat = compat;
    this.factories = new Map();
    this.registerBuiltIns();
  }

  register(type, factory) {
    if (this.factories.has(type)) throw new Error(`Driver type already registered: ${type}`);
    this.factories.set(type, factory);
  }

  create(entry) {
    const factory = this.factories.get(entry.driver.type);
    if (!factory) throw new Error(`Unknown schema driver type: ${entry.driver.type}`);
    return factory(entry, this.compat);
  }

  registerBuiltIns() {
    this.register("setting", settingDriver);
    this.register("document", documentDriver);
    this.register("document-fields", documentFieldsDriver);
    this.register("file", fileDriver);
    this.register("json-file", jsonFileDriver);
    this.register("custom", customDriver);
  }
}

function settingDriver(entry, compat) {
  const { namespace, key, path } = entry.driver;
  return {
    async exists() { return compat.hasSetting(namespace, key); },
    async read() {
      const value = deepClone(compat.getSetting(namespace, key));
      return path ? deepClone(getPath(value, path)) : value;
    },
    async baseline() {
      const config = compat.getSettingConfig(namespace, key);
      const value = deepClone(config?.default);
      return path ? deepClone(getPath(value, path)) : value;
    },
    async snapshot() { return deepClone(compat.getSetting(namespace, key)); },
    async apply(value) {
      if (!path) return compat.setSetting(namespace, key, deepClone(value));
      const container = deepClone(compat.getSetting(namespace, key));
      setPath(container, path, deepClone(value));
      return compat.setSetting(namespace, key, container);
    },
    async rollback(snapshot) { return compat.setSetting(namespace, key, deepClone(snapshot)); }
  };
}

function documentDriver(entry, compat) {
  const { uuid, path } = entry.driver;
  async function resolve() {
    const document = await compat.fromUuid(uuid);
    if (!document) throw new Error(`Document not found: ${uuid}`);
    return document;
  }
  return {
    async exists() { return Boolean(await compat.fromUuid(uuid)); },
    async read() {
      const document = await resolve();
      const data = document.toObject();
      return path ? deepClone(getPath(data, path)) : data;
    },
    async baseline() { return entry.driver.baseline === undefined ? undefined : deepClone(entry.driver.baseline); },
    async snapshot() { return (await resolve()).toObject(); },
    async apply(value) {
      const document = await resolve();
      if (!path) return document.update(deepClone(value));
      return document.update({ [path]: deepClone(value) });
    },
    async rollback(snapshot) { return (await resolve()).update(deepClone(snapshot)); }
  };
}

function documentFieldsDriver(entry, compat) {
  const { uuid, paths = [] } = entry.driver;
  if (!Array.isArray(paths) || paths.length === 0) throw new Error(`document-fields driver ${entry.id} requires a non-empty paths array.`);
  async function resolve() {
    const document = await compat.fromUuid(uuid);
    if (!document) throw new Error(`Document not found: ${uuid}`);
    return document;
  }
  async function readFields() {
    const source = (await resolve()).toObject();
    return Object.fromEntries(paths.map((path) => [path, deepClone(getPath(source, path))]));
  }
  return {
    async exists() { return Boolean(await compat.fromUuid(uuid)); },
    read: readFields,
    async baseline() {
      const baseline = entry.driver.baseline;
      if (baseline === undefined) return undefined;
      return deepClone(baseline);
    },
    snapshot: readFields,
    async apply(value) {
      const document = await resolve();
      const update = {};
      for (const path of paths) {
        if (!(path in value)) throw new Error(`document-fields value is missing declared path ${path}.`);
        update[path] = deepClone(value[path]);
      }
      return document.update(update);
    },
    async rollback(snapshot) {
      const document = await resolve();
      const update = {};
      for (const path of paths) update[path] = deepClone(snapshot[path]);
      return document.update(update);
    }
  };
}

function fileDriver(entry, compat) {
  let relocatedPath = null;
  let relocatedSnapshot = null;
  let createdOriginal = false;
  let lastSnapshot = null;
  const originalPath = entry.driver.path;
  const mime = entry.driver.mime ?? "application/octet-stream";
  const references = entry.driver.references ?? [];
  return {
    async exists() { return compat.sourceExists(originalPath); },
    async read() { return compat.sourceExists(originalPath) ? compat.readDataFile(originalPath) : null; },
    async baseline() {
      if (entry.driver.baselineSha256 || entry.driver.baselineMissing) return { sha256: entry.driver.baselineSha256 ?? null, missing: Boolean(entry.driver.baselineMissing) };
      return undefined;
    },
    async snapshot() {
      lastSnapshot = {
        file: (await compat.sourceExists(originalPath)) ? await compat.readDataFile(originalPath) : null,
        references: await snapshotReferences(references, compat)
      };
      return lastSnapshot;
    },
    async apply(value) {
      const bytes = asUint8Array(value);
      const existedBefore = await compat.sourceExists(originalPath);
      try {
        await compat.uploadDataFile(originalPath, bytes, mime);
        createdOriginal = !existedBefore;
        relocatedPath = null;
        relocatedSnapshot = null;
        return { path: originalPath, relocated: false, created: createdOriginal };
      } catch (error) {
        const existsAfterFailure = await compat.sourceExists(originalPath);
        if (existedBefore && lastSnapshot?.file && existsAfterFailure) {
          await compat.uploadDataFile(originalPath, lastSnapshot.file, mime);
        } else if (!existedBefore && existsAfterFailure) {
          createdOriginal = true;
          throw new Error(`Original-path upload failed after creating ${originalPath}; safe automatic cleanup is unavailable through the Foundry v13 public FilePicker API.`, { cause: error });
        }
        if (entry.driver.allowRelocation === false) throw error;
        const fallback = await compat.pickDirectory(entry.driver.fallbackDirectory ?? "");
        if (!fallback) throw new Error(`Asset import cancelled after original path failed: ${originalPath}`, { cause: error });
        const name = entry.driver.fallbackName ?? originalPath.split("/").at(-1);
        relocatedPath = `${fallback.replace(/\/$/, "")}/${name}`;
        const relocatedExisted = await compat.sourceExists(relocatedPath);
        relocatedSnapshot = relocatedExisted ? await compat.readDataFile(relocatedPath) : null;
        await compat.uploadDataFile(relocatedPath, bytes, mime);
        await applyReferences(references, relocatedPath, compat);
        return { path: relocatedPath, relocated: true, created: !relocatedExisted };
      }
    },
    async rollback(snapshot) {
      const residue = [];
      await restoreReferences(snapshot?.references ?? [], compat);
      if (relocatedPath) {
        if (relocatedSnapshot) await compat.uploadDataFile(relocatedPath, relocatedSnapshot, mime);
        else residue.push(relocatedPath);
      }
      if (snapshot?.file) await compat.uploadDataFile(originalPath, snapshot.file, mime);
      else if (createdOriginal) residue.push(originalPath);
      if (residue.length) {
        throw new Error(`Rollback restored state references but cannot delete newly-created file(s) through the Foundry v13 public FilePicker API: ${residue.join(", ")}`);
      }
    }
  };
}

async function snapshotReferences(references, compat) {
  const snapshots = [];
  for (const ref of references) {
    if (ref.type === "setting") {
      const container = deepClone(compat.getSetting(ref.namespace, ref.key));
      snapshots.push({ ref, value: deepClone(getPath(container, ref.path)) });
    } else if (ref.type === "document") {
      const document = await compat.fromUuid(ref.uuid);
      if (!document) throw new Error(`Relocation reference document not found: ${ref.uuid}`);
      snapshots.push({ ref, value: deepClone(getPath(document.toObject(), ref.path)) });
    } else if (typeof ref.read === "function") {
      snapshots.push({ ref, value: deepClone(await ref.read()) });
    } else if (typeof ref.apply === "function") {
      throw new Error("Custom relocation references must implement read() as well as apply() for safe rollback.");
    } else throw new Error(`Unsupported relocation reference type: ${ref.type}`);
  }
  return snapshots;
}

async function restoreReferences(snapshots, compat) {
  for (const { ref, value } of snapshots) {
    if (ref.type === "setting") {
      const container = deepClone(compat.getSetting(ref.namespace, ref.key));
      if (!ref.path) throw new Error("File relocation setting reference requires a path.");
      setPath(container, ref.path, deepClone(value));
      await compat.setSetting(ref.namespace, ref.key, container);
    } else if (ref.type === "document") {
      const document = await compat.fromUuid(ref.uuid);
      if (!document) throw new Error(`Relocation reference document not found: ${ref.uuid}`);
      await document.update({ [ref.path]: deepClone(value) });
    } else if (typeof ref.apply === "function") await ref.apply(deepClone(value));
  }
}

async function applyReferences(references, path, compat) {
  for (const ref of references) {
    if (ref.type === "setting") {
      const container = deepClone(compat.getSetting(ref.namespace, ref.key));
      if (ref.path) setPath(container, ref.path, path);
      else throw new Error("File relocation setting reference requires a path.");
      await compat.setSetting(ref.namespace, ref.key, container);
    } else if (ref.type === "document") {
      const document = await compat.fromUuid(ref.uuid);
      if (!document) throw new Error(`Relocation reference document not found: ${ref.uuid}`);
      await document.update({ [ref.path]: path });
    } else if (typeof ref.apply === "function") await ref.apply(path);
    else throw new Error(`Unsupported relocation reference type: ${ref.type}`);
  }
}

function jsonFileDriver(entry, compat) {
  const path = entry.driver.path;
  let created = false;
  return {
    async exists() { return compat.sourceExists(path); },
    async read() {
      if (!(await compat.sourceExists(path))) return null;
      return JSON.parse(utf8Decode(await compat.readDataFile(path)));
    },
    async baseline() { return entry.driver.baseline === undefined ? undefined : deepClone(entry.driver.baseline); },
    async snapshot() { return (await compat.sourceExists(path)) ? compat.readDataFile(path) : null; },
    async apply(value) {
      created = !(await compat.sourceExists(path));
      return compat.uploadDataFile(path, utf8Encode(JSON.stringify(value, null, 2)), "application/json");
    },
    async rollback(snapshot) {
      if (snapshot) return compat.uploadDataFile(path, snapshot, "application/json");
      if (created) throw new Error(`Rollback cannot delete newly-created file through Foundry v13 public FilePicker API: ${path}`);
    }
  };
}

function customDriver(entry) {
  const driver = entry.driver;
  for (const name of ["read", "apply"]) if (typeof driver[name] !== "function") throw new Error(`Custom driver ${entry.id} requires ${name}().`);
  return {
    exists: driver.exists ?? (async () => true),
    read: driver.read,
    baseline: driver.baseline ?? (async () => undefined),
    snapshot: driver.snapshot ?? driver.read,
    apply: driver.apply,
    rollback: driver.rollback ?? (async () => { throw new Error(`Custom driver ${entry.id} does not implement rollback().`); })
  };
}

export function encodeValue(codec, value) {
  if (codec === "binary") return asUint8Array(value);
  if (codec === "text") return utf8Encode(value ?? "");
  return utf8Encode(JSON.stringify(value));
}

export function decodeValue(codec, bytes) {
  if (codec === "binary") return asUint8Array(bytes);
  if (codec === "text") return utf8Decode(bytes);
  return JSON.parse(utf8Decode(bytes));
}
