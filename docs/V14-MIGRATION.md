# runyth-backup-framework-1.0.0

## Foundry v14 Migration Gate

Version 1.0.0 intentionally declares Foundry v13 only:

```json
"compatibility": {
  "minimum": "13",
  "verified": "13",
  "maximum": "13"
}
```

The maximum is a deliberate certification gate, not a statement that the current v14 API is known incompatible.

### v13 surfaces to re-qualify

| Surface | v1.0.0 location | v14 status in current official docs | Migration action |
|---|---|---|---|
| `ApplicationV2` + `HandlebarsApplicationMixin` | `scripts/ui/*` | Present in v14; ApplicationV2 remains the current application model. | Re-run UI behavior/layout/action-handler tests. |
| `DialogV2.confirm` | `scripts/compat/foundry-v13.mjs` | DialogV2 remains in v14 public ApplicationV2 API. | Verify config/result semantics. |
| `FilePicker.createDirectory` | compatibility adapter | Present in v14 FilePicker. | Verify Data-source permissions/error behavior. |
| `FilePicker.browse` | compatibility adapter | Present in v14 FilePicker. | Verify directory existence fallback. |
| `FilePicker.upload` | compatibility adapter | Present in v14 with same documented argument shape. | Verify response/error behavior and overwrite semantics. |
| `FilePicker.uploadPersistent` | compatibility adapter | Present in v14 with the same documented `packageId, path, file, body?, options?` shape. | Verify `/storage` persistence across package update. |
| `persistentStorage` manifest field | `module.json` | Present in v14 ModuleManifestData. | Keep if behavior passes update test. |
| `foundry.utils.fromUuid` | compatibility adapter | Listed in v14 `foundry.utils`. | Verify document resolution and UUID types used by integrations. |
| `foundry.utils.srcExists` | compatibility adapter | Listed in v14 `foundry.utils`. | Verify behavior for Data-served paths. |
| `foundry.utils.getRoute` + browser `fetch` | compatibility adapter | `getRoute` remains listed in v14 `foundry.utils`. | Verify authenticated Data URL reads and cache behavior. |
| `foundry.utils.saveDataToFile` | compatibility adapter | Listed in v14 `foundry.utils`. | Keep only for textual audit export; binary ZIP continues to use Blob. |
| `game.settings.register/get/set` | settings/UI/adapter | Core settings API. | Smoke-test world/client scopes and object geometry setting. |
| `getSceneControlButtons` | `scripts/main.mjs` | Still documented under v14 SceneControls hook events. | Verify token control record shape and button callback contract. |
| `Document#toObject` / `Document#update` | built-in drivers | Core document API. | Test path updates for representative world and embedded documents. |
| package module API exposure `game.modules.get(id).api` | `scripts/main.mjs` | Package integration convention. | Test required and optional registration ordering. |

Official references:

- v13 API: https://foundryvtt.com/api/v13/
- v13 FilePicker: https://foundryvtt.com/api/v13/classes/foundry.applications.apps.FilePicker.html
- v13 `getSceneControlButtons`: https://foundryvtt.com/api/v13/functions/hookEvents.getSceneControlButtons.html
- v14 API: https://foundryvtt.com/api/v14/
- v14 ApplicationV2: https://foundryvtt.com/api/v14/classes/foundry.applications.api.ApplicationV2.html
- v14 FilePicker: https://foundryvtt.com/api/v14/classes/foundry.applications.apps.FilePicker.html
- v14 hook events: https://foundryvtt.com/api/v14/modules/hookEvents.html
- v14 ModuleManifestData: https://foundryvtt.com/api/v14/interfaces/foundry.packages.types.ModuleManifestData.html
- v14 utilities: https://foundryvtt.com/api/v14/modules/foundry.utils.html

### Promotion checklist

A v14 feature/patch release may remove the `maximum: 13` gate only after all of the following pass on an actual v14 Stable installation:

1. Install/enable on a clean world with no integrating modules.
2. Verify scene-control dashboard entry, all tabs, resizing, geometry restore/reset and keyboard/drop interactions.
3. Verify settings registration, regex validation and client/world scopes.
4. Register one required integration and one optional hook-based integration.
5. Back up settings, document fields, JSON files and binary files.
6. Inspect generated ZIPs externally and re-import them.
7. Restore to an unchanged/fresh baseline without conflict prompts.
8. Modify live state and verify item-level Keep/Merge/Import plus nested category branch rules.
9. Verify partial import dependency closure and non-partial entries.
10. Force an intermediate document/custom-driver failure and prove rollback.
11. Force original-path file upload failure and verify fallback directory selection/reference rewriting.
12. Force fallback cancellation and verify rollback/audit status.
13. Verify audit persistence across reload and module update, integrity verification, download and retention pruning.
14. Bulk back up at least ten registered modules and bulk import them to a clean second world/instance.
15. Verify one bulk confirmation, stop-on-failure behavior, final status reporting and reload prompt.
16. Re-run automated tests/static release audit.
17. Only then set `verified`/`maximum` to the tested v14 generation/build.
