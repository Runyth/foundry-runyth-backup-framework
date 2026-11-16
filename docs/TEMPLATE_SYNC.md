# Template synchronization

GitHub template repositories copy files into an unrelated new repository; they
do not create an upstream history relationship. Runyth therefore synchronizes
only declared managed files instead of merging template branches.

The monthly and manually triggered workflow:

1. checks out the module and current template;
2. reads the template's `.runyth/template-managed.json`;
3. applies only the declared managed platform files;
4. merges common package scripts without deleting module dependencies or
   custom scripts;
5. records the pending state in an ephemeral local snapshot so the quality gate
   runs against a clean revision, then resets the snapshot;
6. runs the module quality gate so the synchronized state is verified before it
   is committed;
7. records the applied template version;
8. commits the synchronized standard directly to the module's branch through
   GitHub's commit API. The commit is authored by `github-actions[bot]` and
   signed by GitHub, so it shows as Verified without storing a signing key.

A run with no managed file changes commits nothing, so the recorded sync
timestamp only advances together with real platform changes.

Commits created through the API with the repository token do not trigger
further workflow runs, so the in-workflow gate is the authoritative check for
synchronized commits. A separate automation token or signing secret is
unnecessary.

The commit API describes files as additions and deletions rather than pushing a
tree. The sync tool therefore rejects file-mode changes, symlinks, submodules,
and unresolved conflicts instead of silently dropping them.

Module-owned runtime code, data, manifest, README, changelog, license,
module-specific documentation, and feature tests are never template-sync
targets. Module-owned helpers under a managed tree, such as `tools/module/`, are
preserved because trees are synchronized file by file.

## Managed path modes

- `replace`: overwrite a single file.
- `replace-tree`: replace an entire directory, deleting files that are no
  longer in the template.
- `sync-tree`: overwrite every file that exists in the template directory but
  leave module-owned files inside the same tree untouched.
- `merge-package`: merge shared `package.json` fields and scripts without
  removing module dependencies or custom scripts.
- `merge-ignore`: keep the repository's own ignore lines and append the
  template's missing lines inside a marked managed block. Template lines that a
  later template version drops are carried back into the repository section, so
  nothing becomes silently tracked again.

## Repository-side controls

`runyth.config.json` is module-owned and read by the sync and gate tools:

- `sync.exclude`: keep a path, glob, or package script outside the standard.
  Selectors are exact paths (`tools/build.mjs`), globs (`tools/lib/**`,
  `docs/*.md`), or script pointers (`package.json#scripts.check`). Use this when
  a module owns a bespoke pipeline that the template gate must not replace.
- `format.exclude`: keep generated files (runtime graphs, content indexes,
  bundled entry points) out of the formatting gate.
- `build.preBuild`: run module-specific preparation steps inside the standard
  build.
- `validation.allowFindings`: suppress an audited finding with a written
  reason; the path and rule must both match.

Both workflows check out the complete commit graph and tags because release
pipelines reconstruct Git history for their source archives.

Run locally with:

```nu
node tools/template-sync.mjs --source ../template-foundry-module --root .
```

The template source can never be its own target, so `--root` names the
destination explicitly.
