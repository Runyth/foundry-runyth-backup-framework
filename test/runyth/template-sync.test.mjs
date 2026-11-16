// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyTemplate } from "../../tools/template-sync.mjs";

async function makeTree(root, files) {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    if (content === null) await rm(target, { force: true });
    else await writeFile(target, content);
  }
}

async function fixture(name, sourceFiles, targetFiles, targetExclude = []) {
  const base = await mkdtemp(path.join(tmpdir(), `runyth-sync-${name}-`));
  const source = path.join(base, "source");
  const target = path.join(base, "target");
  await mkdir(source, { recursive: true });
  await mkdir(target, { recursive: true });
  const entries = JSON.parse(sourceFiles[".runyth/template-managed.json"]);
  await makeTree(source, {
    ...sourceFiles,
    ".runyth/template-managed.json": JSON.stringify({ schemaVersion: 1, entries }, null, 2),
    "runyth.config.json": JSON.stringify({
      schemaVersion: 1,
      template: { repository: "Runyth/template-test", source: true, version: "9.9.9" },
    }, null, 2),
  });
  await makeTree(target, {
    ...targetFiles,
    "runyth.config.json": JSON.stringify({
      schemaVersion: 1,
      module: { repository: "Runyth/foundry-runyth-test" },
      template: { repository: "Runyth/template-test", source: false, version: "0.0.1" },
      sync: { exclude: targetExclude },
    }, null, 2),
  });
  return { base, source, target };
}

const SOURCE_MANIFEST_PRESET = [
  { mode: "replace", path: "AGENTS.md" },
  { mode: "replace", path: "docs/managed.md" },
  { mode: "sync-tree", path: "tools" },
  { mode: "merge-ignore", path: ".gitignore" },
  { mode: "merge-package", path: "package.json" },
];

function defaultSource() {
  return {
    ".runyth/template-managed.json": JSON.stringify(SOURCE_MANIFEST_PRESET),
    "AGENTS.md": "template agents\n",
    "docs/managed.md": "template managed doc\n",
    ".gitignore": "node_modules/\ndist/\n*.out\n",
    "tools/build.mjs": "template build\n",
    "tools/lib/zip.mjs": "template zip\n",
    "tools/release.mjs": "template release\n",
    "package.json": JSON.stringify({
      name: "@runyth/template-test",
      type: "module",
      scripts: { check: "node tools/check.mjs", test: "node --test", build: "node tools/build.mjs" },
    }, null, 2),
  };
}

function defaultTarget() {
  return {
    "module.json": JSON.stringify({ id: "runyth-test", version: "1.0.0" }),
    "package.json": JSON.stringify({ type: "module", version: "1.0.0", scripts: { check: "custom check script", extra: "keep" } }, null, 2),
    "AGENTS.md": "bespoke agents\n",
    "docs/managed.md": "bespoke doc\n",
    "docs/legacy.md": "legacy content\n",
    ".gitignore": "node_modules/\nartifacts/\nsecrets.log\n",
    "tools/build.mjs": "bespoke build\n",
    ".runyth/template-managed.json": JSON.stringify({
      schemaVersion: 1,
      entries: [
        { mode: "replace", path: "docs/managed.md" },
        { mode: "replace", path: "docs/legacy.md" },
      ],
    }),
  };
}

async function readTargetFile(target, relative) {
  return readFile(path.join(target, relative), "utf8");
}

test("excluded replace paths keep the repository file untouched", async (t) => {
  const { base, source, target } = await fixture("replace", defaultSource(), defaultTarget(), ["AGENTS.md"]);
  t.after(() => rm(base, { recursive: true, force: true }));
  await applyTemplate({ source, root: target });
  assert.equal(await readTargetFile(target, "AGENTS.md"), "bespoke agents\n");
  assert.equal(await readTargetFile(target, "docs/managed.md"), "template managed doc\n");
});

test("excluded paths are protected from previous-manifest removal; stale entries still fall", async (t) => {
  const narrowed = SOURCE_MANIFEST_PRESET.filter((entry) => entry.path !== "docs/managed.md");
  const sourceFiles = { ...defaultSource(), ".runyth/template-managed.json": JSON.stringify(narrowed) };
  const first = await fixture("removal-keep", sourceFiles, defaultTarget(), ["docs/legacy.md"]);
  t.after(() => rm(first.base, { recursive: true, force: true }));
  await applyTemplate({ source: first.source, root: first.target });
  assert.equal(await readTargetFile(first.target, "docs/legacy.md"), "legacy content\n");

  const second = await fixture("removal-drop", sourceFiles, defaultTarget(), []);
  t.after(() => rm(second.base, { recursive: true, force: true }));
  await applyTemplate({ source: second.source, root: second.target });
  await assert.rejects(() => readTargetFile(second.target, "docs/legacy.md"), { code: "ENOENT" });
});

test("sync-tree honors file and tree exclusions and copies template-only files", async (t) => {
  const { base, source, target } = await fixture("tree", defaultSource(), defaultTarget(), ["tools/build.mjs", "tools/lib/**"]);
  t.after(() => rm(base, { recursive: true, force: true }));
  await applyTemplate({ source, root: target });
  assert.equal(await readTargetFile(target, "tools/build.mjs"), "bespoke build\n");
  await assert.rejects(() => readTargetFile(target, "tools/lib/zip.mjs"), { code: "ENOENT" });
  assert.equal(await readTargetFile(target, "tools/release.mjs"), "template release\n");
});

test("a whole-tree tools exclusion copies nothing", async (t) => {
  const { base, source, target } = await fixture("tree-whole", defaultSource(), defaultTarget(), ["tools"]);
  t.after(() => rm(base, { recursive: true, force: true }));
  await applyTemplate({ source, root: target });
  assert.equal(await readTargetFile(target, "tools/build.mjs"), "bespoke build\n");
  await assert.rejects(() => readTargetFile(target, "tools/release.mjs"), { code: "ENOENT" });
});

test("merge-package keeps excluded script keys for repositories that own them", async (t) => {
  const { base, source, target } = await fixture("package-pointer", defaultSource(), defaultTarget(), ["package.json#scripts.check"]);
  t.after(() => rm(base, { recursive: true, force: true }));
  await applyTemplate({ source, root: target });
  const packageJson = JSON.parse(await readTargetFile(target, "package.json"));
  assert.equal(packageJson.scripts.check, "custom check script");
  assert.equal(packageJson.scripts.build, "node tools/build.mjs");
  assert.equal(packageJson.scripts.extra, "keep");
  assert.equal(packageJson.type, "module");
});

test("merge-package without pointer exclusions follows the template scripts", async (t) => {
  const { base, source, target } = await fixture("package-plain", defaultSource(), defaultTarget(), []);
  t.after(() => rm(base, { recursive: true, force: true }));
  await applyTemplate({ source, root: target });
  const packageJson = JSON.parse(await readTargetFile(target, "package.json"));
  assert.equal(packageJson.scripts.check, "node tools/check.mjs");
});

test("merge-ignore appends only missing template entries and always preserves repository lines", async (t) => {
  const { base, source, target } = await fixture("merge-ignore", defaultSource(), defaultTarget(), []);
  t.after(() => rm(base, { recursive: true, force: true }));
  await applyTemplate({ source, root: target });
  const afterFirst = await readTargetFile(target, ".gitignore");
  assert.ok(afterFirst.includes("artifacts/\n"), "custom lines survive");
  assert.ok(afterFirst.includes("secrets.log\n"), "custom lines survive");
  assert.ok(afterFirst.includes("dist/\n"), "template additions land");
  assert.ok(afterFirst.includes("*.out\n"), "template additions land");
  assert.equal(afterFirst.match(/^node_modules\/$/gum).length, 1, "no duplicate node_modules");
  await applyTemplate({ source, root: target });
  const afterSecond = await readTargetFile(target, ".gitignore");
  assert.equal(afterSecond, afterFirst, "idempotent");
});

test("merge-ignore carries previously managed lines into the repository section when the template drops them", async (t) => {
  const { base, source, target } = await fixture("merge-ignore-carry", defaultSource(), defaultTarget(), []);
  t.after(() => rm(base, { recursive: true, force: true }));
  await applyTemplate({ source, root: target });
  await makeTree(source, { ".gitignore": "node_modules/\ndist/\n" });
  await applyTemplate({ source, root: target });
  const content = await readTargetFile(target, ".gitignore");
  assert.ok(content.includes("*.out\n"), "dropped template entries survive as repository lines");
  assert.ok(content.includes("dist/\n"));
});

test("a target root without runyth.config.json is rejected with guidance", async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), "runyth-sync-missing-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const source = path.join(base, "source");
  const target = path.join(base, "target");
  const sourceFiles = defaultSource();
  await makeTree(source, {
    ...sourceFiles,
    ".runyth/template-managed.json": JSON.stringify({ schemaVersion: 1, entries: JSON.parse(sourceFiles[".runyth/template-managed.json"]) }, null, 2),
    "runyth.config.json": JSON.stringify({ schemaVersion: 1, template: { repository: "Runyth/template-test", source: true, version: "9.9.9" } }, null, 2),
  });
  await mkdir(target, { recursive: true });
  await assert.rejects(() => applyTemplate({ source, root: target }), /runyth\.config\.json is missing from the target root/);
});

test("applyTemplate never mutates the template source tree", async (t) => {
  const { base, source, target } = await fixture("source-clean", defaultSource(), defaultTarget(), []);
  t.after(() => rm(base, { recursive: true, force: true }));
  await applyTemplate({ source, root: target });
  assert.equal(await readFile(path.join(source, "AGENTS.md"), "utf8"), "template agents\n");
  assert.equal(await readFile(path.join(source, "tools/build.mjs"), "utf8"), "template build\n");
  assert.ok((await readFile(path.join(source, "runyth.config.json"), "utf8")).includes("9.9.9"));
});

test("the target config and state record the applied template version once", async (t) => {
  const { base, source, target } = await fixture("state", defaultSource(), defaultTarget(), []);
  t.after(() => rm(base, { recursive: true, force: true }));
  await applyTemplate({ source, root: target });
  const config = JSON.parse(await readTargetFile(target, "runyth.config.json"));
  assert.equal(config.template.version, "9.9.9");
  assert.equal(config.template.source, false);
  const state = JSON.parse(await readTargetFile(target, ".runyth/template-state.json"));
  assert.equal(state.version, "9.9.9");
  assert.equal(state.source, false);
});

test("missing managed template source fails loudly", async (t) => {
  const { base, source, target } = await fixture("missing-source", defaultSource(), defaultTarget(), []);
  t.after(() => rm(base, { recursive: true, force: true }));
  await makeTree(source, { ".gitignore": null });
  await assert.rejects(() => applyTemplate({ source, root: target }), /Template-managed source is missing: \.gitignore/);
});

test("merge-ignore creates the ignore file when the target has none", async (t) => {
  const targetFiles = defaultTarget();
  delete targetFiles[".gitignore"];
  const { base, source, target } = await fixture("merge-ignore-absent", defaultSource(), targetFiles, []);
  t.after(() => rm(base, { recursive: true, force: true }));
  await applyTemplate({ source, root: target });
  const content = await readTargetFile(target, ".gitignore");
  assert.ok(content.includes("node_modules/\n"));
  assert.ok(content.includes("*.out\n"));
});

test("applyTemplate refuses to use the template source as its own target", async (t) => {
  const base = await mkdtemp(path.join(tmpdir(), "runyth-sync-self-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const source = path.join(base, "source");
  const sourceFiles = defaultSource();
  await makeTree(source, {
    ...sourceFiles,
    ".runyth/template-managed.json": JSON.stringify({ schemaVersion: 1, entries: JSON.parse(sourceFiles[".runyth/template-managed.json"]) }, null, 2),
    "runyth.config.json": JSON.stringify({ schemaVersion: 1, template: { repository: "Runyth/template-test", source: true, version: "9.9.9" } }, null, 2),
  });
  await assert.rejects(
    () => applyTemplate({ source, root: source }),
    /The template source cannot be its own target\./,
  );
  assert.ok((await readFile(path.join(source, "AGENTS.md"), "utf8")).includes("template agents"));
});

test("the shipped template manifest declares merge-ignore for .gitignore", async (t) => {
  const manifest = JSON.parse(await readFile(new URL("../../.runyth/template-managed.json", import.meta.url), "utf8"));
  const modes = new Set(manifest.entries.map((entry) => entry.mode));
  for (const mode of modes) {
    assert.ok(
      ["replace", "replace-tree", "sync-tree", "merge-ignore", "merge-package"].includes(mode),
      `unknown manifest mode: ${mode}`,
    );
  }
  const gitignore = manifest.entries.find((entry) => entry.path === ".gitignore");
  assert.equal(gitignore.mode, "merge-ignore", "repositories keep unmanaged ignore lines");
});
