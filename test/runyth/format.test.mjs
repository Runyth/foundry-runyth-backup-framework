// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { formatRepository } from "../../tools/format.mjs";
import { stableJson } from "../../tools/lib/text.mjs";

async function fixture(name, files, config = null) {
  const root = await mkdtemp(path.join(tmpdir(), `runyth-format-${name}-`));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  if (config) await writeFile(path.join(root, "runyth.config.json"), stableJson(config));
  return root;
}

test("formatRepository reports trailing whitespace in ordinary text files", async (t) => {
  const root = await fixture("plain", { "scripts/main.js": "const value = 1;   \n" });
  t.after(() => rm(root, { recursive: true, force: true }));
  const failures = await formatRepository({ root, write: false });
  assert.deepEqual(failures, ["scripts/main.js"]);
});

test("formatRepository honors format.exclude selectors from runyth.config.json", async (t) => {
  const root = await fixture(
    "excluded",
    { "runtime/graph.json": "{ \"b\": 1, \"a\": 2 }\n", "scripts/main.js": "const value = 1;\n" },
    { schemaVersion: 1, format: { exclude: ["runtime/**"] } },
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const failures = await formatRepository({ root, write: false });
  assert.deepEqual(failures, []);
  assert.equal(await readFile(path.join(root, "runtime/graph.json"), "utf8"), "{ \"b\": 1, \"a\": 2 }\n");
});

test("formatRepository writes normalized content when requested", async (t) => {
  const root = await fixture("write", { "scripts/main.js": "const value = 1;   \n" });
  t.after(() => rm(root, { recursive: true, force: true }));
  const failures = await formatRepository({ root, write: true });
  assert.deepEqual(failures, []);
  assert.equal(await readFile(path.join(root, "scripts/main.js"), "utf8"), "const value = 1;\n");
});
