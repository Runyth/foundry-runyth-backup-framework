// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { isExcludedSourcePath, readJson, walk } from "./lib/files.mjs";

const composed = (...parts) => parts.join("");
const root = resolve(import.meta.dirname, "..");
const failures = [];
const moduleId = "runyth-backup-framework";
const publicOrigin = `https://github.com/Runyth/foundry-${moduleId}`;
const header = "// SPDX-License-Identifier: AGPL-3.0-or-later\n// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.\n";
const licenceLine = `Copyright © 2026  [Daniel ${composed("Branie", "wski")}](https://brani.dev/)`;
const holderFragment = composed("// Copyright (C) 2026 Daniel ", "Brani", "ewski. See the LICENSE file for rights and obligations.");
const noticeHolder = composed("Copyright (C) 2026 Daniel ", "Brani", "ewski\n");
const identityPatterns = [
  new RegExp(composed("aki", "to"), "iu"),
  new RegExp(composed("Branie", "wski"), "iu"),
  new RegExp(composed("akki", "@"), "iu"),
  new RegExp(composed("ik", "\\.me"), "iu"),
  new RegExp(composed("/mnt", "/"), "u"),
  new RegExp(composed("/home", "/"), "u"),
  new RegExp(composed("/Users", "/"), "u"),
  new RegExp(composed("AC09E018", "1960A982"), "u"),
];

const manifest = await readJson(resolve(root, "module.json"));
const packageJson = await readJson(resolve(root, "package.json"));
if (manifest.id !== moduleId) failures.push("Manifest id is invalid.");
if (manifest.title !== "Runyth Backup Framework") failures.push("Manifest title is invalid.");
if (manifest.version !== "1.0.1" || packageJson.version !== "1.0.1") failures.push("Version must be 1.0.1.");
if (packageJson.license !== "AGPL-3.0-or-later") failures.push("Package licence must be AGPL-3.0-or-later.");
if (manifest.license !== "LICENSE") failures.push("Manifest licence must name LICENSE.");
if (manifest.authors?.[0]?.name !== "Runyth" || manifest.authors?.[0]?.url !== "https://github.com/Runyth") {
  failures.push("Public author must be Runyth with the organisation URL.");
}
if (manifest.url !== publicOrigin) failures.push("Manifest url must use the public foundry- repository.");
if (manifest.manifest !== `${publicOrigin}/releases/latest/download/module.json`) failures.push("Manifest URL is invalid.");
if (manifest.download !== `${publicOrigin}/releases/download/v${manifest.version}/${moduleId}-v${manifest.version}-mod.zip`) {
  failures.push("Manifest download URL must name the -mod release archive.");
}
if (packageJson.repository?.url !== `${publicOrigin}.git`) failures.push("Package repository URL is invalid.");
if (manifest.compatibility?.minimum !== "13" || manifest.compatibility?.verified !== "13" || manifest.compatibility?.maximum !== "13") {
  failures.push("Foundry compatibility must remain the tested v13 pin.");
}
if (manifest.esmodules?.[0] !== "scripts/main.mjs") failures.push("Runtime entry is invalid.");
if ((manifest.relationships?.requires ?? []).length !== 0) failures.push("The framework must not require another module.");

const readme = await readFile(resolve(root, "README.md"), "utf8");
if (!readme.includes("## Licence\n") || !readme.includes(licenceLine)) failures.push("README licence chapter is not the required notice.");

for (const file of await walk(root)) {
  if (isExcludedSourcePath(file.path)) continue;
  if (extname(file.path) === ".mjs") {
    const source = await readFile(file.absolute, "utf8");
    if (!source.startsWith(header)) failures.push(`${file.path}: missing AGPL source header.`);
  }
  const text = await readFile(file.absolute);
  let decoded = text.toString("utf8").replaceAll(holderFragment, "").replaceAll(noticeHolder, "");
  if (file.path === "README.md") decoded = decoded.replaceAll(licenceLine, "");
  if (identityPatterns.some((pattern) => pattern.test(decoded))) failures.push(`${file.path}: publication identity material.`);
}

const scripts = (await walk(resolve(root, "scripts"))).map((file) => file.path);
const scriptText = (await Promise.all(scripts.map(async (path) => readFile(resolve(root, "scripts", path), "utf8")))).join("\n");
if (/ApplicationV1|foundry\.appv1|_upload|_browse|_createDirectory/u.test(scriptText)) failures.push("Forbidden Foundry API marker found.");
if (/https?:\/\//u.test(scriptText)) failures.push("Runtime network URL found.");

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log("Validation gate passed.");
}
