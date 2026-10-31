# runyth-backup-framework-1.0.0

## Backup Implementation Specification

### 1. Package contract

- Package ID: `runyth-backup-framework`.
- Version: `1.0.0`.
- Target: Foundry Virtual Tabletop v13 only; manifest `minimum=13`, `verified=13`, `maximum=13`.
- Game-system dependency: none.
- Foundry module dependency: none.
- Runtime network dependency: none.
- Persistent package storage: enabled with `persistentStorage: true` for audit data.
- Public integration API: `game.modules.get("runyth-backup-framework").api`, API generation `1`.
- Registration-ready hook: `runythBackupFrameworkReady`.
- User-facing module; it is not marked `library: true` because Foundry defines library modules as having no user-facing functionality.

### 2. Integration contract

Each integrating module registers exactly one runtime definition containing:

- stable `moduleId`;
- title/description;
- SemVer `moduleVersion` value or provider;
- supported framework API range;
- any non-empty subset of `backup`, `import`, `export`;
- schema ID and positive integer schema version;
- schema metadata value/provider;
- static or async schema-entry list;
- optional ordered schema migrations;
- optional named custom merge strategies;
- optional lifecycle hooks.

The framework, not the integration, implements ZIP I/O, archive naming, integrity, upload routing, bulk handling, partial selection, conflict UI, category rules, transaction preflight, rollback orchestration, fallback file destination UI, audit and reload UX.

### 3. Schema entry contract

Every entry declares:

- unique stable ID;
- human label/description;
- hierarchical category path;
- operation participation (`backup`/`import`/`export`), default all;
- codec (`json`, `text`, `binary`), default JSON;
- required flag, default true;
- partial flag, default true;
- dependency entry IDs;
- unique safe relative ZIP path;
- optional JSON metadata;
- storage driver;
- optional value validator;
- conflict actions from Keep/Merge/Import;
- merge strategy when Merge is allowed;
- baseline auto-import flag;
- optional custom conflict classifier.

Schema validation rejects duplicate IDs, duplicate ZIP paths, unknown dependencies, invalid operation/codec/conflict names, merge-without-strategy, malformed archive paths and unsupported framework API ranges.

### 4. Built-in storage drivers

- `setting`: Foundry registered setting, optional nested path; default value supplies baseline.
- `document`: UUID-resolved Foundry Document, optional update path, optional declared baseline.
- `document-fields`: UUID-resolved Document with an explicit set of paths captured/written together.
- `file`: binary Data-source file with original-path restore, optional baseline SHA-256/missing marker, fallback directory relocation, and setting/document/custom reference rewrites.
- `json-file`: JSON Data-source file with optional baseline.
- `custom`: integration-supplied exists/read/baseline/snapshot/apply/rollback functions.

Custom driver type factories can additionally be registered through `api.drivers.register(type, factory)`.

### 5. Backup/export creation

For one module and one operation:

1. Require a registered integration implementing the operation.
2. Expand/normalize entries for that operation.
3. Apply explicit selection, recursively include dependencies, and force every `partial:false` entry into the selection.
4. Run `beforeArchive`.
5. Read selected entries with bounded concurrency from `concurrentReads`.
6. If a driver reports missing and entry is required, abort. If optional, omit it.
7. Run entry validator with archive phase.
8. Encode value as JSON UTF-8, text UTF-8 or raw binary.
9. SHA-256 every encoded payload.
10. Resolve integrating-module SemVer and JSON schema metadata.
11. Build manifest with format/API/framework/schema/module/world/time metadata and exact payload descriptors.
12. SHA-256 canonical manifest data as `manifestDigest`.
13. Write `backup-framework.json` plus every payload into deterministic ZIP32 STORE archive.
14. Filename: `<moduleId>-<backup|export>-<moduleVersion>-<UTC YYYYMMDDTHHMMSSZ>.zip`.
15. Download with browser `Blob`/object URL; Foundry `saveDataToFile` is not used for binary ZIP data because its v13 public signature accepts string data.
16. Run `afterArchive`.

### 6. ZIP format and integrity gates

The internal ZIP implementation writes and accepts only its deterministic subset:

- ZIP32, single disk;
- STORE method; no compression;
- UTF-8 paths;
- no encryption;
- no unsupported flags;
- no ZIP64;
- canonical central directory immediately before EOCD;
- no trailing bytes;
- no duplicate paths;
- no empty, absolute, drive-qualified, traversal or NUL paths;
- configured archive-byte, entry-byte and entry-count ceilings;
- local and central names/flags/method/CRC/sizes must agree;
- CRC-32 validates each ZIP record payload;
- embedded manifest digest must match SHA-256;
- each declared payload length and SHA-256 must match;
- every declared payload must exist;
- every ZIP file must be declared; undeclared files are rejected.

Complete uploaded archive SHA-256 is computed after read and included in audit records.

### 7. Bulk upload/routing

- Dashboard accepts multiple files via input or drag/drop.
- Non-ZIP files are rejected into the visible queue.
- Configured `archiveFilenameRegex` is a first gate.
- ZIP is fully inspected before route selection.
- Embedded manifest `moduleId` is authoritative route.
- If default/named regex groups are present, filename module/operation/version must agree with the manifest.
- Target module must be registered and implement Import.
- A second pending archive for the same module is rejected until the first is removed/completed/cancelled, preventing silent sequential overwrite ambiguity.
- Queue items can be removed.
- `autoProcessDrop` can immediately start clean bulk processing; disabling it leaves the queue available for partial customization.

### 8. Partial import

- Partial-import window lists only archived entries that are importable under the current schema.
- Categories are represented as scalable, scrollable hierarchical branches.
- User may select/clear an entire branch or individual entry.
- `partial:false` entries are locked selected.
- On plan creation, recursive dependency closure is applied.
- Unknown selections and non-importable selections are rejected.
- Required import entries missing from the archive are rejected before any write.

### 9. Schema migration

- Archive schema ID must equal current registration schema ID.
- If archive schema version is lower, repeatedly select migration whose `from` equals current version and execute `migrate({manifest, zip})`.
- Set result version to migration `to` and continue.
- Missing migration step aborts.
- Future schema version aborts.
- After migration, current entry definitions validate archive IDs and required import presence.

### 10. Conflict classification

For each selected entry:

1. Decode incoming payload according to current codec.
2. Run import-phase entry validator.
3. Read live value.
4. Read baseline.
5. Default classifier:
   - exact live/incoming equality -> `same`;
   - absent live -> `safe-import`;
   - live equals declared baseline -> `safe-import` when baseline auto-import is enabled, otherwise `conflict`;
   - everything else -> `conflict`.
6. Binary equality is byte equality; optional file baseline uses SHA-256.
7. Optional custom classifier may return only `same`, `safe-import`, `conflict`.
8. Resolution default:
   - same -> Keep;
   - safe-import -> Import;
   - conflict -> configured global Keep/Import policy if allowed, otherwise unresolved Ask; a sole allowed action auto-resolves.

### 11. Conflict UX

When any selected entry is conflicted:

- one resizable ApplicationV2 resolver opens;
- all planned entries are shown, not only conflicts;
- each row shows ID, label, hierarchical category, classification, archive path, live target, reason, live preview and incoming preview;
- per-entry buttons expose only declared Keep/Merge/Import actions;
- category panel contains every hierarchy prefix, allowing branch rules such as Keep all Terminus and Import all Dividers;
- branch application affects only entries that allow the requested action;
- Reset Decisions restores initial automatic/default decisions;
- Continue is blocked while any conflict is unresolved;
- Cancel closes with no live mutation.

Built-in merges: keep, replace, shallow-object, deep-object, append-unique, union-by-id; registration may add named custom merge functions.

### 12. Bulk confirmation/execution

- Dashboard prepares every pending archive first.
- Conflict decisions are completed before bulk write confirmation.
- With `confirmWrites=true`, one DialogV2 confirmation covers all prepared archives and total selected elements.
- Cancelling marks prepared items cancelled and writes nothing.
- Each archive is then executed with its redundant per-archive confirmation suppressed.
- Each archive has its own transaction/audit boundary.
- `stopBulkOnFailure=true` stops later archive execution after a failure; already successful archive transactions remain committed.
- Automatic reload is offered only when at least one archive succeeded and no archive execution failed.

### 13. Per-archive transaction algorithm

1. Assert every conflict has a resolution.
2. If called outside bulk orchestration and confirmations are enabled, confirm this import.
3. Run non-mutating `beforeImport` hook.
4. Resolve final value for every write (incoming or merge result).
5. Order file/json-file entries after other entry types.
6. Call `snapshot()` for every write operation before applying any write.
7. If any snapshot fails, zero writes occur; append failure audit with successful rollback status because transaction is empty.
8. Apply writes sequentially.
9. After each successful apply, add item change record.
10. On complete success, append success audit, then run `afterImport`.
11. On failure, rollback already-applied entries in reverse order.
12. Collect rollback failures rather than hiding them.
13. Append `failed-rolled-back` when rollback fully succeeds, or `failed-rollback-incomplete` when any rollback fails.
14. Re-throw the original error with rollback error details attached.

### 14. File import/fallback algorithm

For `file` driver:

1. Snapshot original file bytes if present and every relocation reference value.
2. Attempt upload to declared original path.
3. If success, record whether path was newly created.
4. If upload throws, re-check original path.
5. If original existed and still exists, restore snapshotted original bytes before fallback.
6. If original did not exist but now exists after failed upload, abort: v13 public FilePicker has no documented arbitrary delete operation, so safe cleanup cannot be guaranteed.
7. If relocation forbidden, rethrow.
8. Open Foundry folder picker; close/cancel returns no path and aborts into transaction rollback.
9. Construct fallback path from selected directory and declared/original filename.
10. Snapshot pre-existing fallback file if any.
11. Upload incoming bytes to fallback path.
12. Rewrite declared setting/document/custom references to fallback path.
13. On later rollback, restore references first, restore pre-existing fallback bytes, restore original bytes.
14. Any newly-created file that requires deletion is reported as residue through rollback error because private delete endpoints are not used.

### 15. Audit implementation

- Manifest `persistentStorage:true` preserves module `/storage` across updates.
- Store file: `audit-store-<sanitizedWorldId>.json` inside framework persistent storage.
- Store fields: format ID, format version, world ID, entries array, store digest.
- Every event: UUID, ISO timestamp, previous hash, operation/status/details, event SHA-256 hash.
- Import success/failure records include integrating module/version, archive ID, complete archive SHA-256, user ID and per-entry action/live/incoming/result summaries.
- Store digest is SHA-256 over canonical store with `digest:null`.
- Verification checks store digest, every event hash and previous-hash chain.
- Diagnostics lists events newest first in a scrollable list.
- Selected event downloads as canonical JSON text through Foundry `saveDataToFile`.
- Prune parses configured tier policy, retains newest event per period bucket where applicable, sorts chronologically, re-chains all retained entries, appends an `audit-prune` maintenance event, seals and overwrites the single persistent store.
- Default retention: all 0-7d; daily 8-30d; weekly 31-180d; monthly 181-730d; yearly thereafter.

### 16. Dashboard and settings

Dashboard:

- GM-only scene-control entry on Token controls;
- ApplicationV2 + HandlebarsApplicationMixin;
- resizable;
- client geometry persisted with 250 ms debounce and reset action;
- Registered Modules, Bulk Operations, Import Queue and Diagnostics tabs;
- scalable scroll containers;
- hierarchical branch selectors instead of giant flat select elements;
- responsive/equalized card layouts;
- keyboard-accessible buttons and Enter/Space activation on drop zone.

World settings:

- archive filename regex;
- module include regex;
- module exclude regex;
- maximum archive MiB;
- maximum entry MiB;
- maximum entries;
- concurrent capture reads;
- default conflict policy;
- audit retention expression;
- auto-process dropped ZIPs;
- stop bulk on first failure;
- auto-reload offer after fully successful import batch;
- confirm writes.

Client settings:

- dashboard density;
- hidden dashboard geometry.

### 17. Foundry v13 public API usage

Foundry lifecycle/package/UI:

- `Hooks.once`, `Hooks.on`, `Hooks.callAll`.
- `game.modules.get(...)` and package `.api` exposure.
- `game.user`, `game.world`, `game.version` / `game.release.version`.
- `getSceneControlButtons` hook using v13 record-based scene controls.
- `foundry.applications.api.ApplicationV2`.
- `foundry.applications.api.HandlebarsApplicationMixin`.
- `foundry.applications.api.DialogV2.confirm`.
- `ui.notifications`.

Settings/documents:

- `game.settings.register`, `game.settings.get`, `game.settings.set`, registered-setting metadata collection.
- `foundry.utils.fromUuid`.
- resolved Document `toObject()` and `update()`.

File/storage:

- `foundry.applications.apps.FilePicker`.
- `FilePicker.createDirectory("data", target)`.
- `FilePicker.browse("data", target)`.
- `FilePicker.upload("data", directory, File, {}, {notify:false})`.
- `FilePicker.uploadPersistent(packageId, relativePath, File, {}, {notify:false})`.
- `new FilePicker({type:"folder", current, callback})` for fallback directory selection.
- `foundry.utils.srcExists(path)`.
- `foundry.utils.getRoute(path)` plus authenticated same-origin browser `fetch` for binary reads.
- `foundry.utils.saveDataToFile(string, mime, filename)` only for textual audit export.
- browser `File`, `Blob`, `URL.createObjectURL`, hidden anchor click for binary ZIP download.
- browser `crypto.subtle.digest("SHA-256", ...)` and `crypto.randomUUID()`.

Official v13 references:

- https://foundryvtt.com/api/v13/
- https://foundryvtt.com/api/v13/classes/foundry.applications.api.ApplicationV2.html
- https://foundryvtt.com/api/v13/classes/foundry.applications.apps.FilePicker.html
- https://foundryvtt.com/api/v13/functions/hookEvents.getSceneControlButtons.html
- https://foundryvtt.com/article/module-development/

### 18. Foundry v14 gate

`module.json` deliberately blocks v14 until certified. Current v14 Stable public documentation still exposes ApplicationV2, FilePicker including `uploadPersistent`, the `getSceneControlButtons` hook, `persistentStorage`, `foundry.utils.fromUuid`, `srcExists`, `getRoute` and `saveDataToFile`. Therefore v1.0.0 is structured for a small compatibility promotion rather than a rewrite, but no v14 compatibility is claimed until live qualification.

Required v14 checks:

- ApplicationV2 actions/render/position/scroll behavior;
- DialogV2 confirm contract;
- FilePicker folder picker, create/browse/upload/persistent upload semantics and permissions;
- Data-route binary reads;
- persistent storage survival across module update;
- settings scopes/object values;
- scene-control hook control/tool object shape;
- Document updates/UUID resolution;
- dependency initialization ordering and optional ready hook;
- all archive/integrity/conflict/partial/rollback/audit workflows;
- ten-module bulk backup/import on a clean second world/instance.

Only after those pass should the package compatibility maximum/verified generation be changed from 13 to 14.

Official v14 references:

- https://foundryvtt.com/api/v14/
- https://foundryvtt.com/api/v14/classes/foundry.applications.api.ApplicationV2.html
- https://foundryvtt.com/api/v14/classes/foundry.applications.apps.FilePicker.html
- https://foundryvtt.com/api/v14/modules/hookEvents.html
- https://foundryvtt.com/api/v14/interfaces/foundry.packages.types.ModuleManifestData.html
- https://foundryvtt.com/api/v14/modules/foundry.utils.html

### 19. Explicit limits

- One archive/module import is transactional; a multi-module batch is not one global Foundry database transaction.
- Public v13 FilePicker lacks arbitrary delete, so rollback cannot guarantee deletion of files newly created before a later failure; such residue is explicitly audited as incomplete rollback.
- Built-in `document` whole-object mode uses `Document#update`; exact deletion/replacement semantics require explicit fields or a custom driver.
- Built-in file drivers target the Foundry Data source. Integrations needing S3/custom storage use a custom driver.
- ZIP compression is intentionally not used; STORE favors deterministic, low-CPU, dependency-free handling and removes decompression-bomb expansion risk at the cost of larger archives.
- Runtime release does not contain a Foundry server; v13/v14 live-client qualification must be performed in an actual Foundry installation in addition to included automated/static tests.
