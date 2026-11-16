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
5. runs the module quality gate so the synchronized state is verified before it
   is committed;
6. records the applied template version;
7. commits the synchronized standard directly to the module's branch through
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

Run locally with:

```nu
npm run template:sync -- --source ../template-foundry-module
```
