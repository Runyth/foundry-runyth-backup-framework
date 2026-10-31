// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Runyth. See the LICENSE file for rights and obligations.
import { deepClone } from "./util.mjs";

export const MERGE_STRATEGIES = Object.freeze({
  "keep": (live) => deepClone(live),
  "replace": (_live, incoming) => deepClone(incoming),
  "shallow-object": (live, incoming) => ({ ...(live ?? {}), ...(incoming ?? {}) }),
  "deep-object": (live, incoming) => deepMerge(live, incoming),
  "append-unique": (live, incoming) => [...new Set([...(live ?? []), ...(incoming ?? [])])],
  "union-by-id": (live, incoming) => unionByKey(live, incoming, "id")
});

export function deepMerge(live, incoming) {
  if (Array.isArray(incoming)) return deepClone(incoming);
  if (!incoming || typeof incoming !== "object") return deepClone(incoming);
  const output = (live && typeof live === "object" && !Array.isArray(live)) ? deepClone(live) : {};
  for (const [key, value] of Object.entries(incoming)) output[key] = deepMerge(output[key], value);
  return output;
}

export function unionByKey(live = [], incoming = [], key = "id") {
  const map = new Map();
  for (const value of live) map.set(value?.[key], deepClone(value));
  for (const value of incoming) map.set(value?.[key], deepClone(value));
  return [...map.values()];
}

export function mergeValues(strategy, live, incoming, customStrategies = {}) {
  const fn = customStrategies[strategy] ?? MERGE_STRATEGIES[strategy];
  if (!fn) throw new Error(`Unknown merge strategy: ${strategy}`);
  return fn(live, incoming);
}
