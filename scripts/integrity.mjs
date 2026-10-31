// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Runyth. See the LICENSE file for rights and obligations.
import { asUint8Array, canonicalJson, utf8Encode } from "./util.mjs";

export async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", asUint8Array(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function digestObject(value) {
  return sha256(utf8Encode(canonicalJson(value)));
}

let crcTable;
function buildCrcTable() {
  return Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    return c >>> 0;
  });
}

export function crc32(bytes) {
  crcTable ??= buildCrcTable();
  let crc = 0xffffffff;
  for (const byte of asUint8Array(bytes)) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
