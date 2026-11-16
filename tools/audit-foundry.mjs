// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT, readJson, walkFiles } from "./lib/project.mjs";
import { matchesAny } from "./lib/glob.mjs";

const config = await readJson("runyth.config.json");
const allow = config.validation.allowFindings ?? [];
const findings = [];
const rules = [
  { id: "deprecated-form-application", expression: /\bFormApplication\b/gu, message: "Use Foundry V13 ApplicationV2 APIs." },
  { id: "deprecated-application-v1", expression: /extends\s+Application\b/gu, message: "Use ApplicationV2 unless a documented compatibility boundary requires V1." },
  { id: "private-foundry-property", expression: /\b(?:game|foundry|canvas)\.[A-Za-z0-9_$.[\]]*\._[A-Za-z0-9_$]+/gu, message: "Do not depend on private Foundry state." },
  { id: "dynamic-code", expression: /\b(?:eval|Function)\s*\(/gu, message: "Dynamic code execution is prohibited." },
  { id: "unsafe-inner-html", expression: /\.innerHTML\s*=/gu, message: "Prefer DOM construction or validated rendering helpers." },
  { id: "jquery-only", expression: /\b(?:jQuery|\$)\s*\(/gu, message: "Avoid new jQuery-only runtime code." }
];

for (const relativePath of (await walkFiles(PROJECT_ROOT)).filter((file) => matchesAny(file, ["scripts/**/*.js", "scripts/**/*.mjs", "src/**/*.js", "src/**/*.mjs"]))) {
  const content = await readFile(path.join(PROJECT_ROOT, relativePath), "utf8");
  for (const rule of rules) {
    for (const match of content.matchAll(rule.expression)) {
      const line = content.slice(0, match.index).split("\n").length;
      const permitted = allow.some((entry) => entry.rule === rule.id && matchesAny(relativePath, [entry.path]) && entry.reason);
      if (!permitted) findings.push({ rule: rule.id, path: relativePath, line, message: rule.message });
    }
  }
}

for (const finding of findings) console.error(`${finding.path}:${finding.line} [${finding.rule}] ${finding.message}`);
if (findings.length > 0) process.exitCode = 1;
else console.log("Foundry API and unsafe-pattern audit passed.");
