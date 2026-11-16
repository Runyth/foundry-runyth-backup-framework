// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readJson } from "../../tools/lib/project.mjs";

test("template identity and version are internally consistent", async () => {
  const manifest = await readJson("module.json");
  const packageJson = await readJson("package.json");
  const config = await readJson("runyth.config.json");
  assert.equal(manifest.version, packageJson.version);
  assert.equal(typeof config.template.source, "boolean");
  if (config.template.source) {
    assert.equal(config.template.version, manifest.version);
  } else {
    assert.match(config.template.version, /^\d+\.\d+\.\d+$/u);
  }
});

test("template synchronization targets the canonical template", async () => {
  const config = await readJson("runyth.config.json");
  assert.equal(config.template.repository, "Runyth/template-foundry-module");
  const workflow = await readFile(new URL("../../.github/workflows/template-sync.yml", import.meta.url), "utf8");
  assert.match(workflow, /github\.repository != 'Runyth\/template-foundry-module'/u);
  assert.match(workflow, /ref: master/u);
  assert.doesNotMatch(workflow, /pull-requests:\s*write/u);
  assert.doesNotMatch(workflow, /gh pr create/u);
});
