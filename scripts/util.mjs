// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Runyth. See the LICENSE file for rights and obligations.
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function utf8Encode(value) {
  return encoder.encode(String(value));
}

export function utf8Decode(bytes) {
  return decoder.decode(bytes);
}

export function asUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError("Expected binary data as Uint8Array, ArrayBuffer or ArrayBuffer view.");
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object" && !(value instanceof Uint8Array)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function deepClone(value) {
  return globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function getPath(object, path) {
  if (!path) return object;
  return String(path).split(".").reduce((value, key) => value?.[key], object);
}

export function setPath(object, path, value) {
  const keys = String(path).split(".");
  let cursor = object;
  for (const key of keys.slice(0, -1)) cursor = cursor[key] ??= {};
  cursor[keys.at(-1)] = value;
  return object;
}

export function normalizeCategory(category) {
  if (Array.isArray(category)) return category.map(String).filter(Boolean);
  if (!category) return [];
  return String(category).split("/").map((part) => part.trim()).filter(Boolean);
}

export function safeArchivePath(path) {
  const value = String(path).replaceAll("\\", "/");
  assert(value.length > 0, "Archive entry path must not be empty.");
  assert(!value.startsWith("/"), `Absolute archive path is forbidden: ${value}`);
  assert(!/^[A-Za-z]:\//.test(value), `Drive-qualified archive path is forbidden: ${value}`);
  const parts = value.split("/");
  assert(parts.every((part) => part && part !== "." && part !== ".."), `Unsafe archive path: ${value}`);
  assert(!value.includes("\0"), "NUL bytes are forbidden in archive paths.");
  return value;
}

export function bytesEqual(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return false;
  return true;
}

export function semverLike(value) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(String(value));
}

export function compactTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function humanBytes(bytes) {
  const value = Number(bytes);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 ** 2).toFixed(1)} MiB`;
}

export async function mapLimit(items, limit, worker) {
  const result = new Array(items.length);
  let cursor = 0;
  const count = Math.max(1, Math.min(Number(limit) || 1, items.length || 1));
  const runners = Array.from({ length: count }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      result[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return result;
}
