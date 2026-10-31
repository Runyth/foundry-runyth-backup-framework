# runyth-backup-framework-1.0.0

## Integration Guide

### Recommended required dependency

An integrating module that cannot provide its backup/import/export feature without this framework should declare it under Foundry package relationships:

```json
{
  "relationships": {
    "requires": [
      {
        "id": "runyth-backup-framework",
        "type": "module",
        "manifest": "https://github.com/Runyth/runyth-backup-framework/releases/latest/download/module.json",
        "compatibility": {
          "minimum": "1.0.0",
          "verified": "1.0.0"
        }
      }
    ]
  }
}
```

Foundry's module-development documentation defines `relationships.requires` for required package dependencies: https://foundryvtt.com/article/module-development/

### Minimal integration

The following is a complete Foundry-side registration file. It uses only Foundry globals and therefore has no ES module imports.

```js
// scripts/backup-integration.mjs
// Foundry package relationships: https://foundryvtt.com/article/module-development/

const FRAMEWORK_ID = "runyth-backup-framework";
const MODULE_ID = "example-module";

Hooks.once("init", () => {
  // A required relationship makes the framework available before this module initializes.
  const api = game.modules.get(FRAMEWORK_ID)?.api;
  if (!api) throw new Error(`${MODULE_ID} requires ${FRAMEWORK_ID}.`);

  api.register({
    moduleId: MODULE_ID,
    title: "Example Module",
    description: "Backup support for Example Module.",
    frameworkApi: { minimum: 1, maximum: 1 },
    capabilities: ["backup", "import", "export"],
    moduleVersion: () => game.modules.get(MODULE_ID).version,
    schema: {
      id: `${MODULE_ID}-backup`,
      version: 1,
      entries: [
        {
          id: "configuration",
          label: "Configuration",
          category: ["Configuration"],
          zipPath: "config/configuration.json",
          driver: {
            type: "setting",
            namespace: MODULE_ID,
            key: "configuration"
          },
          conflict: {
            allowed: ["keep", "merge", "import"],
            merge: "deep-object"
          }
        }
      ]
    }
  });
});
```

For this common case, the integration defines storage location and conflict policy only. ZIP generation, manifest construction, checksum generation, filename generation, bulk routing, import selection, live-state comparison, decision UI, confirmation, snapshots, rollback, audit and download UX remain framework-owned.

### Optional integration

A module that works without the framework can subscribe during script evaluation:

```js
// scripts/optional-backup-integration.mjs

Hooks.on("runythBackupFrameworkReady", (api) => {
  api.register({
    moduleId: "example-optional-module",
    capabilities: ["backup", "import"],
    schema: {
      id: "example-optional-module-backup",
      version: 1,
      entries: []
    }
  });
});
```

### Actor portrait + prototype token + image asset

A common dashboard customization can be represented with two entries: one for the image paths in the Actor and one for the actual binary asset. The file entry owns fallback relocation and reference rewriting.

```js
// scripts/actor-image-backup.mjs

const FRAMEWORK_ID = "runyth-backup-framework";
const MODULE_ID = "example-actors";
const ACTOR_UUID = "Actor.ABCDEF0123456789";
const IMAGE_PATH = "worlds/example-world/example-actors/captain.webp";

Hooks.once("init", () => {
  const api = game.modules.get(FRAMEWORK_ID)?.api;
  if (!api) throw new Error(`${MODULE_ID} requires ${FRAMEWORK_ID}.`);

  api.register({
    moduleId: MODULE_ID,
    title: "Example Actors",
    frameworkApi: { minimum: 1, maximum: 1 },
    capabilities: ["backup", "import"],
    schema: {
      id: `${MODULE_ID}-backup`,
      version: 1,
      entries: [
        {
          id: "captain-image-fields",
          label: "Captain image paths",
          category: ["NPC Dossiers", "Terminus", "Images"],
          zipPath: "actors/captain/image-fields.json",
          driver: {
            type: "document-fields",
            uuid: ACTOR_UUID,
            paths: ["img", "prototypeToken.texture.src"]
          },
          conflict: {
            allowed: ["keep", "import"]
          }
        },
        {
          id: "captain-image-file",
          label: "Captain image asset",
          category: ["NPC Dossiers", "Terminus", "Images"],
          codec: "binary",
          zipPath: "assets/captain.webp",
          dependencies: ["captain-image-fields"],
          driver: {
            type: "file",
            path: IMAGE_PATH,
            mime: "image/webp",
            allowRelocation: true,
            references: [
              { type: "document", uuid: ACTOR_UUID, path: "img" },
              { type: "document", uuid: ACTOR_UUID, path: "prototypeToken.texture.src" }
            ]
          },
          conflict: {
            allowed: ["keep", "import"]
          }
        }
      ]
    }
  });
});
```

If the original file path cannot be uploaded, the framework restores an overwritten original when possible, opens the Foundry directory picker when relocation is allowed, uploads to the chosen directory, updates all declared references, and keeps the prior reference/file snapshots for rollback.

### Category design

Use stable hierarchical categories such as:

- `NPC Dossiers / Terminus / Images`
- `NPC Dossiers / Dividers / Images`
- `Configuration / Display`
- `Configuration / Rules`

The same hierarchy drives partial-selection branch controls and conflict branch rules. A user can therefore apply Keep to the Terminus branch and Import to the Dividers branch without the integrating module implementing any UI.

### Baselines

Baselines distinguish a fresh/default installation from locally changed state.

- `setting` automatically uses the registered setting default.
- `document` and `document-fields` accept `driver.baseline`.
- `json-file` accepts `driver.baseline`.
- `file` can use `baselineSha256` and/or `baselineMissing`.
- `custom` can implement `baseline()`.

With the default `autoImportWhenLiveIsBaseline: true`, a live value equal to baseline is safe-imported without a conflict prompt. Locally modified values become conflicts.

### Partial import

Set `partial: false` only for entries that must always be imported whenever the archive is applied. Dependencies should model prerequisites, not category grouping. The framework automatically expands a user selection to include dependencies.

### Exact-replacement data

`Document#update` does not imply deletion of arbitrary live fields omitted from the imported object. If exact replacement including deletion semantics is required, use explicit `document-fields` entries for every owned path or a custom driver whose `snapshot`, `apply` and `rollback` implement the integrating module's exact semantics.

### Custom driver expectations

Custom drivers should satisfy these invariants:

1. `read()` is side-effect free.
2. `baseline()` is side-effect free.
3. `snapshot()` is side-effect free and sufficient for full rollback.
4. `apply()` performs only the declared entry's mutation.
5. `rollback(snapshot)` restores the live state represented by the snapshot.
6. Methods reject on failure rather than swallowing errors.
7. Custom file/reference logic does not depend on private Foundry APIs.

When these rules are followed, the framework can provide the same conflict/audit/partial/bulk UX as for built-in storage drivers.
