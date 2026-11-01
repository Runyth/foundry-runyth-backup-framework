// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { isExcludedSourcePath, readJson, walk } from "./lib/files.mjs";
import { createZip } from "./lib/zip.mjs";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const manifest = await readJson(resolve(root, "module.json"));
const version = manifest.version;
const moduleId = manifest.id;
const installName = `${moduleId}-v${version}-mod.zip`;
const sourceName = `${moduleId}-v${version}-src.zip`;
const docName = `${moduleId}-v${version}-doc.zip`;
const checksumName = `${moduleId}-v${version}-SHA256SUMS.txt`;
const reportName = `${moduleId}-v${version}-build-report.json`;
const installRoot = moduleId;
const sourceRoot = `${moduleId}-v${version}-src`;
const docRoot = `${moduleId}-v${version}-doc`;
const installPrefixes = ["module.json", "LICENSE", "NOTICE", "README.md", "CHANGELOG.md", "lang/", "scripts/", "styles/", "templates/"];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const tracked = (await walk(root)).filter((file) => !isExcludedSourcePath(file.path));
const installFiles = tracked.filter((file) => installPrefixes.some((prefix) => file.path === prefix || file.path.startsWith(prefix)));
const docFiles = tracked.filter((file) => (
  ["README.md", "CHANGELOG.md", "LICENSE", "NOTICE", "SECURITY.md", "CONTRIBUTING.md"].includes(file.path)
  || file.path.startsWith("docs/")
  || file.path.startsWith("reports/")
));

await createZip(resolve(dist, installName), installFiles.map((file) => ({ path: file.absolute, name: `${installRoot}/${file.path}` })));
await createZip(resolve(dist, sourceName), tracked.map((file) => ({ path: file.absolute, name: `${sourceRoot}/${file.path}` })));
await createZip(resolve(dist, docName), docFiles.map((file) => ({ path: file.absolute, name: `${docRoot}/${file.path}` })));

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

const moduleChecksum = await sha256(resolve(root, "module.json"));
const installChecksum = await sha256(resolve(dist, installName));
const sourceChecksum = await sha256(resolve(dist, sourceName));
const docChecksum = await sha256(resolve(dist, docName));
await writeFile(
  resolve(dist, checksumName),
  `${installChecksum}  ${installName}\n${sourceChecksum}  ${sourceName}\n${docChecksum}  ${docName}\n${moduleChecksum}  module.json\n`,
);

const report = {
  schemaVersion: 1,
  moduleId,
  displayTitle: manifest.title,
  version,
  foundry: manifest.compatibility,
  installArchive: installName,
  sourceArchive: sourceName,
  documentationArchive: docName,
  checksumFile: checksumName,
  installRoot,
  sourceRoot,
  docRoot,
  installFiles: installFiles.length,
  sourceFiles: tracked.length,
  documentationFiles: docFiles.length,
  reproducibleTimestamp: "1980-01-01T00:00:00Z",
  generatedArtifacts: [installName, sourceName, docName, checksumName, reportName],
};
await writeFile(resolve(dist, reportName), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Built ${basename(installName)} (${installFiles.length} files).`);
console.log(`Built ${basename(sourceName)} (${tracked.length} files).`);
console.log(`Built ${basename(docName)} (${docFiles.length} files).`);
