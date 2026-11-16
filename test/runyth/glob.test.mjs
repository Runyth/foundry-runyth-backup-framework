// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import test from "node:test";
import assert from "node:assert/strict";
import { matchesGlob } from "../../tools/lib/glob.mjs";

test("recursive glob matches nested and direct files", () => {
  assert.equal(matchesGlob("scripts/main.js", "scripts/**"), true);
  assert.equal(matchesGlob("scripts/api/index.js", "scripts/**"), true);
  assert.equal(matchesGlob("styles/main.css", "scripts/**"), false);
});

test("double-star slash may match zero directories", () => {
  assert.equal(matchesGlob("main.js", "**/*.js"), true);
  assert.equal(matchesGlob("scripts/main.js", "**/*.js"), true);
});
