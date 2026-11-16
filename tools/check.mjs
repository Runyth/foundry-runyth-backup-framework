// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import { PROJECT_ROOT } from "./lib/project.mjs";
import { runCommand } from "./lib/process.mjs";

const steps = [
  ["node", ["tools/format.mjs", "--check"]],
  ["node", ["tools/validate.mjs"]],
  ["node", ["tools/audit-foundry.mjs"]],
  [process.execPath, ["--test", "--test-reporter=spec"]],
  ["node", ["tools/build.mjs"]],
  ["node", ["tools/verify-release.mjs"]]
];

for (const [command, args] of steps) await runCommand(command, args, { cwd: PROJECT_ROOT });
console.log("Complete Runyth quality gate passed.");
