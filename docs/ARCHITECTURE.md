# runyth-backup-framework-1.0.0

## Architecture

### Runtime layers

1. `scripts/main.mjs` — Foundry lifecycle and scene-control entry point.
2. `scripts/api.mjs` — versioned public API composition.
3. `scripts/registry.mjs` — integration/schema normalization and structural validation.
4. `scripts/engine.mjs` — archive creation, inspection, import planning, conflict classification and transaction orchestration.
5. `scripts/drivers.mjs` — built-in storage drivers and value codecs.
6. `scripts/zip-store.mjs` — deterministic ZIP32 STORE writer and hardened parser.
7. `scripts/integrity.mjs` — SHA-256 and CRC-32.
8. `scripts/audit.mjs` / `scripts/retention.mjs` — persistent hash-chained audit store and retention tiers.
9. `scripts/compat/foundry-v13.mjs` — v13 file, persistent-storage, setting, UUID, dialog and download adapters.
10. `scripts/ui/*` + `templates/*` — ApplicationV2 dashboard, partial selector and conflict resolver.

### Backup/export flow

`registration -> operation-filtered schema -> dependency closure -> driver exists/read -> validation -> codec -> SHA-256 -> manifest -> manifest SHA-256 -> deterministic ZIP -> browser download`

Capture reads are bounded by `concurrentReads`; ZIP construction is synchronous over already-captured byte arrays. No runtime HTTP library or external compression dependency is loaded.

### Import flow

`ZIP bytes -> size gate -> ZIP structure hardening -> embedded manifest -> manifest digest -> payload digests -> registered module routing -> schema migration -> required-entry validation -> user partial selection/dependency closure -> live/baseline reads -> conflict classification -> item/category decisions -> bulk confirmation -> snapshot preflight -> ordered writes -> audit -> optional reload`

All inspection, schema migration, conflict planning and snapshot preflight occur before the first live mutation for that archive.

### Transaction boundary

The atomicity boundary is one archive/module import. Each executable entry is snapshotted before any write begins. Writes are then applied in deterministic plan order with file-backed entries last. A failure rolls back all entries already applied for that archive in reverse order.

Cross-module bulk import is deliberately not represented as one global atomic database transaction because Foundry does not expose a public multi-package transaction API and public FilePicker operations are independently committed. Bulk execution can stop on the first module failure; every module import has its own audit result.

### File rollback boundary

Foundry v13 publicly exposes FilePicker browse/create/upload/persistent upload but not a public arbitrary file-delete method. Therefore:

- overwritten files can be restored from the captured snapshot;
- relocated references can be restored;
- newly created files cannot always be removed with public v13 APIs if a later failure requires rollback;
- this case is surfaced as `failed-rollback-incomplete` with residue paths in the audit log rather than falsely reporting full rollback.

This constraint is why file-backed entries run after setting/document/custom entries.

### Archive format

The framework writes a standards-compatible ZIP32 archive using STORE method only. STORE avoids hidden runtime compression dependencies and makes archive construction deterministic and low-CPU. The framework parser intentionally accepts only the strict subset it writes:

- one disk only;
- ZIP32 only, no ZIP64;
- UTF-8 paths required;
- STORE method only;
- no encryption;
- no unsupported general-purpose flags;
- canonical central-directory placement;
- no trailing data;
- no duplicate paths;
- no absolute, drive-qualified or traversal paths;
- configured archive/entry/count limits;
- local/central metadata must match;
- CRC-32 must match;
- manifest-declared byte length and SHA-256 must match;
- undeclared payload entries are forbidden.

### Manifest routing

The upload filename is a configurable first-stage policy gate. Routing never trusts the filename. `backup-framework.json` inside the archive is authoritative after its digest and payloads have validated. When the configured regex exposes named groups (`module`, `operation`, `moduleVersion`), the dashboard additionally requires those filename values to agree with the embedded manifest.

### Audit storage

`module.json` sets `persistentStorage: true`. The framework stores one world-scoped JSON audit store inside its persistent package `/storage` area. Every audit event has a UUID, ISO timestamp, previous-event hash and event hash. The complete store has a separate digest. Pruning rewrites and re-chains the retained store and appends an `audit-prune` maintenance event.

A single append-only/rewriteable store is intentional: public v13 FilePicker has persistent upload but no public delete operation, whereas retention pruning can be implemented safely by rewriting one persistent index/store.
