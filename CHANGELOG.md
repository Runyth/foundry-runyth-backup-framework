# Changelog

## [1.0.0] - 2026-10-31

- Added generic integration registry with independent Backup, Import and Export capability declarations plus an explicit API-version compatibility gate.
- Added feature-rich declarative schema engine with operation participation, required/optional entries, exact ZIP paths, hierarchy, dependencies, validators, baselines, custom conflict classification, migrations and integration metadata.
- Added setting, document, document-fields, file, JSON-file and custom drivers, plus extensible driver registration.
- Added deterministic hardened ZIP32 STORE archives with CRC-32, per-entry SHA-256, canonical manifest SHA-256, complete-archive SHA-256 and strict structure/size/path gates.
- Added first-class bulk backup/export and multi-ZIP drag/drop import routing by integrity-validated embedded manifests.
- Added configurable one-drop auto-processing, duplicate-module queue protection, one bulk write confirmation and stop-on-first-failure behavior.
- Added partial imports with hierarchical branch selection, non-partial locked entries and recursive dependency closure.
- Added complete conflict review with live target/archive path/reason, per-entry Keep/Merge/Import, nested category rules and reset/cancel controls.
- Added built-in keep/replace/shallow/deep/append/union merges and integration-provided merge strategies.
- Added snapshot-preflight transaction execution so all rollback snapshots complete before the first write; file-backed operations run last.
- Added original-path binary asset restore with Foundry FilePicker upload, user-selected fallback relocation, reference rewrites and explicit incomplete-rollback reporting when public v13 APIs cannot delete newly-created residue.
- Added persistent timestamped hash-chained audit history with store digest, per-event download, verification and tiered retention pruning that records its own maintenance event.
- Added GM-only ApplicationV2 dashboard with resizable geometry persistence/reset, scalable scrollable module/audit/queue browsers, responsive equal-height cards and keyboard-accessible drop handling.
- Added regex settings for module include/exclude and archive filename policy, archive safety/performance limits, conflict defaults, bulk controls, audit retention, reload and dashboard density.
- Added English Foundry localization resources, v13 compatibility boundary, v14 certification checklist and current-v14 API cross-check documentation.
- Added 12 core automated tests, static release audit, deterministic release packaging and documentation/report artifacts.
