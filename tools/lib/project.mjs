// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export async function readJson(relativePath, root = PROJECT_ROOT) {
  const fullPath = path.resolve(root, relativePath);
  return JSON.parse(await readFile(fullPath, "utf8"));
}

export async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error?.code)) return false;
    throw error;
  }
}

export async function walkFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(root, fullPath));
    else if (entry.isFile()) files.push(path.relative(root, fullPath).split(path.sep).join("/"));
  }
  return files;
}

export function normalizePath(value) {
  return value.split(path.sep).join("/").replace(/^\.\//, "");
}

export function assertInsideRoot(root, target) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes project root: ${target}`);
  }
}
