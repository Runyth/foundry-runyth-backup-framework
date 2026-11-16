// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT, pathExists, walkFiles } from "./lib/project.mjs";
import { matchesAny } from "./lib/glob.mjs";
import { stableJson } from "./lib/text.mjs";

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const sourceValue = valueAfter("--source");
if (!sourceValue) throw new Error("Usage: npm run adopt -- --source <existing-source> [--apply]");
const apply = process.argv.includes("--apply");
const requestedRepository = valueAfter("--repository");
const source = path.resolve(PROJECT_ROOT, sourceValue);
if (!(await pathExists(path.join(source, "module.json")))) throw new Error("The source does not contain module.json.");
const managed = JSON.parse(await readFile(path.join(PROJECT_ROOT, ".runyth/template-managed.json"), "utf8"));
const protectedPatterns = managed.entries.map((entry) => entry.path.endsWith("/") ? `${entry.path}**` : entry.path).concat([
  ".git/**", ".github/**", ".runyth/**", "node_modules/**", "dist/**", "coverage/**", "tools/**", ".editorconfig", ".gitattributes", ".gitignore", ".node-version", ".nvmrc", ".npmrc", "mise.toml", "package-lock.json", "package.json", "runyth.config.json"
]);
const sourceFiles = await walkFiles(source);
const copyFiles = sourceFiles.filter((file) => !matchesAny(file, protectedPatterns));
console.log(`${apply ? "Applying" : "Dry run:"} ${copyFiles.length} module-owned files from ${source}.`);
for (const file of copyFiles) console.log(`  ${file}`);
if (!apply) {
  console.log("Re-run with --apply after reviewing the list.");
  process.exit(0);
}
for (const scaffoldPath of ["scripts/main.js", "scripts/runyth", "styles/runyth-module.css", "lang/en.json", "lang/de.json"]) {
  await rm(path.join(PROJECT_ROOT, scaffoldPath), { recursive: true, force: true });
}
for (const relativePath of copyFiles) {
  const target = path.join(PROJECT_ROOT, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(path.join(source, relativePath), target);
}

const sourceManifest = JSON.parse(await readFile(path.join(source, "module.json"), "utf8"));
const targetPackage = JSON.parse(await readFile(path.join(PROJECT_ROOT, "package.json"), "utf8"));
if (await pathExists(path.join(source, "package.json"))) {
  const sourcePackage = JSON.parse(await readFile(path.join(source, "package.json"), "utf8"));
  targetPackage.dependencies = sourcePackage.dependencies ?? targetPackage.dependencies;
  targetPackage.devDependencies = sourcePackage.devDependencies ?? targetPackage.devDependencies;
  for (const [name, command] of Object.entries(sourcePackage.scripts ?? {})) {
    if (!(name in targetPackage.scripts)) targetPackage.scripts[name] = command;
  }
}
const repository = requestedRepository ?? `Runyth/${sourceManifest.id}`;
if (!/^Runyth\/[A-Za-z0-9._-]+$/u.test(repository)) throw new Error("--repository must be Runyth/<repository>.");
const repositoryUrl = `https://github.com/${repository}`;
sourceManifest.url = repositoryUrl;
sourceManifest.manifest = `${repositoryUrl}/releases/latest/download/module.json`;
sourceManifest.download = `${repositoryUrl}/releases/download/v${sourceManifest.version}/${sourceManifest.id}-v${sourceManifest.version}-mod.zip`;
sourceManifest.readme = `${repositoryUrl}/blob/master/README.md`;
sourceManifest.changelog = `${repositoryUrl}/blob/master/CHANGELOG.md`;
sourceManifest.bugs = `${repositoryUrl}/issues`;
await writeFile(path.join(PROJECT_ROOT, "module.json"), stableJson(sourceManifest));

targetPackage.name = `@runyth/${sourceManifest.id}`;
targetPackage.version = sourceManifest.version;
targetPackage.description = sourceManifest.description ?? sourceManifest.title;
targetPackage.repository = { type: "git", url: `git+${repositoryUrl}.git` };
await writeFile(path.join(PROJECT_ROOT, "package.json"), stableJson(targetPackage));

const sourceLockPath = path.join(source, "package-lock.json");
const targetLockPath = path.join(PROJECT_ROOT, "package-lock.json");
if (await pathExists(sourceLockPath)) {
  const sourceLock = JSON.parse(await readFile(sourceLockPath, "utf8"));
  sourceLock.name = targetPackage.name;
  sourceLock.version = sourceManifest.version;
  if (sourceLock.packages?.[""]) {
    sourceLock.packages[""].name = targetPackage.name;
    sourceLock.packages[""].version = sourceManifest.version;
  }
  await writeFile(targetLockPath, stableJson(sourceLock));
} else {
  const targetLock = JSON.parse(await readFile(targetLockPath, "utf8"));
  targetLock.name = targetPackage.name;
  targetLock.version = sourceManifest.version;
  if (targetLock.packages?.[""]) {
    targetLock.packages[""].name = targetPackage.name;
    targetLock.packages[""].version = sourceManifest.version;
  }
  await writeFile(targetLockPath, stableJson(targetLock));
}

const config = JSON.parse(await readFile(path.join(PROJECT_ROOT, "runyth.config.json"), "utf8"));
config.template.source = false;
config.module.repository = repository;
const commonRuntimeRoots = ["scripts", "styles", "templates", "lang", "packs", "assets", "data", "fonts", "icons", "media", "sounds", "ui", "vendor"];
for (const root of commonRuntimeRoots) {
  if (await pathExists(path.join(PROJECT_ROOT, root)) && !config.build.include.includes(`${root}/**`)) config.build.include.push(`${root}/**`);
}
await writeFile(path.join(PROJECT_ROOT, "runyth.config.json"), stableJson(config));

const report = `# Adoption report\n\n- Source: \`${source}\`\n- Module ID: \`${sourceManifest.id}\`\n- Version: \`${sourceManifest.version}\`\n- Imported module-owned files: ${copyFiles.length}\n- Centrally managed files protected: ${protectedPatterns.length}\n\n## Required review\n\n- [ ] Confirm settings and flag namespaces are unchanged.\n- [ ] Confirm pack IDs, paths, and document UUIDs are unchanged.\n- [ ] Confirm public hooks and APIs are unchanged.\n- [ ] Move genuinely module-specific legacy build helpers under \`tools/module/\` if still required.\n- [ ] Regenerate \`package-lock.json\` with \`npm install --package-lock-only\`.\n- [ ] Run \`npm run format\` and \`npm run check\`.\n- [ ] Complete live Foundry acceptance.\n`;
await mkdir(path.join(PROJECT_ROOT, "docs"), { recursive: true });
await writeFile(path.join(PROJECT_ROOT, "docs/ADOPTION_REPORT.md"), report);
console.log("Adoption applied. Review docs/ADOPTION_REPORT.md before committing.");
