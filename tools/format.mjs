// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT, pathExists, walkFiles } from "./lib/project.mjs";
import { matchesAny } from "./lib/glob.mjs";
import { stableJson } from "./lib/text.mjs";

const TEXT_PATTERNS = ["**/*.js", "**/*.mjs", "**/*.json", "**/*.md", "**/*.yml", "**/*.yaml", "**/*.css", "**/*.hbs", ".editorconfig", ".gitattributes", ".gitignore", ".npmrc", ".node-version", ".nvmrc", "LICENSE"];
const EXCLUDE = ["dist/**", "node_modules/**", ".git/**", "coverage/**"];

async function formatExclusions(root) {
  const configPath = path.join(root, "runyth.config.json");
  if (!(await pathExists(configPath))) return [];
  const config = JSON.parse(await readFile(configPath, "utf8"));
  return Array.isArray(config.format?.exclude) ? config.format.exclude : [];
}

export async function formatRepository({ root = PROJECT_ROOT, write = false } = {}) {
  const exclusions = await formatExclusions(root);
  const failures = [];
  for (const relativePath of await walkFiles(root)) {
    if (!matchesAny(relativePath, TEXT_PATTERNS) || matchesAny(relativePath, EXCLUDE) || matchesAny(relativePath, exclusions)) continue;
    const fullPath = path.join(root, relativePath);
    const original = await readFile(fullPath, "utf8");
    let formatted = original.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    if (relativePath.endsWith(".json")) formatted = stableJson(JSON.parse(formatted));
    else formatted = `${formatted.split("\n").map((line) => line.replace(/[ \t]+$/u, "")).join("\n").replace(/\n*$/u, "")}\n`;

    if (formatted !== original) {
      if (write) await writeFile(fullPath, formatted);
      if (!write) failures.push(relativePath);
    }
  }
  return failures;
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const invokedPath = process.argv[1] ? new URL(`file://${path.resolve(process.argv[1])}`).href : "";
if (import.meta.url === invokedPath) {
  const write = process.argv.includes("--write");
  const root = argumentValue("--root") ? path.resolve(argumentValue("--root")) : PROJECT_ROOT;
  const failures = await formatRepository({ root, write });
  if (failures.length > 0) {
    for (const failure of failures) console.error(`Formatting mismatch: ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(write ? "Formatting normalized." : "Formatting verified.");
  }
}
