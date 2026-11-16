// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
function escapeRegex(character) {
  return /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
}

export function globToRegExp(pattern) {
  const normalized = pattern.replaceAll("\\", "/").replace(/^\.\//, "");
  let source = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "*") {
      if (normalized[index + 1] === "*") {
        index += 1;
        if (normalized[index + 1] === "/") {
          index += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += escapeRegex(character);
    }
  }
  return new RegExp(`${source}$`);
}

export function matchesGlob(filePath, pattern) {
  const normalized = filePath.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!pattern.includes("*") && !pattern.includes("?")) {
    return normalized === pattern || normalized.startsWith(`${pattern.replace(/\/$/, "")}/`);
  }
  return globToRegExp(pattern).test(normalized);
}

export function matchesAny(filePath, patterns) {
  return patterns.some((pattern) => matchesGlob(filePath, pattern));
}
