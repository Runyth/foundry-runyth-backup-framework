// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT, pathExists, readJson, walkFiles } from "./lib/project.mjs";
import { flattenJson } from "./lib/text.mjs";
import { matchesAny } from "./lib/glob.mjs";

const errors = [];
const warnings = [];
const config = await readJson("runyth.config.json");
const manifest = await readJson("module.json");
const packageJson = await readJson("package.json");

function requireCondition(condition, message) {
  if (!condition) errors.push(message);
}

requireCondition(config.schemaVersion === 1, "runyth.config.json schemaVersion must be 1.");
requireCondition(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(manifest.id ?? ""), "module.json id must be lowercase kebab-case.");
requireCondition(typeof manifest.title === "string" && manifest.title.length > 0, "module.json title is required.");
requireCondition(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(manifest.version ?? ""), "module.json version must be semantic.");
requireCondition(manifest.compatibility?.minimum !== undefined, "Foundry compatibility.minimum is required.");
requireCondition(manifest.compatibility?.verified !== undefined, "Foundry compatibility.verified is required.");
requireCondition(packageJson.type === "module", "package.json type must be module.");
if (config.validation.requireVersionParity) {
  requireCondition(packageJson.version === manifest.version, "package.json and module.json versions differ.");
}
if (!config.template.source && config.validation.requireRepositoryUrls) {
  const expectedRepository = `https://github.com/${config.module.repository}`;
  requireCondition(manifest.url === expectedRepository, `module.json url must be ${expectedRepository}.`);
  requireCondition(manifest.manifest?.startsWith(`${expectedRepository}/releases/`), "module.json manifest URL must use GitHub Releases.");
  requireCondition(manifest.download?.includes(`/v${manifest.version}/`), "module.json download URL must contain the current version tag.");
}

const referencedPaths = new Set();
for (const field of ["esmodules", "scripts", "styles"]) {
  for (const value of manifest[field] ?? []) referencedPaths.add(value);
}
for (const language of manifest.languages ?? []) referencedPaths.add(language.path);
for (const pack of manifest.packs ?? []) if (pack.path) referencedPaths.add(pack.path);
for (const relativePath of referencedPaths) {
  requireCondition(await pathExists(path.join(PROJECT_ROOT, relativePath)), `Manifest path does not exist: ${relativePath}`);
}

const languages = new Map((manifest.languages ?? []).map((entry) => [entry.lang, entry.path]));
for (const locale of config.validation.requiredLocales ?? []) {
  requireCondition(languages.has(locale), `Required locale is absent from module.json: ${locale}`);
}
if (config.validation.requireLocaleParity && languages.size > 1) {
  const localeKeys = [];
  for (const [locale, relativePath] of [...languages.entries()].sort()) {
    const document = JSON.parse(await readFile(path.join(PROJECT_ROOT, relativePath), "utf8"));
    localeKeys.push([locale, new Set(flattenJson(document).keys())]);
  }
  const [baseLocale, baseKeys] = localeKeys[0];
  for (const [locale, keys] of localeKeys.slice(1)) {
    const missing = [...baseKeys].filter((key) => !keys.has(key));
    const extra = [...keys].filter((key) => !baseKeys.has(key));
    if (missing.length || extra.length) errors.push(`Localization parity mismatch ${baseLocale}/${locale}: missing=[${missing.join(", ")}], extra=[${extra.join(", ")}].`);
  }
}

const files = await walkFiles(PROJECT_ROOT);
const scriptFiles = files.filter((file) => matchesAny(file, ["**/*.js", "**/*.mjs"]) && !matchesAny(file, ["dist/**", "node_modules/**"]));
const importPattern = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/gu;
for (const relativePath of scriptFiles) {
  const source = await readFile(path.join(PROJECT_ROOT, relativePath), "utf8");
  for (const match of source.matchAll(importPattern)) {
    const candidate = path.resolve(PROJECT_ROOT, path.dirname(relativePath), match[1]);
    const possibilities = [candidate, `${candidate}.js`, `${candidate}.mjs`, path.join(candidate, "index.js")];
    if (!(await Promise.all(possibilities.map(pathExists))).some(Boolean)) {
      errors.push(`Unresolved relative import in ${relativePath}: ${match[1]}`);
    }
  }
}

if (!config.template.source) {
  const placeholderPattern = /runyth[-_ ]module[-_ ]template/giu;
  for (const relativePath of files.filter((file) => matchesAny(file, ["module.json", "package.json", "scripts/**/*.js", "lang/*.json"]))) {
    const content = await readFile(path.join(PROJECT_ROOT, relativePath), "utf8");
    if (placeholderPattern.test(content)) errors.push(`Template identity remains in ${relativePath}. Run npm run bootstrap.`);
    placeholderPattern.lastIndex = 0;
  }
}

for (const warning of warnings) console.warn(`Warning: ${warning}`);
for (const error of errors) console.error(`Error: ${error}`);
if (errors.length > 0) process.exitCode = 1;
else console.log(`Validation passed: ${files.length} repository files, ${scriptFiles.length} JavaScript modules.`);
