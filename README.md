# Runyth Backup Framework

A system-agnostic Foundry Virtual Tabletop v13 framework module for reliable ZIP-based backup, import and export integration.

The framework is intentionally user-facing as well as API-facing: it provides the central dashboard, archive engine, schema engine, integrity gates, conflict-resolution UX, partial-import UX, bulk operations, transaction orchestration, file relocation handling and persistent audit trail. Integrating modules define only their module identity, supported capabilities and declarative data schema; custom callbacks are needed only for storage models the built-in drivers cannot represent.

## Primary characteristics

- Foundry v13 compatibility is explicitly gated in `module.json` with `minimum`, `verified` and `maximum` set to `13`.
- The module has no Foundry module dependency and no runtime network dependency.
- Integrating modules may require or optionally integrate `runyth-backup-framework`.
- Each integration independently declares `backup`, `import` and/or `export` capabilities.
- Backup and export outputs are deterministic ZIP32 STORE archives with an embedded manifest, CRC-32 at ZIP level, SHA-256 per payload, and SHA-256 manifest integrity.
- Multi-ZIP drag/drop routes archives by the embedded manifest after filename-policy and integrity validation.
- Clean bulk imports can auto-process after a drop; imports use one bulk confirmation rather than one confirmation per archive.
- Partial imports support hierarchical category selection and dependency closure.
- Conflict resolution supports per-entry Keep / Merge / Import decisions and hierarchical category/subcategory rules.
- Import mutations are snapshot-preflighted before the first write and rolled back in reverse order on failure.
- File imports target their declared original paths first and can fall back to a Foundry folder picker when relocation is allowed.
- Every completed or failed import is written to the persistent audit store with timestamp, archive digest and item-level changes.
- Audit history is hash-chained, store-digested, downloadable per event, verifiable and prunable with tiered retention.
- The dashboard uses ApplicationV2, resizable windows, persisted geometry, scalable scrollable selectors and responsive equal-height cards.
- Archive/module filters and archive naming policy support regular expressions through normal Foundry world settings.

## Integration entry point

The versioned API is exposed after framework initialization at:

`game.modules.get("runyth-backup-framework").api`

Optional integrations can also subscribe before `init` to the framework hook:

`runythBackupFrameworkReady`

Required integrations should declare the framework under `relationships.requires` in their own `module.json` so Foundry loads the dependency appropriately.

## Documentation

- `docs/INTEGRATION.md` — minimal and advanced integration patterns.
- `docs/API.md` — public API and schema reference.
- `docs/ARCHITECTURE.md` — runtime architecture and data flow.
- `docs/SECURITY.md` — archive hardening, transaction and audit guarantees/limitations.
- `docs/V14-MIGRATION.md` — v13 boundaries and v14 promotion checklist.
- `docs/TESTING.md` — test and release-audit coverage.
- `docs/IMPLEMENTATION-SPECIFICATION.md` — exact backup/import/export implementation specification.

## Foundry references

- Module development and package relationships: https://foundryvtt.com/article/module-development/
- Foundry v13 public API: https://foundryvtt.com/api/v13/
- ApplicationV2 v13: https://foundryvtt.com/api/v13/classes/foundry.applications.api.ApplicationV2.html
- FilePicker v13: https://foundryvtt.com/api/v13/classes/foundry.applications.apps.FilePicker.html
- Foundry v14 public API: https://foundryvtt.com/api/v14/

## Installation

Paste this manifest URL into Foundry's **Add-on Modules → Install Module** dialog:

```text
https://github.com/Runyth/foundry-runyth-backup-framework/releases/latest/download/module.json
```

## Licence
Copyright © 2026  [Daniel Braniewski](https://brani.dev/)

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
