# runyth-backup-framework-1.0.0

## API Reference

### API discovery

`game.modules.get("runyth-backup-framework").api` exposes API version `1`.

Top-level members:

| Member | Purpose |
|---|---|
| `version` | Framework SemVer (`1.0.0`). |
| `apiVersion` | Integration API generation (`1`). |
| `capabilities` | Built-in codec, driver, merge and archive-format capability declaration. |
| `compat` | Foundry-v13 compatibility adapter. Intended primarily for framework internals. |
| `registry` | Registration registry. |
| `drivers` | Driver registry; supports custom driver-type registration. |
| `audit` | Persistent audit store API. |
| `engine` | Backup/import/export engine. |
| `settings` | Framework settings accessor and regex validator. |
| `register(definition)` | Register one integrating module. |
| `unregister(moduleId)` | Remove a registration from the runtime registry. |
| `list()` | Return registered integrations sorted by title. |
| `get(moduleId)` | Return one normalized registration. |
| `createBackup(moduleId, options)` | Build/download a backup ZIP. |
| `createExport(moduleId, options)` | Build/download an export ZIP. |
| `inspectArchive(file)` | Parse and integrity-check a framework ZIP without mutating the world. |
| `prepareImport(inspection, options)` | Build a read-only import/conflict plan. |
| `executeImport(plan, options)` | Execute one transactional import plan. |
| `createMany(moduleIds, operation)` | Create one ZIP per selected module. |
| `inspectMany(files)` | Inspect multiple files independently. |
| `setResolution(plan, entryId, resolution)` | Apply an item-level conflict resolution. |
| `applyCategoryRule(plan, categoryPrefix, resolution)` | Apply a hierarchical branch rule. |

### Registration definition

```js
{
  moduleId: "example-module",
  title: "Example Module",
  description: "Example integration.",
  moduleVersion: () => game.modules.get("example-module").version,
  frameworkApi: { minimum: 1, maximum: 1 },
  capabilities: ["backup", "import", "export"],
  schema: {
    id: "example-module-backup",
    version: 1,
    metadata: async ({ operation, moduleId, moduleVersion }) => ({ operation, moduleId, moduleVersion }),
    entries: []
  },
  migrations: [],
  mergeStrategies: {},
  hooks: {}
}
```

`moduleId` must be lowercase Foundry-style package ID syntax. `moduleVersion` must resolve to SemVer. `frameworkApi` is an explicit compatibility gate; API 1 must fall inside the declared range.

### Capabilities

A registration declares any non-empty subset of:

- `backup`: may create backup archives.
- `import`: may accept framework archives.
- `export`: may create export archives.

Schema entries independently declare operation participation with `operations`, defaulting to all three. This allows one integration schema to describe different backup/export/import surfaces without duplicating framework logic.

### Schema object

| Field | Required | Meaning |
|---|---:|---|
| `id` | effectively | Stable schema identifier. Defaults to `<moduleId>-default`. |
| `version` | effectively | Positive integer schema generation. Defaults to `1`. |
| `metadata` | no | JSON value or async function producing JSON archive metadata. |
| `entries` | yes | Array or async function returning schema entries. |

An async `entries` function receives `{ moduleId, schemaVersion, operation?, archiveOperation?, manifest? }` depending on phase. It is intended for deterministic discovery of module-owned entities while keeping business logic in this framework.

### Schema entry

```js
{
  id: "actor-images.guard-captain",
  label: "Guard Captain Images",
  description: "Actor portrait and prototype-token image.",
  category: ["NPC Dossiers", "Terminus", "Images"],
  operations: ["backup", "import"],
  codec: "json",
  required: true,
  partial: true,
  dependencies: [],
  zipPath: "actors/guard-captain/images.json",
  metadata: { kind: "actor-images" },
  driver: {
    type: "document-fields",
    uuid: "Actor.ABCDEF0123456789",
    paths: ["img", "prototypeToken.texture.src"]
  },
  validate: async (value, context) => {},
  conflict: {
    allowed: ["keep", "merge", "import"],
    merge: "deep-object",
    autoImportWhenLiveIsBaseline: true,
    classify: null
  }
}
```

Entry semantics:

| Field | Default | Meaning |
|---|---|---|
| `id` | none | Stable unique ID within the schema. |
| `label` | `id` | Human-readable conflict/selection label. |
| `description` | empty | Human-readable purpose. |
| `category` | `[]` | Hierarchical array or slash-delimited string. |
| `operations` | all | Any subset of `backup`, `import`, `export`. |
| `codec` | `json` | `json`, `text` or `binary`. |
| `required` | `true` | Missing source fails archive creation; missing required import entry fails preparation. |
| `partial` | `true` | If `false`, entry is always included in partial imports. |
| `dependencies` | `[]` | Entry IDs automatically included with a selected entry. |
| `zipPath` | generated | Exact unique relative path inside the ZIP. |
| `metadata` | `null` | JSON-serializable per-entry metadata written into the archive manifest. |
| `driver` | none | Storage adapter specification. |
| `validate` | none | Optional archive/import validation callback. |
| `conflict.allowed` | keep/import | Allowed user resolutions. |
| `conflict.merge` | null | Required when `merge` is allowed. |
| `conflict.autoImportWhenLiveIsBaseline` | true | Whether a baseline-matching live value is automatically non-conflicting. |
| `conflict.classify` | null | Optional custom classifier returning `same`, `safe-import` or `conflict`. |

All ZIP payload paths are exact. Undeclared ZIP entries are rejected; duplicate IDs/paths are rejected; unsafe traversal/absolute paths are rejected.

### Built-in drivers

#### `setting`

```js
{ type: "setting", namespace: "example-module", key: "configuration", path: "optional.nested.path" }
```

Captures a registered Foundry setting. Without `path`, the whole setting value is captured. With `path`, only the declared nested value is represented while snapshot/apply/rollback preserve the containing setting.

#### `document`

```js
{ type: "document", uuid: "Actor.ABCDEF0123456789", path: "system.customState", baseline: {} }
```

Resolves the document by UUID. A `path` updates only that path. Omitting `path` applies the imported object with `Document#update`; that is update/merge semantics, not a guaranteed deletion of live fields omitted from the imported object. Use `document-fields` for explicit field sets or a custom driver for exact document replacement semantics.

#### `document-fields`

```js
{
  type: "document-fields",
  uuid: "Actor.ABCDEF0123456789",
  paths: ["img", "prototypeToken.texture.src"],
  baseline: {
    img: "modules/example-module/assets/default.webp",
    "prototypeToken.texture.src": "modules/example-module/assets/default.webp"
  }
}
```

Captures a declared set of document paths as one JSON object and writes them together using one document update. This is the preferred built-in driver for logically grouped fields such as actor portrait + prototype token image.

#### `file`

```js
{
  type: "file",
  path: "worlds/example-world/example-module/portraits/captain.webp",
  mime: "image/webp",
  allowRelocation: true,
  fallbackDirectory: "worlds/example-world",
  fallbackName: "captain.webp",
  baselineSha256: "<optional 64-character SHA-256>",
  baselineMissing: false,
  references: [
    { type: "document", uuid: "Actor.ABCDEF0123456789", path: "img" }
  ]
}
```

The framework reads the original path into the ZIP. During import it attempts that path first. If the upload fails and relocation is allowed, it opens a Foundry folder picker, writes the asset there, and rewrites declared references. Reference forms are `setting`, `document`, or custom `{ read, apply }` callbacks. Custom references must implement both read and apply so rollback can restore the prior reference.

#### `json-file`

```js
{ type: "json-file", path: "worlds/example-world/example-module/state.json", baseline: {} }
```

Reads/writes a JSON file through Foundry's public Data-source file upload path.

#### `custom`

```js
{
  type: "custom",
  exists: async () => true,
  read: async () => ({ enabled: true }),
  baseline: async () => ({ enabled: false }),
  snapshot: async () => ({ enabled: true }),
  apply: async (value) => {
    await Promise.resolve(value);
  },
  rollback: async (snapshot) => {
    await Promise.resolve(snapshot);
  }
}
```

`read` and `apply` are mandatory. `snapshot` defaults to `read`; `baseline` defaults to undefined. A custom driver without `rollback` is accepted but deliberately throws if rollback is required, so integrations that write through custom storage should implement rollback.

### Merge strategies

Built-ins:

- `keep`
- `replace`
- `shallow-object`
- `deep-object`
- `append-unique`
- `union-by-id`

An integration can add named functions through `mergeStrategies`, then reference that name from `entry.conflict.merge`.

### Hooks

All hooks are optional and run in the integration's module context:

| Hook | Phase |
|---|---|
| `beforeArchive({ operation, moduleId, selection })` | Before source capture. |
| `afterArchive({ operation, moduleId, filename, manifest })` | After ZIP generation/download. |
| `validateArchive({ manifest, inspection, entries })` | Read-only import validation after schema migration. |
| `beforeImport({ plan })` | After decisions/confirmation, immediately before transaction preflight. Must not mutate live state. |
| `afterImport({ plan, changes, audit })` | After successful writes and audit persistence. |

### Schema migrations

`migrations` is an ordered set of explicit steps:

```js
{
  from: 1,
  to: 2,
  migrate: async ({ manifest, zip }) => {
    return manifest;
  }
}
```

Imports repeatedly apply a migration whose `from` matches the archive schema version until the current schema version is reached. A missing step or a future schema version is rejected.

### Conflict classifier callback

A custom classifier receives:

`{ live, incoming, baseline, defaultState, schema, manifest }`

It must return exactly `same`, `safe-import`, or `conflict`. When omitted, the framework compares canonical JSON or binary bytes and declared baseline data.

### Archive functions

`createBackup` and `createExport` return `{ filename, bytes, manifest }`; pass `{ save: false }` to build without triggering a browser download. `selection` may be a set/array of schema IDs; dependency closure and non-partial entries are enforced.

`inspectArchive` performs complete ZIP and manifest integrity validation and returns `{ file, bytes, zip, manifest, archiveSha256 }` without accessing the registered integration.

`prepareImport` then binds an inspection to the current registration/schema, validates required entries and migrations, reads live/baseline state, and returns an import plan.

`executeImport` applies an already-decided plan transactionally. `{ skipConfirmation: true }` is reserved for callers that have already performed an equivalent higher-level confirmation, as the dashboard does for bulk execution.
