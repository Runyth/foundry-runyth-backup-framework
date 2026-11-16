// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PROJECT_ROOT, pathExists, walkFiles } from "./lib/project.mjs";
import { matchesGlob } from "./lib/glob.mjs";
import { stableJson } from "./lib/text.mjs";

export const MANAGED_BLOCK_BEGIN = "# --- Runyth template managed (begin) ---";
export const MANAGED_BLOCK_END = "# --- Runyth template managed (end) ---";
const escapeForRegExp = (value) => value.replace(/[.*+?^${}()[\]\\]/gu, "\\$&");
const MANAGED_BLOCK_PATTERN = new RegExp(
  `${escapeForRegExp(MANAGED_BLOCK_BEGIN)}[\\s\\S]*?${escapeForRegExp(MANAGED_BLOCK_END)}\\n?`,
  "u",
);

function CLIError(message) {
  if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    console.error(`Error: ${message}`);
  } else {
    throw new Error(message);
  }
}

export function isExcludedPath(exclusions, candidatePath) {
  return exclusions.some((selector) => selector === candidatePath || matchesGlob(candidatePath, selector));
}

export function excludedScriptKeys(exclusions, filePath) {
  const keys = new Set();
  for (const selector of exclusions) {
    const match = selector.match(/^([^#]+)#scripts\.([^#]+)$/u);
    if (!match) continue;
    if (match[1] !== filePath) continue;
    keys.add(match[2]);
  }
  return keys;
}

export function mergeIgnoreContent(targetContent, templateContent) {
  const templateLines = templateContent.split("\n").filter((line) => line.length > 0 && line.trim() !== "");
  let unmanaged = "";
  let previousManaged = [];
  if (targetContent !== null) {
    const blockMatch = MANAGED_BLOCK_PATTERN.exec(targetContent);
    if (blockMatch) {
      previousManaged = blockMatch[0]
        .split("\n")
        .filter((line) => line.length > 0 && line !== MANAGED_BLOCK_BEGIN && line !== MANAGED_BLOCK_END);
      unmanaged = `${targetContent.slice(0, blockMatch.index)}${targetContent.slice(blockMatch.index + blockMatch[0].length)}`;
    } else {
      unmanaged = targetContent;
    }
  }
  const carriedOver = previousManaged.filter(
    (line) => !templateLines.includes(line) && !unmanaged.includes(`${line}\n`),
  );
  const passedLines = [...unmanaged.replace(/\s*$/u, "").split("\n"), ...carriedOver].filter(Boolean);
  const passedSet = new Set(passedLines);
  const appendLines = templateLines.filter((line) => !passedSet.has(line));
  const managedBlock = appendLines.length > 0
    ? [MANAGED_BLOCK_BEGIN, ...appendLines, MANAGED_BLOCK_END]
    : [];
  return `${[...passedLines, ...managedBlock].join("\n")}\n`;
}

export async function applyTemplate({ source: sourceArgument, root: rootArgument }) {
  if (!sourceArgument) throw new Error("Usage: node tools/template-sync.mjs --source <template-path> [--root <target-root>]");
  const source = path.resolve(sourceArgument);
  const root = rootArgument ? path.resolve(rootArgument) : PROJECT_ROOT;

  const templateConfigPath = path.join(source, "runyth.config.json");
  if (!(await pathExists(templateConfigPath)) || !(await pathExists(path.join(source, ".runyth/template-managed.json")))) {
    throw new Error("The template source must contain runyth.config.json and .runyth/template-managed.json.");
  }
  if (source === path.resolve(root)) {
    throw new Error("The template source cannot be its own target.");
  }
  const manifest = await json(path.join(source, ".runyth/template-managed.json"));
  const sourceConfig = await json(path.join(source, "runyth.config.json"));

  const targetConfigPath = path.join(root, "runyth.config.json");
  if (!(await pathExists(targetConfigPath))) {
    throw new Error("runyth.config.json is missing from the target root. Bootstrap the repository configuration before template synchronization.");
  }
  const targetConfig = await json(targetConfigPath);
  const exclusions = Array.isArray(targetConfig?.sync?.exclude) ? targetConfig.sync.exclude : [];

  const targetManifestPath = path.join(root, ".runyth/template-managed.json");
  const currentPaths = new Set(manifest.entries.map((entry) => entry.path));
  if (await pathExists(targetManifestPath)) {
    const targetManifest = await json(targetManifestPath);
    for (const previous of targetManifest.entries ?? []) {
      if (isExcludedPath(exclusions, previous.path)) continue;
      if (!currentPaths.has(previous.path) && ["replace", "replace-tree"].includes(previous.mode)) {
        await rm(path.join(root, previous.path), { recursive: true, force: true });
      }
    }
  }

  for (const entry of manifest.entries) {
    const from = path.join(source, entry.path);
    const to = path.join(root, entry.path);
    if (isExcludedPath(exclusions, entry.path)) continue;
    if (!(await pathExists(from))) throw new Error(`Template-managed source is missing: ${entry.path}`);
    if (entry.mode === "replace" || entry.mode === "replace-tree") {
      await rm(to, { recursive: true, force: true });
      await mkdir(path.dirname(to), { recursive: true });
      await cp(from, to, { recursive: true });
    } else if (entry.mode === "sync-tree") {
      for (const relativePath of await walkFiles(from)) {
        const targetRelative = `${entry.path}/${relativePath}`.replace(/^\.\//u, "");
        if (isExcludedPath(exclusions, targetRelative)) continue;
        const target = path.join(to, relativePath);
        await mkdir(path.dirname(target), { recursive: true });
        await cp(path.join(from, relativePath), target);
      }
    } else if (entry.mode === "merge-package") {
      const scriptKeys = excludedScriptKeys(exclusions, entry.path);
      const sourcePackage = await json(path.join(source, entry.path));
      const content = await readFile(to, "utf8");
      const targetPackage = JSON.parse(content);
      targetPackage.type = sourcePackage.type;
      targetPackage.engines = sourcePackage.engines;
      targetPackage.packageManager = sourcePackage.packageManager;
      const mergedScripts = { ...targetPackage.scripts };
      for (const [key, value] of Object.entries(sourcePackage.scripts ?? {})) {
        if (scriptKeys.has(key)) continue;
        mergedScripts[key] = value;
      }
      targetPackage.scripts = mergedScripts;
      await writeFile(to, stableJson(targetPackage));
    } else if (entry.mode === "merge-ignore") {
      const templateContent = await readFile(from, "utf8");
      const targetContent = (await pathExists(to)) ? await readFile(to, "utf8") : null;
      await writeFile(to, mergeIgnoreContent(targetContent, templateContent));
    } else {
      throw new Error(`Unsupported template sync mode: ${entry.mode}`);
    }
  }

  const statePath = path.join(root, ".runyth/template-state.json");
  const currentState = (await pathExists(statePath)) ? await json(statePath) : {};
  const appliedTemplate = { repository: sourceConfig.template.repository, version: sourceConfig.template.version };
  await writeFile(statePath, stableJson({ ...currentState, ...appliedTemplate, source: false, lastSync: new Date().toISOString() }));
  await writeFile(targetConfigPath, stableJson({
    ...targetConfig,
    template: { ...targetConfig.template, ...appliedTemplate },
  }));
  return { appliedTemplate, exclusions };
}

async function json(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function main() {
  try {
    await applyTemplate({ source: sourceArgument(), root: rootArgument() });
  } catch (error) {
    CLIError(error.message);
    process.exitCode = 1;
  }
}

function sourceArgument() {
  const index = process.argv.indexOf("--source");
  if (index < 0 || !process.argv[index + 1]) throw new Error("Usage: node tools/template-sync.mjs --source <template-path> [--root <target-root>]");
  return path.resolve(PROJECT_ROOT, process.argv[index + 1]);
}

function rootArgument() {
  const index = process.argv.indexOf("--root");
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) await main();
