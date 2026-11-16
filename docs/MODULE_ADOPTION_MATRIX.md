# Known module adoption matrix

This is a migration starting point, not a runtime dependency graph.

| Module ID | Kind | Primary migration constraint |
| --- | --- | --- |
| `orphan-black-compendiums` | `content` | Preserve pack IDs, UUIDs, and regional data schemas. |
| `dangerous-situations-compendium` | `content` | Preserve native Actor/Item pack identities. |
| `magic-item-compendium` | `content` | Preserve 223 Item identities and artwork paths. |
| `orphan-black-monster-compendium` | `content` | Preserve Actor folders, embedded Items, and artwork paths. |
| `orphan-black-polyglot-preset` | `companion` | Keep Polyglot capability checks isolated. |
| `orphan-black-notable-npcs` | `library` | Preserve discovery flags, dossier imports, and public API. |
| `orphan-black-ready-actors` | `content` | Preserve Actor UUIDs, artwork, and wildcard token behavior. |
| `encounter-crucible-orphan-black` | `companion` | Depend only on Encounter Crucible public helper APIs. |
| `encounter-crucible` | `library` | Preserve authoritative difficulty and persistence contracts. |
| `encounter-crucible-forge` | `companion` | Remain a generic helper and reference implementation. |
| `the-fishing-experience` | `library` | Preserve managed content and helper integration API. |
| `scriptoria` | `library` | Preserve scripture storage and extension API. |
| `illuminated-documents` | `library` | Preserve stable block IDs, metadata, and extension lifecycle. |
| `illuminated-languages` | `companion` | Preserve fail-closed secrecy and public integrations. |
| `pet-command` | `runtime` | Preserve owner, pet, progression, and command flags. |
| `garb-and-grime` | `runtime` | Preserve cleanliness, contamination, odor, and effect data. |
| `token-hud-last-image` | `utility` | Preserve wildcard token image persistence. |
| `too-many-tokens-ready-actors` | `content` | Preserve wildcard defaults and CR organization. |
| `witch-hunter-mont-cragge` | `content` | Preserve imported source-page and document references. |
| `hunters-bestiary` | `library` | Preserve system-neutral catalogue and adapter API. |
| `hunters-bestiary-dnd5e-2024` | `companion` | Keep D&D 5e data outside the system-neutral core. |
| `sanctum-curiosities` | `content` | Preserve searchable import-library identities. |
| `scriptoria-example-extension` | `companion` | Remain a minimal public-API example. |
| `orphan-black-npcs-imperial-military` | `companion` | Preserve independent NPC registration data. |

All modules start in passthrough mode. Standardize repository mechanics first; do not bundle unrelated internal rewrites into adoption.
