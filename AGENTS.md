# Agent contract

## Priorities

1. Preserve user-visible behavior and stored data.
2. Preserve module IDs, settings, flags, pack IDs, UUIDs, hooks, and public APIs.
3. Use public Foundry VTT and dependency APIs.
4. Keep the install archive minimal and the source archive complete.
5. Add regression tests for every corrected defect.

## Required gate

Run `npm run check` before finalizing a change. Do not claim live Foundry VTT
acceptance unless it was actually performed in a live multi-client world.

## Repository ownership

Files listed in `.runyth/template-managed.json` are centrally managed. Module
code, content, tests outside `test/runyth`, module-specific documentation, and
`runyth.config.json` are repository-owned.

## Compatibility

Do not silently rename or delete stable storage keys. Add idempotent, resumable
migrations for stored data changes. Isolate optional integrations and fail
closed when a failure could reveal GM-only or protected content.

## Commits

Follow `docs/COMMIT_CONVENTIONS.md`.
