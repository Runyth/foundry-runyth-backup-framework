// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Runyth. See the LICENSE file for rights and obligations.
import { assert } from "./util.mjs";

const DAY = 86_400_000;
const PERIODS = new Set(["all", "daily", "weekly", "monthly", "yearly", "none"]);

export function parseRetentionPolicy(text) {
  return String(text).split(";").map((segment) => segment.trim()).filter(Boolean).map((segment) => {
    const [range, mode] = segment.split("=").map((part) => part.trim());
    assert(PERIODS.has(mode), `Unsupported retention mode: ${mode}`);
    if (range.startsWith(">")) return { minDays: Number(range.slice(1, -1)), maxDays: Infinity, mode };
    const match = range.match(/^(\d+)-(\d+)d$/);
    assert(match, `Invalid retention range: ${range}`);
    return { minDays: Number(match[1]), maxDays: Number(match[2]), mode };
  });
}

function bucketKey(date, mode) {
  if (mode === "daily") return date.toISOString().slice(0, 10);
  if (mode === "monthly") return date.toISOString().slice(0, 7);
  if (mode === "yearly") return date.toISOString().slice(0, 4);
  if (mode === "weekly") {
    const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = utc.getUTCDay() || 7;
    utc.setUTCDate(utc.getUTCDate() + 4 - day);
    const start = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((utc - start) / DAY) + 1) / 7);
    return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  return date.toISOString();
}

export function selectRetained(entries, policyText, now = new Date()) {
  const rules = parseRetentionPolicy(policyText);
  const sorted = [...entries].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const seen = new Set();
  return sorted.filter((entry) => {
    const date = new Date(entry.timestamp);
    const ageDays = Math.floor(Math.max(0, (now - date) / DAY));
    const rule = rules.find((candidate) => ageDays >= candidate.minDays && ageDays <= candidate.maxDays);
    if (!rule || rule.mode === "none") return false;
    if (rule.mode === "all") return true;
    const key = `${rule.mode}:${bucketKey(date, rule.mode)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
