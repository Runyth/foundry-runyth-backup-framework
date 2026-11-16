// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import { readJson } from "./lib/project.mjs";

const manifest = await readJson("module.json");
const tag = process.env.GITHUB_REF_NAME ?? process.argv[2];
if (!tag) throw new Error("Release tag is unavailable.");
if (tag !== `v${manifest.version}`) throw new Error(`Tag ${tag} does not match module version v${manifest.version}.`);
const download = `https://github.com/${manifest.url.replace("https://github.com/", "")}/releases/download/${tag}/${manifest.id}-v${manifest.version}-mod.zip`;
if (manifest.download !== download) throw new Error(`Manifest download URL must point at ${download}.`);
console.log(`Release tag ${tag} matches module.json and its -mod download URI.`);
