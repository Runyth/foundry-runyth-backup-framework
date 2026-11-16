// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { PROJECT_ROOT } from "./lib/project.mjs";

const run = promisify(execFile);
const GRAPHQL_URL = "https://api.github.com/graphql";
const STATE_PATH = ".runyth/template-state.json";
const MESSAGE = "Chore(platform): Synchronize the Runyth repository standard";
const MUTATION = `mutation($input: CreateCommitOnBranchInput!) {
  createCommitOnBranch(input: $input) {
    commit {
      oid
      url
    }
  }
}`;

async function git(cwd, ...args) {
  const { stdout } = await run("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

async function rejectModeChanges(cwd) {
  for (const args of [["diff", "--summary", "--no-renames"], ["diff", "--cached", "--summary", "--no-renames"]]) {
    const summary = await git(cwd, ...args);
    if (/ mode change /u.test(summary)) {
      throw new Error(`Cannot create an API commit for a file mode change: ${summary.trim()}`);
    }
  }
}

async function readAddition(cwd, file) {
  const fullPath = path.join(cwd, file);
  const stats = await lstat(fullPath);
  if (stats.isSymbolicLink()) throw new Error(`Cannot create an API commit for a symlink: ${file}`);
  if (!stats.isFile()) throw new Error(`Cannot create an API commit for a non-file path: ${file}`);
  return { path: file, contents: (await readFile(fullPath)).toString("base64") };
}

export async function collectChanges(cwd = PROJECT_ROOT) {
  await rejectModeChanges(cwd);
  const porcelain = await git(cwd, "status", "--porcelain=v1", "-z", "--untracked-files=all");
  const records = porcelain.split("\0");
  const additions = [];
  const deletions = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const x = record[0];
    const y = record[1];
    const file = record.slice(3);
    const conflicted = x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D");
    if (conflicted) throw new Error(`Cannot create an API commit while a merge is unresolved: ${file}`);
    if (x === "T" || y === "T") throw new Error(`Cannot create an API commit for a type change: ${file}`);
    if (x === "m" || y === "m") throw new Error(`Cannot create an API commit for a submodule change: ${file}`);
    if (x === "R" || x === "C") {
      const source = records[index + 1];
      index += 1;
      if (!source) throw new Error(`Malformed rename record for ${file}`);
      if (x === "R") deletions.push({ path: source });
      additions.push(await readAddition(cwd, file));
      continue;
    }
    if (x === "D" || y === "D") {
      deletions.push({ path: file });
      continue;
    }
    additions.push(await readAddition(cwd, file));
  }

  additions.sort((left, right) => left.path.localeCompare(right.path));
  deletions.sort((left, right) => left.path.localeCompare(right.path));
  return { additions, deletions };
}

export function hasMeaningfulChanges(changes) {
  return changes.deletions.length > 0 || changes.additions.some((entry) => entry.path !== STATE_PATH);
}

export function batchChanges(changes, limit = 100) {
  const units = [
    ...changes.deletions.map((entry) => ({ kind: "deletion", entry })),
    ...changes.additions.map((entry) => ({ kind: "addition", entry })),
  ];
  const batches = [];
  for (let index = 0; index < units.length; index += limit) {
    const slice = units.slice(index, index + limit);
    batches.push({
      additions: slice.filter((unit) => unit.kind === "addition").map((unit) => unit.entry),
      deletions: slice.filter((unit) => unit.kind === "deletion").map((unit) => unit.entry),
    });
  }
  return batches;
}

export async function createCommitOnBranch({
  fetchImpl = fetch,
  token,
  repository,
  branch,
  expectedHeadOid,
  message,
  fileChanges,
}) {
  if (!token) throw new Error("GITHUB_TOKEN is required to create a signed commit.");
  const input = {
    branch: { repositoryNameWithOwner: repository, branchName: branch },
    expectedHeadOid,
    message: {
      headline: message.headline,
      ...(message.body ? { body: message.body } : {}),
    },
    fileChanges: {
      ...(fileChanges.additions.length > 0 ? { additions: fileChanges.additions } : {}),
      ...(fileChanges.deletions.length > 0
        ? { deletions: fileChanges.deletions.map((entry) => ({ path: entry.path })) }
        : {}),
    },
  };
  const response = await fetchImpl(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "runyth-template-sync",
    },
    body: JSON.stringify({ query: MUTATION, variables: { input } }),
  });
  if (!response.ok) {
    const detail = typeof response.text === "function" ? await response.text() : "";
    throw new Error(`GitHub commit API failed (${response.status}): ${detail}`);
  }
  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(`GitHub commit API error: ${payload.errors.map((error) => error.message).join("; ")}`);
  }
  const oid = payload.data?.createCommitOnBranch?.commit?.oid;
  if (!oid) throw new Error("GitHub commit API returned no commit oid.");
  return oid;
}

export async function commitChanges({
  fetchImpl = fetch,
  token,
  repository,
  branch,
  expectedHeadOid,
  changes,
  message,
  limit = 100,
}) {
  const batches = batchChanges(changes, limit);
  let head = expectedHeadOid;
  let oid = null;
  for (let index = 0; index < batches.length; index += 1) {
    const body = batches.length > 1 ? `Part ${index + 1}/${batches.length}` : message.body;
    oid = await createCommitOnBranch({
      fetchImpl,
      token,
      repository,
      branch,
      expectedHeadOid: head,
      message: { headline: message.headline, ...(body ? { body } : {}) },
      fileChanges: batches[index],
    });
    head = oid;
  }
  return oid;
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const branch = process.env.GITHUB_REF_NAME;
  const expectedHeadOid = process.env.GITHUB_SHA ?? (await git(PROJECT_ROOT, "rev-parse", "HEAD")).trim();
  if (!token || !repository || !branch) {
    throw new Error("GITHUB_TOKEN, GITHUB_REPOSITORY, and GITHUB_REF_NAME are required.");
  }
  const changes = await collectChanges();
  if (!hasMeaningfulChanges(changes)) {
    console.log("No managed template changes.");
    return;
  }
  const oid = await commitChanges({
    token,
    repository,
    branch,
    expectedHeadOid,
    changes,
    message: { headline: MESSAGE },
  });
  console.log(`Created signed sync commit ${oid}.`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) await main();
