# Runyth Foundry module repository standard

## Goals

The standard separates universal repository mechanics from module-specific
runtime behavior. Every repository receives the same quality gate, deterministic
packaging, release assets, update path, security posture, and maintenance
interface without forcing every module into the same gameplay architecture.

## Repository layers

| Layer | Ownership | Examples |
| --- | --- | --- |
| Foundry runtime | Module | `module.json`, `scripts/`, `packs/`, `templates/`, assets |
| Module development | Module | feature tests, module docs, optional compiler configuration |
| Runyth platform | Template | `tools/`, shared tests, CI, release workflow, policies |
| Module declaration | Module | `runyth.config.json` |

## Supported module kinds

- `runtime`: module with executable client code.
- `content`: packs and static content, optionally with a small initializer.
- `library`: reusable public API or framework module.
- `companion`: integration or campaign layer depending on another module.
- `utility`: narrowly scoped Foundry behavior.

The kind is descriptive. Packaging remains manifest-driven and does not impose
D&D 5e on system-neutral modules.

## Compatibility contracts

Treat these as stable unless a documented migration and release policy says
otherwise:

- module ID and repository identity;
- setting and flag namespaces;
- compendium pack IDs and document UUIDs;
- public hooks and API methods;
- stored schema versions;
- required and optional relationships;
- import/export formats;
- localization keys used by other modules.

## Runtime modes

`entryMode: passthrough` copies runtime files unchanged. This is the default and
makes the repository compatible with existing JavaScript modules. A module may
add a compiler using `build.preBuild`; its output must still match the same
install-tree contract.

## Release contract

Every module release produces:

1. a ready-to-install versioned module archive (`-mod.zip`);
2. a complete reproducible versioned source archive (`-src.zip`);
3. a documentation archive (`-doc.zip`);
4. SHA-256 checksums for all archives and the release manifest;
5. the release `module.json` for Foundry updates;
6. a machine-readable build report;
7. GitHub artifact provenance when the hosting plan supports it.

## No private API fallback

An optional integration must check versions and capabilities. It must not use a
private import, prototype patch, or undocumented state as a fallback merely to
make an incompatible combination appear functional.
