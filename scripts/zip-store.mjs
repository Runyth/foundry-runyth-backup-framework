// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Runyth. See the LICENSE file for rights and obligations.
import { crc32 } from "./integrity.mjs";
import { asUint8Array, assert, safeArchivePath, utf8Decode, utf8Encode } from "./util.mjs";

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const EOCD = 0x06054b50;
const UTF8_FLAG = 0x0800;
const METHOD_STORE = 0;

function u16(view, offset, value) { view.setUint16(offset, value, true); }
function u32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

export function createStoreZip(entries) {
  const normalized = entries.map(({ path, data }) => ({ path: safeArchivePath(path), data: asUint8Array(data) }));
  assert(normalized.length <= 0xfffe, "ZIP32 archive has too many entries.");
  const names = new Set();
  for (const entry of normalized) {
    assert(!names.has(entry.path), `Duplicate ZIP entry path: ${entry.path}`);
    names.add(entry.path);
    assert(entry.data.byteLength <= 0xffffffff, `ZIP32 entry exceeds 4 GiB: ${entry.path}`);
  }

  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of normalized) {
    const name = utf8Encode(entry.path);
    const crc = crc32(entry.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    u32(lv, 0, LOCAL); u16(lv, 4, 20); u16(lv, 6, UTF8_FLAG); u16(lv, 8, METHOD_STORE);
    u16(lv, 10, 0); u16(lv, 12, 0); u32(lv, 14, crc); u32(lv, 18, entry.data.length); u32(lv, 22, entry.data.length);
    u16(lv, 26, name.length); u16(lv, 28, 0); local.set(name, 30);
    localParts.push(local, entry.data);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    u32(cv, 0, CENTRAL); u16(cv, 4, 20); u16(cv, 6, 20); u16(cv, 8, UTF8_FLAG); u16(cv, 10, METHOD_STORE);
    u16(cv, 12, 0); u16(cv, 14, 0); u32(cv, 16, crc); u32(cv, 20, entry.data.length); u32(cv, 24, entry.data.length);
    u16(cv, 28, name.length); u16(cv, 30, 0); u16(cv, 32, 0); u16(cv, 34, 0); u16(cv, 36, 0); u32(cv, 38, 0); u32(cv, 42, offset);
    central.set(name, 46);
    centralParts.push(central);
    offset += local.length + entry.data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, EOCD); u16(ev, 4, 0); u16(ev, 6, 0); u16(ev, 8, normalized.length); u16(ev, 10, normalized.length);
  u32(ev, 12, centralSize); u32(ev, 16, offset); u16(ev, 20, 0);

  const total = offset + centralSize + end.length;
  assert(total <= 0xffffffff, "ZIP32 archive exceeds 4 GiB.");
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of localParts) { out.set(part, cursor); cursor += part.length; }
  for (const part of centralParts) { out.set(part, cursor); cursor += part.length; }
  out.set(end, cursor);
  return out;
}

function findEocd(bytes) {
  const min = Math.max(0, bytes.length - 22 - 0xffff);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.length - 22; offset >= min; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD) return offset;
  }
  throw new Error("ZIP end-of-central-directory record not found.");
}

export function parseStoreZip(input, limits = {}) {
  const bytes = asUint8Array(input);
  const maxArchiveBytes = limits.maxArchiveBytes ?? 256 * 1024 * 1024;
  const maxEntryBytes = limits.maxEntryBytes ?? 64 * 1024 * 1024;
  const maxEntries = limits.maxEntries ?? 4096;
  assert(bytes.length <= maxArchiveBytes, `Archive exceeds configured limit of ${maxArchiveBytes} bytes.`);

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(bytes);
  const disk = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const countDisk = view.getUint16(eocd + 8, true);
  const count = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  const commentLength = view.getUint16(eocd + 20, true);
  assert(disk === 0 && centralDisk === 0 && countDisk === count, "Multi-disk ZIP archives are unsupported.");
  assert(count !== 0xffff && centralSize !== 0xffffffff && centralOffset !== 0xffffffff, "ZIP64 archives are unsupported.");
  assert(count <= maxEntries, `Archive exceeds configured entry limit of ${maxEntries}.`);
  assert(eocd + 22 + commentLength === bytes.length, "Trailing data or malformed ZIP comment is forbidden.");
  assert(centralOffset + centralSize === eocd, "Central directory layout is non-canonical or lies outside the archive.");

  const entries = new Map();
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    assert(cursor + 46 <= eocd, `Truncated central directory entry at offset ${cursor}.`);
    assert(view.getUint32(cursor, true) === CENTRAL, `Invalid central directory entry at offset ${cursor}.`);
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const compressed = view.getUint32(cursor + 20, true);
    const uncompressed = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    assert((flags & 0x0001) === 0, "Encrypted ZIP entries are unsupported.");
    assert((flags & ~UTF8_FLAG) === 0, "Unsupported ZIP entry flags are present.");
    assert((flags & UTF8_FLAG) !== 0, "Framework ZIP entry paths must use UTF-8 encoding.");
    assert(method === METHOD_STORE, "Only STORE-method ZIP entries created by this framework are accepted.");
    assert(compressed === uncompressed, "STORE-method ZIP entry size mismatch.");
    assert(uncompressed <= maxEntryBytes, `ZIP entry exceeds configured limit of ${maxEntryBytes} bytes.`);
    assert(cursor + 46 + nameLength + extraLength + commentLength <= eocd, "Central directory entry exceeds directory bounds.");
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = safeArchivePath(utf8Decode(nameBytes));
    assert(!entries.has(name), `Duplicate ZIP entry path: ${name}`);
    assert(localOffset + 30 <= centralOffset, `Invalid local header offset for ${name}.`);
    assert(view.getUint32(localOffset, true) === LOCAL, `Invalid local header for ${name}.`);
    const localFlags = view.getUint16(localOffset + 6, true);
    const localMethod = view.getUint16(localOffset + 8, true);
    const localCrc = view.getUint32(localOffset + 14, true);
    const localCompressed = view.getUint32(localOffset + 18, true);
    const localUncompressed = view.getUint32(localOffset + 22, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    assert(localFlags === flags && localMethod === method, `Local/central ZIP metadata mismatch for ${name}.`);
    assert(localCrc === crc && localCompressed === compressed && localUncompressed === uncompressed, `Local/central ZIP size or CRC mismatch for ${name}.`);
    assert(localOffset + 30 + localNameLength + localExtraLength <= centralOffset, `Local header exceeds data region for ${name}.`);
    const localName = safeArchivePath(utf8Decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength)));
    assert(localName === name, `Local/central ZIP path mismatch for ${name}.`);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    assert(dataOffset + compressed <= centralOffset, `ZIP entry exceeds data region: ${name}`);
    const data = bytes.slice(dataOffset, dataOffset + compressed);
    assert(crc32(data) === crc, `CRC-32 mismatch for ZIP entry: ${name}`);
    entries.set(name, data);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  assert(cursor === centralOffset + centralSize, "Central directory size mismatch.");
  return entries;
}
