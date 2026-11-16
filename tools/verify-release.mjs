// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
// Runyth archive standard: verify -mod, -src and -doc inventories and checksums.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT, pathExists, readJson } from "./lib/project.mjs";
import { sha256File } from "./lib/hash.mjs";
import { readZipEntries } from "./lib/zip.mjs";

const manifest = await readJson("module.json");
const catalogPath = path.join(PROJECT_ROOT, "packs/catalog.json");
const catalog = (await pathExists(catalogPath)) ? await readJson("packs/catalog.json") : null;
const dist = path.join(PROJECT_ROOT, "dist");
const prefix = `${manifest.id}-v${manifest.version}`;
const installName = `${prefix}-mod.zip`;
const sourceName = `${prefix}-src.zip`;
const documentationName = `${prefix}-doc.zip`;
const checksumName = `${prefix}-SHA256SUMS.txt`;
const checksums = new Map();
for (const line of (await readFile(path.join(dist, checksumName), "utf8")).trim().split("\n")) {
  const match = line.match(/^([a-f0-9]{64})\s{2}(.+)$/u);
  if (!match) throw new Error(`Invalid checksum line: ${line}`);
  checksums.set(match[2], match[1]);
}
for (const name of checksums.keys()) {
  const actual = await sha256File(path.join(dist, name));
  if (actual !== checksums.get(name)) throw new Error(`Checksum mismatch for ${name}.`);
}

const installEntries = await readZipEntries(path.join(dist, installName));
const installPrefix = `${manifest.id}/`;
if (![...installEntries.keys()].every((name) => name.startsWith(installPrefix))) throw new Error("Install ZIP has an invalid root.");
const embeddedManifest = JSON.parse(installEntries.get(`${installPrefix}module.json`)?.toString("utf8") ?? "null");
if (embeddedManifest?.id !== manifest.id || embeddedManifest?.version !== manifest.version) throw new Error("Install ZIP manifest identity/version mismatch.");
if (embeddedManifest?.download !== `https://github.com/${manifest.url.replace("https://github.com/", "")}/releases/download/v${manifest.version}/${installName}`) {
  throw new Error("Manifest download URL must name this release's -mod asset.");
}

for (const required of [`${installPrefix}module.json`, `${installPrefix}LICENSE`]) {
  if (!installEntries.has(required)) throw new Error(`Install archive is missing ${required}.`);
}
if (catalog) {
  if (!installEntries.has(`${installPrefix}packs/catalog.json`)) throw new Error("Install archive is missing packs/catalog.json.");
  for (const pack of manifest.packs ?? []) {
    if (!installEntries.has(`${installPrefix}${pack.path}`)) throw new Error(`Install archive is missing ${pack.path}.`);
    const documents = (await readFile(path.join(PROJECT_ROOT, pack.path), "utf8")).split("\n").filter(Boolean);
    if (!documents.length) throw new Error(`Compendium pack ${pack.name} would ship empty.`);
  }
}

const forbiddenInstall = ["node_modules/", ".git/", ".github/", "test/", "tests/", "tools/", "package.json", "package-lock.json"];
for (const name of installEntries.keys()) {
  const relative = name.slice(installPrefix.length);
  if (forbiddenInstall.some((entry) => relative === entry.replace(/\/$/, "") || relative.startsWith(entry))) throw new Error(`Forbidden install archive entry: ${name}`);
  if (relative.endsWith(".map")) throw new Error(`Source map in install archive: ${name}`);
}

const sourceEntries = await readZipEntries(path.join(dist, sourceName));
const sourcePrefix = `${prefix}-src/`;
if (![...sourceEntries.keys()].every((name) => name.startsWith(sourcePrefix))) throw new Error("Source ZIP has an invalid root.");
for (const required of ["module.json", "package.json", "package-lock.json", "runyth.config.json", "tools/build.mjs", ".github/workflows/ci.yml"]) {
  if (!sourceEntries.has(`${sourcePrefix}${required}`)) throw new Error(`Source ZIP is missing ${required}.`);
}

const documentationEntries = await readZipEntries(path.join(dist, documentationName));
const documentationPrefix = `${prefix}-doc/`;
if (![...documentationEntries.keys()].every((name) => name.startsWith(documentationPrefix))) throw new Error("Documentation ZIP has an invalid root.");
for (const required of ["README.md", "CHANGELOG.md", "LICENSE"]) {
  if (!documentationEntries.has(`${documentationPrefix}${required}`)) throw new Error(`Documentation ZIP is missing ${required}.`);
}

console.log(`Release verification passed: ${installEntries.size} install files, ${sourceEntries.size} source files, ${documentationEntries.size} documentation files.`);
