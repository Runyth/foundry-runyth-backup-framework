# Testing and validation

`npm run check` executes the complete deterministic gate:

1. formatting verification;
2. manifest, package, path, import, and localization validation;
3. deprecated/private/unsafe Foundry API audit;
4. Node unit and regression tests;
5. deterministic install and source builds;
6. archive root, content, manifest, version, and checksum verification.

Shared tests live under `test/runyth/`. Module tests live elsewhere under
`test/` and are never overwritten by template synchronization.

Static validation cannot prove browser rendering, permissions, socket behavior,
Foundry document migrations, or independent GM/player state. Each interactive
module must maintain a live Foundry acceptance checklist and record actual
results without converting pending checks into passes.
