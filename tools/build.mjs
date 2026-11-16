// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
// Runyth archive standard: emit -mod, -src and -doc archives with checksums.
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT, pathExists, readJson, walkFiles } from "./lib/project.mjs";
import { matchesAny } from "./lib/glob.mjs";
import { runCommand } from "./lib/process.mjs";
import { sha256File } from "./lib/hash.mjs";
import { writeDeterministicZip } from "./lib/zip.mjs";

const DOC_EXCLUDED = ["node_modules/", "dist/", ".git/", ".github/", ".runyth/", "test/", "tools/"];
const DOC_ROOT_FILES = ["README.md", "CHANGELOG.md", "LICENSE", "SECURITY.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md"];

const config = await readJson("runyth.config.json");
const manifest = await readJson("module.json");
const dist = path.join(PROJECT_ROOT, "dist");
const staging = path.join(dist, "staging");
await rm(dist, { recursive: true, force: true });
await mkdir(staging, { recursive: true });

for (const step of config.build.preBuild ?? []) {
  if (!step.command || !Array.isArray(step.args ?? [])) throw new Error("Each preBuild step requires command and args.");
  await runCommand(step.command, step.args ?? [], { cwd: path.resolve(PROJECT_ROOT, step.cwd ?? ".") });
}

const allFiles = await walkFiles(PROJECT_ROOT);
const installFiles = allFiles.filter((file) => matchesAny(file, config.build.include) && !matchesAny(file, config.build.exclude));
const installRoot = path.join(staging, manifest.id);
for (const relativePath of installFiles) {
  const target = path.join(installRoot, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(path.join(PROJECT_ROOT, relativePath), target);
}

const installName = `${manifest.id}-v${manifest.version}-mod.zip`;
const sourceName = `${manifest.id}-v${manifest.version}-src.zip`;
const documentationName = `${manifest.id}-v${manifest.version}-doc.zip`;
const sourceRoot = `${manifest.id}-v${manifest.version}-src`;
const documentationRoot = `${manifest.id}-v${manifest.version}-doc`;
const installEntries = await Promise.all(installFiles.map(async (file) => ({ name: `${manifest.id}/${file}`, content: await readFile(path.join(PROJECT_ROOT, file)) })));
if (!installEntries.length) throw new Error("The install plan selected no files.");
await writeDeterministicZip(path.join(dist, installName), installEntries);

const documentationFiles = [
  ...allFiles.filter((file) => DOC_ROOT_FILES.includes(file)),
  ...allFiles.filter((file) => file.startsWith("docs/") && file.endsWith(".md")),
].filter((file) => !DOC_EXCLUDED.some((entry) => file.startsWith(entry)));
const documentationEntries = await Promise.all(documentationFiles.map(async (file) => ({ name: `${documentationRoot}/${file}`, content: await readFile(path.join(PROJECT_ROOT, file)) })));
if (!documentationEntries.length) throw new Error("The documentation plan selected no files.");
await writeDeterministicZip(path.join(dist, documentationName), documentationEntries);

const sourceFiles = allFiles.filter((file) => !matchesAny(file, config.build.sourceExclude) || file.endsWith(".env.example"));
const sourceEntries = await Promise.all(sourceFiles.map(async (file) => ({ name: `${sourceRoot}/${file}`, content: await readFile(path.join(PROJECT_ROOT, file)) })));
await writeDeterministicZip(path.join(dist, sourceName), sourceEntries);
await cp(path.join(PROJECT_ROOT, "module.json"), path.join(dist, "module.json"));

const checksumName = `${manifest.id}-v${manifest.version}-SHA256SUMS.txt`;
const checksumTargets = [installName, sourceName, documentationName, "module.json"];
const checksums = [];
for (const name of checksumTargets) checksums.push(`${await sha256File(path.join(dist, name))}  ${name}`);
await writeFile(path.join(dist, checksumName), `${checksums.join("\n")}\n`);

const catalogPath = path.join(PROJECT_ROOT, "packs/catalog.json");
const catalog = (await pathExists(catalogPath)) ? await readJson("packs/catalog.json") : null;
const report = {
  schemaVersion: 1,
  moduleId: manifest.id,
  version: manifest.version,
  templateVersion: config.template.version,
  ...(catalog ? { contentVersion: catalog.version } : {}),
  installArchive: installName,
  sourceArchive: sourceName,
  documentationArchive: documentationName,
  checksumFile: checksumName,
  installRoot: manifest.id,
  sourceRoot,
  documentationRoot,
  installFiles: installFiles.length,
  sourceFiles: sourceFiles.length,
  documentationFiles: documentationFiles.length,
  reproducibleTimestamp: "1980-01-01T00:00:00Z"
};
await writeFile(path.join(dist, "build-report.json"), `${JSON.stringify(report, null, 2)}\n`);
await rm(staging, { recursive: true, force: true });
console.log(`Built ${installName}, ${sourceName} and ${documentationName}.`);
