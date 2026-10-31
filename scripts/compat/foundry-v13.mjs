// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Runyth. See the LICENSE file for rights and obligations.
import { MODULE_ID } from "../constants.mjs";
import { asUint8Array } from "../util.mjs";

export class FoundryV13Adapter {
  get FilePicker() { return foundry.applications.apps.FilePicker; }
  get DialogV2() { return foundry.applications.api.DialogV2; }

  localize(key) { return game.i18n.localize(key); }
  isGM() { return Boolean(game.user?.isGM); }
  worldId() { return game.world?.id ?? "unknown-world"; }
  userId() { return game.user?.id ?? null; }
  foundryVersion() { return game.version ?? game.release?.version ?? "13"; }

  hasSetting(namespace, key) { return game.settings.settings.has(`${namespace}.${key}`); }
  getSettingConfig(namespace, key) { return game.settings.settings.get(`${namespace}.${key}`); }
  getSetting(namespace, key) { return game.settings.get(namespace, key); }
  setSetting(namespace, key, value) { return game.settings.set(namespace, key, value); }
  fromUuid(uuid) { return foundry.utils.fromUuid(uuid); }

  async readDataFile(path) {
    const response = await fetch(foundry.utils.getRoute(path), { cache: "no-store" });
    if (!response.ok) throw new Error(`Failed to read ${path}: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async sourceExists(path) {
    return Boolean(await foundry.utils.srcExists(path));
  }

  async ensureDataDirectory(path) {
    const normalized = String(path).replace(/^\/+|\/+$/g, "");
    if (!normalized) return;
    const parts = normalized.split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      try { await this.FilePicker.createDirectory("data", current); }
      catch (error) {
        try { await this.FilePicker.browse("data", current); }
        catch { throw error; }
      }
    }
  }

  async uploadDataFile(path, bytes, mime = "application/octet-stream") {
    const normalized = String(path).replace(/^\/+/, "");
    const slash = normalized.lastIndexOf("/");
    const directory = slash >= 0 ? normalized.slice(0, slash) : "";
    const name = slash >= 0 ? normalized.slice(slash + 1) : normalized;
    if (directory) await this.ensureDataDirectory(directory);
    const file = new File([asUint8Array(bytes)], name, { type: mime });
    return this.FilePicker.upload("data", directory, file, {}, { notify: false });
  }

  async uploadPersistent(relativePath, bytes, mime = "application/json") {
    const normalized = String(relativePath).replace(/^\/+/, "");
    const slash = normalized.lastIndexOf("/");
    const name = slash >= 0 ? normalized.slice(slash + 1) : normalized;
    const directory = slash >= 0 ? normalized.slice(0, slash) : "";
    const file = new File([asUint8Array(bytes)], name, { type: mime });
    return this.FilePicker.uploadPersistent(MODULE_ID, directory ? `${directory}/${name}` : name, file, {}, { notify: false });
  }

  persistentUrl(relativePath) {
    return `modules/${MODULE_ID}/storage/${String(relativePath).replace(/^\/+/, "")}`;
  }

  async readPersistent(relativePath) {
    return this.readDataFile(this.persistentUrl(relativePath));
  }

  async pickDirectory(initial = "") {
    return new Promise((resolve) => {
      const picker = new this.FilePicker({
        type: "folder",
        current: initial,
        callback: (path) => resolve(path || null)
      });
      const originalClose = picker.close.bind(picker);
      picker.close = async (...args) => {
        resolve(null);
        return originalClose(...args);
      };
      picker.render({ force: true });
    });
  }

  saveFile(bytes, type, filename) {
    const blob = new Blob([asUint8Array(bytes)], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    queueMicrotask(() => URL.revokeObjectURL(url));
  }

  saveText(text, type, filename) {
    foundry.utils.saveDataToFile(String(text), type, filename);
  }

  notify(level, message) { ui.notifications?.[level]?.(message); }
  reloadWorld() { window.location.reload(); }

  async confirm({ title, content, yes = "Confirm", no = "Cancel" }) {
    return Boolean(await this.DialogV2.confirm({
      window: { title },
      content,
      yes: { label: yes },
      no: { label: no },
      rejectClose: false,
      modal: true
    }));
  }
}
