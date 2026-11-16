# Foundry VTT compatibility

## Baseline

The template currently targets Foundry VTT V13. Each module declares its own
`minimum`, `verified`, and optional `maximum` versions in `module.json`. Update
those values only after validation against the corresponding Foundry release.

## Application architecture

New interfaces use ApplicationV2 and public document, hook, settings, socket,
and package APIs. Existing modules may enter the template in passthrough mode;
deprecated UI code is then migrated through normal tested releases rather than
being rewritten during repository adoption.

## Module relationships

- Core libraries remain system-neutral where designed.
- Game-system adapters declare their system and core-module requirements.
- Companion modules use documented public APIs and capability checks.
- Optional integrations must remain optional at startup and at runtime.
- Incompatibility must produce actionable GM diagnostics, not private-API
  fallbacks.

## Stored data

Foundry settings, flags, compendium IDs, document UUIDs, and exported schemas
are persistent compatibility contracts. Schema changes require versioned,
idempotent, failure-safe migrations and regression tests.

## Live qualification

Static validation cannot replace a real Foundry world. Interactive modules must
record acceptance against the intended Foundry build, game system, browser, GM
and player clients, dependencies, permissions, and representative stored data.
