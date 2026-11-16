# Adopt an existing module

## Safety model

The adoption tool copies module-owned material while protecting centrally
managed repository files. It does not rewrite runtime JavaScript, rename flags,
change pack IDs, or migrate stored data.

## Procedure

1. Create a repository from the Runyth template.
2. Clone it beside the complete existing source tree.
3. Run a dry run:

```nu
npm run adopt -- --source ../existing-module-source
```

4. Review the proposed file list.
5. Apply it:

```nu
npm run adopt -- --source ../existing-module-source --apply
```

6. Review `docs/ADOPTION_REPORT.md`.
7. Run `npm run format` and `npm run check`.
8. Correct genuine policy failures without changing stable behavior.
9. Perform the module's live Foundry acceptance checklist.

## Preserved automatically

- the source `module.json`;
- runtime directories and manifest-referenced paths;
- README, changelog, license, module documentation, and module tests;
- package dependencies and non-conflicting custom package scripts;
- module IDs, versions, relationships, packs, and public URLs.

## Intentionally not imported

- `.git/`, release artifacts, caches, dependencies, and credentials;
- old CI and repository-wide generic tooling;
- old shared scripts whose role is replaced by the Runyth platform layer.

Module-specific tools can be moved under `tools/module/` after review and then
referenced through `build.preBuild`.

## Existing module profiles

See `docs/MODULE_ADOPTION_MATRIX.md` for all currently known Runyth modules and
the recommended starting kind. The template does not require simultaneous
runtime rewrites. First standardize delivery; refactor internals only through
normal versioned changes with regression tests.
