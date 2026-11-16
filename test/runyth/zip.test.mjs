// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeDeterministicZip, readZipEntries } from "../../tools/lib/zip.mjs";

test("ZIP output is deterministic and readable", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "runyth-zip-"));
  try {
    const first = path.join(directory, "first.zip");
    const second = path.join(directory, "second.zip");
    const entries = [
      { name: "module/module.json", content: Buffer.from("{}\n") },
      { name: "module/scripts/main.js", content: Buffer.from("export {};\n") }
    ];
    await writeDeterministicZip(first, entries);
    await writeDeterministicZip(second, [...entries].reverse());
    assert.deepEqual(await readFile(first), await readFile(second));
    const parsed = await readZipEntries(first);
    assert.equal(parsed.get("module/module.json").toString("utf8"), "{}\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
