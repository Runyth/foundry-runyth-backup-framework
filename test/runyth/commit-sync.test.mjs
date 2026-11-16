// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  batchChanges,
  collectChanges,
  commitChanges,
  createCommitOnBranch,
  hasMeaningfulChanges,
} from "../../tools/commit-sync.mjs";

const run = promisify(execFile);

async function git(root, ...args) {
  const { stdout } = await run("git", args, { cwd: root });
  return stdout;
}

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "runyth-commit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, "init", "-q");
  await git(root, "config", "user.name", "Test");
  await git(root, "config", "user.email", "test@example.invalid");
  await writeFile(path.join(root, "alpha.txt"), "alpha\n");
  await writeFile(path.join(root, "beta.txt"), "beta\n");
  await git(root, "add", "--all");
  await git(root, "commit", "-qm", "initial");
  return root;
}

test("collectChanges reports additions, modifications, and deletions with base64 contents", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "alpha.txt"), "alpha changed\n");
  await writeFile(path.join(root, "added.txt"), "added\n");
  await rm(path.join(root, "beta.txt"));

  const changes = await collectChanges(root);

  assert.deepEqual(changes.additions.map((entry) => entry.path), ["added.txt", "alpha.txt"]);
  assert.equal(Buffer.from(changes.additions[0].contents, "base64").toString(), "added\n");
  assert.equal(Buffer.from(changes.additions[1].contents, "base64").toString(), "alpha changed\n");
  assert.deepEqual(changes.deletions.map((entry) => entry.path), ["beta.txt"]);
});

test("a template-state-only change is not meaningful, but a real change is", async (t) => {
  const root = await fixture(t);
  await mkdir(path.join(root, ".runyth"), { recursive: true });
  await writeFile(path.join(root, ".runyth/template-state.json"), "{}\n");

  const stateOnly = await collectChanges(root);
  assert.equal(hasMeaningfulChanges(stateOnly), false);

  await writeFile(path.join(root, "alpha.txt"), "real change\n");
  const withReal = await collectChanges(root);
  assert.equal(hasMeaningfulChanges(withReal), true);
});

test("batchChanges chunks 100 at a time and puts deletions first", () => {
  const additions = Array.from({ length: 205 }, (_, index) => ({ path: `file-${index}.txt`, contents: "" }));
  const deletions = [{ path: "gone.txt" }, { path: "also-gone.txt" }];

  const batches = batchChanges({ additions, deletions }, 100);

  assert.equal(batches.length, 3);
  assert.deepEqual(batches[0].deletions.map((entry) => entry.path), ["gone.txt", "also-gone.txt"]);
  assert.equal(batches[0].additions.length, 98);
  assert.equal(batches[1].additions.length, 100);
  assert.equal(batches[2].additions.length, 7);
});

test("createCommitOnBranch sends the signed-commit mutation and returns the oid", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      async json() {
        return { data: { createCommitOnBranch: { commit: { oid: "abc123", url: "https://example.invalid/abc123" } } } };
      },
    };
  };

  const oid = await createCommitOnBranch({
    fetchImpl,
    token: "secret-token",
    repository: "Runyth/demo",
    branch: "master",
    expectedHeadOid: "head123",
    message: { headline: "Chore(platform): Synchronize the Runyth repository standard" },
    fileChanges: {
      additions: [{ path: "alpha.txt", contents: Buffer.from("alpha\n").toString("base64") }],
      deletions: [{ path: "beta.txt" }],
    },
  });

  assert.equal(oid, "abc123");
  assert.equal(calls[0].url, "https://api.github.com/graphql");
  assert.equal(calls[0].options.headers.Authorization, "Bearer secret-token");
  const body = JSON.parse(calls[0].options.body);
  assert.match(body.query, /createCommitOnBranch/u);
  assert.deepEqual(body.variables.input, {
    branch: { repositoryNameWithOwner: "Runyth/demo", branchName: "master" },
    expectedHeadOid: "head123",
    message: { headline: "Chore(platform): Synchronize the Runyth repository standard" },
    fileChanges: {
      additions: [{ path: "alpha.txt", contents: Buffer.from("alpha\n").toString("base64") }],
      deletions: [{ path: "beta.txt" }],
    },
  });
});

test("commitChanges advances the expected head and labels multiple batches", async () => {
  const heads = [];
  const messages = [];
  const fetchImpl = async (url, options) => {
    const input = JSON.parse(options.body).variables.input;
    heads.push(input.expectedHeadOid);
    messages.push(input.message);
    return {
      ok: true,
      async json() {
        return { data: { createCommitOnBranch: { commit: { oid: `oid-${heads.length}` } } } };
      },
    };
  };
  const changes = {
    additions: [
      { path: "one.txt", contents: "" },
      { path: "two.txt", contents: "" },
    ],
    deletions: [{ path: "gone.txt" }],
  };

  const oid = await commitChanges({
    fetchImpl,
    token: "secret-token",
    repository: "Runyth/demo",
    branch: "master",
    expectedHeadOid: "head-0",
    changes,
    message: { headline: "Chore(platform): Synchronize the Runyth repository standard" },
    limit: 2,
  });

  assert.equal(oid, "oid-2");
  assert.deepEqual(heads, ["head-0", "oid-1"]);
  assert.equal(messages[0].body, "Part 1/2");
  assert.equal(messages[1].body, "Part 2/2");
});

test("collectChanges rejects symlinks the API cannot represent", async (t) => {
  const root = await fixture(t);
  await symlink("alpha.txt", path.join(root, "linked.txt"));

  await assert.rejects(() => collectChanges(root), /symlink/u);
});

test("collectChanges rejects file-mode changes the API cannot represent", async (t) => {
  const root = await fixture(t);
  await chmod(path.join(root, "alpha.txt"), 0o755);

  await assert.rejects(() => collectChanges(root), /mode change/u);
});
