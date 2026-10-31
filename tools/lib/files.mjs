// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Runyth. See the LICENSE file for rights and obligations.
import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

export async function walk(root, { includeDirectories = false } = {}) {
  const absoluteRoot = resolve(root);
  const results = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = resolve(directory, entry.name);
      const path = relative(absoluteRoot, absolute).split(sep).join("/");
      if (entry.isSymbolicLink()) throw new Error(`Symlinks are not permitted: ${path}`);
      if (entry.isDirectory()) {
        if (includeDirectories) results.push({ absolute, path, directory: true });
        await visit(absolute);
      } else if (entry.isFile()) {
        const metadata = await stat(absolute);
        results.push({ absolute, path, directory: false, size: metadata.size });
      }
    }
  }

  await visit(absoluteRoot);
  return results;
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function isExcludedSourcePath(path) {
  return (
    path === "dist" ||
    path.startsWith("dist/") ||
    path === "node_modules" ||
    path.startsWith("node_modules/") ||
    path === ".git" ||
    path.startsWith(".git/") ||
    path.endsWith(".log") ||
    path === ".DS_Store"
  );
}
