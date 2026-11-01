// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import { MODULE_ID } from "./constants.mjs";
import { createApi } from "./api.mjs";
import { registerSettings } from "./settings.mjs";
import { getDashboard } from "./ui/dashboard.mjs";

let api;

Hooks.once("init", () => {
  registerSettings();
  api = createApi();
  const module = game.modules.get(MODULE_ID);
  module.api = api;
  Hooks.callAll("runythBackupFrameworkReady", api);
});

Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user?.isGM || !controls.tokens?.tools) return;
  controls.tokens.tools[MODULE_ID] = {
    name: MODULE_ID,
    title: "RBF.SceneControl",
    icon: "fa-solid fa-box-archive",
    order: Object.keys(controls.tokens.tools).length,
    button: true,
    visible: true,
    onChange: async () => {
      try { await getDashboard(api).open(); }
      catch (error) {
        console.error(`${MODULE_ID} | Failed to open dashboard`, error);
        ui.notifications.error(error.message);
      }
    }
  };
});

Hooks.once("ready", () => {
  if (!game.user?.isGM) return;
  console.info(`${MODULE_ID} | Ready. Registered integrations: ${api.list().length}`);
});
