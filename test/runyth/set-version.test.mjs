// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

async function fixture(source) {
  const root = await mkdtemp(path.join(tmpdir(), "runyth-version-"));
  await mkdir(path.join(root, "tools/lib"), { recursive: true });
  for (const file of ["tools/set-version.mjs", "tools/lib/project.mjs", "tools/lib/text.mjs"]) {
    await cp(new URL(`../../${file}`, import.meta.url), path.join(root, file));
  }
  await writeFile(path.join(root, "module.json"), JSON.stringify({
    id: "demo",
    url: "https://github.com/Runyth/demo",
    version: "1.0.0",
    download: "https://example.invalid/old.zip",
  }));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "demo", version: "1.0.0" }));
  await writeFile(path.join(root, "package-lock.json"), JSON.stringify({ version: "1.0.0", packages: { "": { version: "1.0.0" } } }));
  await writeFile(path.join(root, "runyth.config.json"), JSON.stringify({
    template: { repository: "Runyth/template-foundry-module", source, version: "1.1.0" },
  }));
  return root;
}

async function setVersion(root, version) {
  await run(process.execPath, [path.join(root, "tools/set-version.mjs"), version]);
  const read = async (file) => JSON.parse(await readFile(path.join(root, file), "utf8"));
  return {
    manifest: await read("module.json"),
    packageJson: await read("package.json"),
    lock: await read("package-lock.json"),
    config: await read("runyth.config.json"),
  };
}

test("version:set keeps the manifest, package files, and source template config in step", async (t) => {
  const root = await fixture(true);
  t.after(() => rm(root, { recursive: true, force: true }));

  const { manifest, packageJson, lock, config } = await setVersion(root, "2.3.4");

  assert.equal(manifest.version, "2.3.4");
  assert.equal(packageJson.version, "2.3.4");
  assert.equal(lock.version, "2.3.4");
  assert.equal(lock.packages[""].version, "2.3.4");
  assert.equal(config.template.version, "2.3.4");
  assert.equal(manifest.download, "https://github.com/Runyth/demo/releases/download/v2.3.4/demo-v2.3.4-mod.zip");
});

test("version:set leaves a module's recorded template version alone", async (t) => {
  const root = await fixture(false);
  t.after(() => rm(root, { recursive: true, force: true }));

  const { manifest, config } = await setVersion(root, "2.3.4");

  assert.equal(manifest.version, "2.3.4");
  assert.equal(config.template.version, "1.1.0");
});
