// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Runyth. See the LICENSE file for rights and obligations.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { readJson } from "./lib/files.mjs";
import { listZip } from "./lib/zip.mjs";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const manifest = await readJson(resolve(root, "module.json"));
const report = await readJson(resolve(dist, `${manifest.id}-v${manifest.version}-build-report.json`));
const installPath = resolve(dist, report.installArchive);
const sourcePath = resolve(dist, report.sourceArchive);
const docPath = resolve(dist, report.documentationArchive);
const installEntries = await listZip(installPath);
const sourceEntries = await listZip(sourcePath);
const docEntries = await listZip(docPath);
const failures = [];

if (report.installRoot !== manifest.id || report.sourceRoot !== `${manifest.id}-v${manifest.version}-src` || report.docRoot !== `${manifest.id}-v${manifest.version}-doc`) {
  failures.push("Archive roots are invalid.");
}
if (installEntries.some((entry) => !entry.startsWith(`${report.installRoot}/`))) failures.push("Install archive root is invalid.");
if (sourceEntries.some((entry) => !entry.startsWith(`${report.sourceRoot}/`))) failures.push("Source archive root is invalid.");
if (docEntries.some((entry) => !entry.startsWith(`${report.docRoot}/`))) failures.push("Documentation archive root is invalid.");
for (const required of ["module.json", "LICENSE", "README.md", "scripts/main.mjs"]) {
  if (!installEntries.includes(`${report.installRoot}/${required}`)) failures.push(`Install archive is missing ${required}.`);
}
for (const forbidden of ["/tools/", "/tests/", "/docs/", "/.github/", "/package.json", ".git/"]) {
  if (installEntries.some((entry) => entry.includes(forbidden))) failures.push(`Install archive contains ${forbidden}.`);
}
if (sourceEntries.some((entry) => entry.includes("/.git/") || entry.includes("/node_modules/") || entry.includes("/dist/"))) {
  failures.push("Source archive contains a developer checkout or build output.");
}
if (!docEntries.includes(`${report.docRoot}/docs/SECURITY.md`)) failures.push("Documentation archive is missing the security note.");

const checksums = new Map(
  (await readFile(resolve(dist, report.checksumFile), "utf8")).trim().split("\n").map((line) => {
    const [hash, name] = line.trim().split(/\s{2,}/u);
    return [name, hash];
  }),
);
async function digest(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}
if ((await digest(installPath)) !== checksums.get(report.installArchive)) failures.push("Install checksum mismatch.");
if ((await digest(sourcePath)) !== checksums.get(report.sourceArchive)) failures.push("Source checksum mismatch.");
if ((await digest(docPath)) !== checksums.get(report.documentationArchive)) failures.push("Documentation checksum mismatch.");

const firstInstall = await readFile(installPath);
const result = spawnSync(process.execPath, [resolve(root, "tools/build.mjs")], { cwd: root, encoding: "utf8" });
if (result.status !== 0) failures.push(`Repeated build failed: ${result.stderr}`);
else if (!firstInstall.equals(await readFile(installPath))) failures.push("Install archive is not byte-reproducible.");

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`Release verification passed: ${installEntries.length} install files, ${sourceEntries.length} source files.`);
}
