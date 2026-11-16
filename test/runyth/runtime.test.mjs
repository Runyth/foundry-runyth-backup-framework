// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { PROJECT_ROOT, pathExists } from "../../tools/lib/project.mjs";

const runtimeKitAvailable = await pathExists(path.join(PROJECT_ROOT, "scripts/runyth/logger.js"))
  && await pathExists(path.join(PROJECT_ROOT, "scripts/runyth/safe-executor.js"));

test("logger prefixes every message with the module ID", { skip: !runtimeKitAvailable }, async () => {
  const { createLogger } = await import("../../scripts/runyth/logger.js");
  const calls = [];
  const sink = Object.fromEntries(["debug", "info", "warn", "error", "log"].map((level) => [level, (...values) => calls.push([level, ...values])]));
  createLogger("example", sink).info("ready");
  assert.deepEqual(calls, [["info", "[example]", "ready"]]);
});

test("safe executor isolates failures and returns the fallback", { skip: !runtimeKitAvailable }, async () => {
  const { createSafeExecutor } = await import("../../scripts/runyth/safe-executor.js");
  const errors = [];
  const safely = createSafeExecutor({ error: (...values) => errors.push(values) });
  const result = await safely("example", async () => { throw new Error("failure"); }, "fallback");
  assert.equal(result, "fallback");
  assert.equal(errors.length, 1);
});
