# runyth-backup-framework-1.0.0

## Testing and Validation

### Automated core tests

`node --test tests/core.test.mjs`

Coverage in v1.0.0:

1. Deterministic ZIP32 STORE round-trip.
2. ZIP path-traversal rejection and trailing-data rejection.
3. Tiered retention parsing and bucket selection.
4. Registry duplicate/conflict/dependency validation.
5. Deterministic built-in merge strategies.
6. Audit hash-chain/store-digest verification and tamper detection.
7. End-to-end engine archive create -> inspect -> conflict plan -> resolution -> import.
8. Transaction rollback after a later write failure.
9. Per-entry backup/import/export operation filtering.
10. Full snapshot-preflight guarantee: a later snapshot error causes zero writes.
11. Audit pruning appends a maintenance event and leaves the store verifiable.

### Static release audit

`./tools/audit-release.sh`

The audit:

- parses every runtime/test `.mjs` file with Node syntax checking;
- validates `module.json` and English localization JSON;
- rejects selected ApplicationV1/private API markers;
- rejects runtime external HTTP/HTTPS dependencies;
- verifies package ID/version/core compatibility/persistent-storage declarations;
- verifies all manifest runtime paths exist;
- checks templates do not depend on unregistered custom helpers such as `includes` or `eq`.

### Packaging validation

`python tools/package-release.py`

The packager runs tests/audit, creates deterministic source/runtime/docs ZIPs, then reopens every ZIP to verify:

- no duplicate paths;
- runtime `module.json` is at archive root;
- runtime ZIP excludes tests/tools/source-only documentation;
- source ZIP includes the complete project;
- docs ZIP includes implementation/security/API/test/report material;
- generated SHA-256 checksums match the final bytes.

### Live Foundry qualification

This source release includes static and mocked-core testing, but a real Foundry server is not bundled in the build environment. Before changing the manifest's `verified` or `maximum` generation, perform the checklist in `docs/V14-MIGRATION.md` against an actual target Foundry installation.
