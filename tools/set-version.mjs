// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
// Runyth archive standard: set versions across module.json, package.json, the lockfile and runyth.config.json.
import { writeFile } from "node:fs/promises";
import { PROJECT_ROOT, pathExists, readJson } from "./lib/project.mjs";
import { stableJson } from "./lib/text.mjs";
import path from "node:path";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version ?? "")) throw new Error("Usage: npm run version:set -- <semantic-version>");
const manifest = await readJson("module.json");
const packageJson = await readJson("package.json");
const lock = await readJson("package-lock.json");
const configPath = path.join(PROJECT_ROOT, "runyth.config.json");
const hasConfig = await pathExists(configPath);
manifest.version = version;
manifest.download = `https://github.com/${manifest.url.replace("https://github.com/", "")}/releases/download/v${version}/${manifest.id}-v${version}-mod.zip`;
packageJson.version = version;
lock.version = version;
if (lock.packages?.[""]) lock.packages[""].version = version;
await writeFile(path.join(PROJECT_ROOT, "module.json"), stableJson(manifest));
await writeFile(path.join(PROJECT_ROOT, "package.json"), stableJson(packageJson));
await writeFile(path.join(PROJECT_ROOT, "package-lock.json"), stableJson(lock));
if (hasConfig) {
  const config = await readJson("runyth.config.json");
  if (config.template?.source === true) {
    config.template.version = version;
    await writeFile(configPath, stableJson(config));
  }
}
const hasCatalog = await pathExists(path.join(PROJECT_ROOT, "packs/catalog.json"));
console.log(`Set module version to ${version}. Update CHANGELOG.md${hasCatalog ? " and packs/catalog.json content versions" : ""} separately.`);
