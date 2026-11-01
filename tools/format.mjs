// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { isExcludedSourcePath, walk } from "./lib/files.mjs";

const root = resolve(import.meta.dirname, "..");
const supported = new Set([".mjs", ".json", ".md", ".yml", ".yaml", ".txt", ".css", ".hbs"]);
const failures = [];

for (const file of await walk(root)) {
  if (isExcludedSourcePath(file.path) || !supported.has(extname(file.path))) continue;
  const text = await readFile(file.absolute, "utf8");
  if (text.includes("\r")) failures.push(`${file.path}: CRLF line endings are not allowed.`);
  if (!text.endsWith("\n")) failures.push(`${file.path}: missing final newline.`);
  text.split("\n").forEach((line, index) => {
    if (/[ \t]+$/u.test(line)) failures.push(`${file.path}:${index + 1}: trailing whitespace.`);
    if (line.includes("\t")) failures.push(`${file.path}:${index + 1}: tabs are not allowed.`);
  });
  if (extname(file.path) === ".json") {
    const canonical = `${JSON.stringify(JSON.parse(text), null, 2)}\n`;
    if (text !== canonical) failures.push(`${file.path}: JSON is not canonical two-space formatting.`);
  }
}

if (failures.length) {
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log("Formatting verification passed.");
}
