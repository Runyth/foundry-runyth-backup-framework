# runyth-backup-framework-1.0.0

## Security and Safety Model

### Trust boundary

Backup ZIPs are treated as untrusted input even if they were produced by the framework. The parser validates structure and all integrity data before any integrating-module driver is invoked.

### ZIP hardening

The parser rejects path traversal, absolute paths, drive-qualified paths, NUL paths, duplicate paths, encryption, unsupported flags, non-STORE compression, ZIP64, multi-disk archives, malformed/truncated records, local/central-header disagreement, CRC mismatch, trailing bytes and undeclared files.

World settings bound:

- total archive bytes;
- individual entry bytes;
- entry count;
- concurrent capture reads.

These gates reduce ZIP-bomb/memory-abuse and malformed-archive risk. STORE-only input additionally avoids decompression expansion risk.

### Cryptographic integrity

Each payload has SHA-256 in the manifest. The canonical manifest has its own SHA-256 digest. Inspection also calculates SHA-256 for the complete uploaded archive; that digest is persisted with the import audit event. SHA-256 is computed through the browser Web Crypto API.

CRC-32 is used only as the normal ZIP transport checksum and is never treated as a cryptographic integrity primitive.

### Schema allow-list

An imported payload must be declared by the embedded manifest, and every manifest entry must map to the current registered schema after migration. Unknown archive entries are rejected. Import-only exclusions are not written merely because they happen to exist in a ZIP.

### Mutation sequencing

1. Archive integrity validation.
2. Schema/version validation and migration.
3. Required-entry validation.
4. Optional partial-selection closure.
5. Read live state and baseline.
6. Resolve all conflicts.
7. User confirmation.
8. `beforeImport` integration hook.
9. Snapshot every planned write.
10. Apply writes.
11. Roll back in reverse order if any write fails.
12. Persist success/failure audit.
13. Run `afterImport` only after success audit persistence.

The `beforeImport` hook is specified as non-mutating. Integrations that mutate live state there are outside the framework transaction contract.

### File mutation limitation

Foundry v13 does not document a public FilePicker delete operation. The framework does not call private server endpoints to manufacture one. If a newly-created file would need deletion during rollback, the framework restores all state it can and records `failed-rollback-incomplete` plus residue paths. It never claims complete rollback in that case.

### File relocation

A file entry attempts its declared original Data-source path first. If that fails:

- if an overwritten original can be restored, it is restored before fallback;
- if a failed upload appears to have created a previously absent original file, import aborts because public cleanup cannot be guaranteed;
- if relocation is allowed, the user chooses a destination with Foundry's folder picker;
- any pre-existing fallback file is snapshotted before overwrite;
- declared references are snapshotted and rewritten only after fallback upload;
- cancelling the picker throws into transaction rollback.

### HTML/UI data

Handlebars escapes integration-provided values by default. Dynamic content interpolated into DialogV2 HTML is HTML-escaped before insertion. Archive payload contents are displayed only as text previews.

### Permissions

The dashboard entry point is GM-only. Actual Foundry setting/document/file writes continue to be constrained by Foundry's own permissions and server-side FilePicker authorization. A permission rejection causes import failure and rollback.

### Private API policy

Runtime code intentionally avoids private/underscore Foundry APIs and does not hard-code Foundry server upload endpoints. Release audit scans runtime sources for selected private/deprecated API markers and external runtime URLs.
