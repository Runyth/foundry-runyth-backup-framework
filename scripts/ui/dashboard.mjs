// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import { MODULE_ID } from "../constants.mjs";
import { ConflictResolverApp } from "./conflict-resolver.mjs";
import { ImportSelectionApp } from "./import-selection.mjs";
import { escapeHtml } from "../util.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

let singleton;
export function getDashboard(api) { return singleton ??= new BackupDashboard(api); }

export class BackupDashboard extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "runyth-backup-framework-dashboard",
    classes: ["runyth-backup-framework", "rbf-dashboard"],
    position: { width: 1120, height: 760 },
    window: { title: "RBF.Title", icon: "fa-solid fa-box-archive", resizable: true },
    actions: {
      tab: this.#tab,
      selectModule: this.#selectModule,
      backup: this.#backup,
      exportArchive: this.#exportArchive,
      chooseImport: this.#chooseImport,
      processQueue: this.#processQueue,
      clearQueue: this.#clearQueue,
      removeQueue: this.#removeQueue,
      customizeImport: this.#customizeImport,
      toggleBulk: this.#toggleBulk,
      selectAllBulk: this.#selectAllBulk,
      clearBulk: this.#clearBulk,
      bulkBackup: this.#bulkBackup,
      bulkExport: this.#bulkExport,
      downloadAudit: this.#downloadAudit,
      pruneAudit: this.#pruneAudit,
      verifyAudit: this.#verifyAudit,
      resetGeometry: this.#resetGeometry
    }
  };

  static PARTS = { body: { template: `modules/${MODULE_ID}/templates/dashboard.hbs`, scrollable: [".rbf-scroll"] } };

  constructor(api, options = {}) {
    super(options);
    this.api = api;
    this.activeTab = "modules";
    this.selectedModule = null;
    this.bulkSelection = new Set();
    this.queue = [];
    this.auditEntries = [];
    this.addEventListener("position", () => this.#persistGeometry());
  }

  async open() {
    if (!game.user?.isGM) throw new Error("Runyth Backup Framework dashboard is GM-only.");
    await this.render({ force: true });
    const geometry = game.settings.get(MODULE_ID, "dashboardGeometry");
    if (geometry && Object.keys(geometry).length) this.setPosition(geometry);
    return this;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    let include = null, exclude = null;
    try { include = this.api.settings.validateRegex("moduleIncludeRegex"); exclude = this.api.settings.validateRegex("moduleExcludeRegex"); }
    catch (error) { ui.notifications.error(error.message); }
    const modules = this.api.list().filter((registration) => (!include || include.test(registration.moduleId)) && (!exclude || !exclude.test(registration.moduleId)));
    if (!this.selectedModule && modules.length) this.selectedModule = modules[0].moduleId;
    if (this.activeTab === "diagnostics") this.auditEntries = (await this.api.audit.load()).entries.slice().reverse();
    return {
      ...context,
      activeTab: this.activeTab,
      tabs: { modules: this.activeTab === "modules", bulk: this.activeTab === "bulk", queue: this.activeTab === "queue", diagnostics: this.activeTab === "diagnostics" },
      modules: modules.map((registration) => ({
        ...registration,
        active: registration.moduleId === this.selectedModule,
        selected: this.bulkSelection.has(registration.moduleId),
        canBackup: registration.capabilities.includes("backup"),
        canImport: registration.capabilities.includes("import"),
        canExport: registration.capabilities.includes("export")
      })),
      selected: (() => {
        const registration = modules.find((candidate) => candidate.moduleId === this.selectedModule);
        return registration ? {
          ...registration,
          canBackup: registration.capabilities.includes("backup"),
          canImport: registration.capabilities.includes("import"),
          canExport: registration.capabilities.includes("export")
        } : null;
      })(),
      queue: this.queue.map((item, index) => ({
        ...item,
        index,
        customizable: Boolean(item.inspection && item.status !== "done"),
        selectionLabel: item.selection ? `${item.selection.size} explicitly selected` : "Full import"
      })),
      auditEntries: this.auditEntries,
      density: game.settings.get(MODULE_ID, "dashboardDensity")
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;
    const drop = root.querySelector(".rbf-dropzone");
    if (drop) {
      const onDrag = (event) => { event.preventDefault(); drop.classList.add("is-dragging"); };
      const onLeave = () => drop.classList.remove("is-dragging");
      const onDrop = async (event) => {
        event.preventDefault(); drop.classList.remove("is-dragging");
        await this.#enqueueFiles([...event.dataTransfer.files]);
      };
      drop.addEventListener("dragover", onDrag, { once: false });
      drop.addEventListener("dragleave", onLeave, { once: false });
      drop.addEventListener("drop", onDrop, { once: false });
      drop.addEventListener("keydown", (event) => {
        if (!["Enter", " "].includes(event.key)) return;
        event.preventDefault();
        root.querySelector("input[data-rbf-file-input]")?.click();
      });
    }
    const fileInput = root.querySelector("input[data-rbf-file-input]");
    fileInput?.addEventListener("change", async () => this.#enqueueFiles([...fileInput.files]));
  }

  async #enqueueFiles(files) {
    let addedReady = 0;
    const filenameRegex = this.api.settings.validateRegex("archiveFilenameRegex");
    for (const file of files) {
      try {
        if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("Only ZIP archives are accepted.");
        const filenameMatch = filenameRegex ? filenameRegex.exec(file.name) : null;
        if (filenameRegex && !filenameMatch) throw new Error("Filename does not match the configured archive naming policy.");
        const inspection = await this.api.engine.inspectArchive(file);
        const registration = this.api.registry.get(inspection.manifest.moduleId);
        if (!registration) throw new Error(`No registered integration for ${inspection.manifest.moduleId}.`);
        if (!registration.capabilities.includes("import")) throw new Error(`${inspection.manifest.moduleId} does not implement import.`);
        const groups = filenameMatch?.groups ?? {};
        if (groups.module && groups.module !== inspection.manifest.moduleId) throw new Error("Filename module ID does not match the embedded manifest.");
        if (groups.operation && groups.operation !== inspection.manifest.operation) throw new Error("Filename operation does not match the embedded manifest.");
        if (groups.moduleVersion && groups.moduleVersion !== inspection.manifest.moduleVersion) throw new Error("Filename module version does not match the embedded manifest.");
        if (this.queue.some((item) => item.inspection && item.moduleId === inspection.manifest.moduleId && item.status !== "done" && item.status !== "cancelled")) {
          throw new Error(`Another queued archive already targets ${inspection.manifest.moduleId}. Remove it before adding a replacement.`);
        }
        this.queue.push({ file, name: file.name, moduleId: inspection.manifest.moduleId, operation: inspection.manifest.operation, status: "ready", inspection, selection: null });
        addedReady += 1;
      } catch (error) {
        this.queue.push({ file, name: file.name, moduleId: "—", operation: "—", status: `error: ${error.message}`, error });
      }
    }
    this.activeTab = "queue";
    await this.render({ force: true });
    if (addedReady && this.api.settings.get("autoProcessDrop")) await this.processQueue();
  }
  #persistTimer;
  #persistGeometry() {
    clearTimeout(this.#persistTimer);
    this.#persistTimer = setTimeout(() => {
      const { left, top, width, height } = this.position;
      game.settings.set(MODULE_ID, "dashboardGeometry", { left, top, width, height }).catch(console.error);
    }, 250);
  }

  static async #tab(event, target) { this.activeTab = target.dataset.tab; await this.render({ force: true }); }
  static async #selectModule(event, target) { this.selectedModule = target.dataset.moduleId; await this.render({ force: true }); }
  static async #backup(event, target) { await this.api.engine.createArchive(target.dataset.moduleId, { operation: "backup" }); ui.notifications.info("Backup created."); }
  static async #exportArchive(event, target) { await this.api.engine.createArchive(target.dataset.moduleId, { operation: "export" }); ui.notifications.info("Export created."); }
  static #chooseImport() { this.element.querySelector("input[data-rbf-file-input]")?.click(); }
  static async #clearQueue() { this.queue = []; await this.render({ force: true }); }
  static async #removeQueue(event, target) {
    this.queue.splice(Number(target.dataset.queueIndex), 1);
    await this.render({ force: true });
  }
  static async #toggleBulk(event, target) {
    const id = target.dataset.moduleId;
    const registration = this.api.registry.get(id);
    if (!registration?.capabilities.includes("backup") && !registration?.capabilities.includes("export")) return;
    this.bulkSelection.has(id) ? this.bulkSelection.delete(id) : this.bulkSelection.add(id);
    await this.render({ force: true });
  }
  static async #selectAllBulk() {
    this.bulkSelection = new Set(this.api.list()
      .filter((registration) => registration.capabilities.includes("backup") || registration.capabilities.includes("export"))
      .map((registration) => registration.moduleId));
    await this.render({ force: true });
  }
  static async #clearBulk() { this.bulkSelection.clear(); await this.render({ force: true }); }
  static async #bulkBackup() {
    if (!this.bulkSelection.size) return ui.notifications.warn("Select at least one registered module.");
    const ids = [...this.bulkSelection].filter((id) => this.api.registry.get(id)?.capabilities.includes("backup"));
    if (!ids.length) return ui.notifications.warn("No selected integration implements backup.");
    await this.api.engine.bulkCreate(ids, "backup");
    ui.notifications.info(`Created ${ids.length} backup ZIP(s).`);
  }
  static async #bulkExport() {
    const ids = [...this.bulkSelection].filter((id) => this.api.registry.get(id)?.capabilities.includes("export"));
    if (!ids.length) return ui.notifications.warn("No selected integration implements export.");
    await this.api.engine.bulkCreate(ids, "export");
    ui.notifications.info(`Created ${ids.length} export ZIP(s).`);
  }

  static async #customizeImport(event, target) {
    const item = this.queue[Number(target.dataset.queueIndex)];
    if (!item?.inspection) return;
    const registration = this.api.registry.get(item.moduleId);
    if (!registration) return ui.notifications.error(`No registered integration for ${item.moduleId}.`);
    const picker = new ImportSelectionApp(item.inspection, registration);
    await picker.render({ force: true });
    const selection = await picker.resultPromise;
    if (selection === null) return;
    item.selection = selection;
    item.status = "ready (partial selection)";
    await this.render({ force: true });
  }

  static async #processQueue() { return this.processQueue(); }

  async processQueue() {
    const candidates = this.queue.filter((item) => item.inspection && item.status !== "done");
    if (!candidates.length) return;

    const prepared = [];
    for (const item of candidates) {
      try {
        item.status = "preparing";
        await this.render({ force: true });
        let plan = await this.api.engine.prepareImport(item.inspection, { selection: item.selection });
        if (plan.requiresDecision) {
          const resolver = new ConflictResolverApp(plan, this.api.engine);
          await resolver.render({ force: true });
          plan = await resolver.resultPromise;
          if (!plan) { item.status = "cancelled"; continue; }
        }
        item.status = "validated";
        prepared.push({ item, plan });
      } catch (error) {
        item.status = `error: ${error.message}`;
        console.error(`${MODULE_ID} | Import preparation failed`, error);
        if (this.api.settings.get("stopBulkOnFailure")) break;
      }
    }
    await this.render({ force: true });
    if (!prepared.length) return;

    if (this.api.settings.get("confirmWrites")) {
      const elementCount = prepared.reduce((sum, preparedItem) => sum + preparedItem.plan.entries.length, 0);
      const confirmed = await this.api.compat.confirm({
        title: "Apply bulk import",
        content: `<p>Apply ${prepared.length} archive(s) containing ${elementCount} selected element(s)? Each archive is transactional and independently audited.</p>`,
        yes: "Apply import",
        no: "Cancel / no changes"
      });
      if (!confirmed) {
        for (const { item } of prepared) item.status = "cancelled";
        await this.render({ force: true });
        return;
      }
    }

    let succeeded = 0;
    let failed = 0;
    for (const { item, plan } of prepared) {
      try {
        item.status = "importing";
        await this.render({ force: true });
        const result = await this.api.engine.executeImport(plan, { skipConfirmation: true });
        if (result.cancelled) { item.status = "cancelled"; continue; }
        item.status = "done";
        succeeded += 1;
      } catch (error) {
        failed += 1;
        item.status = `error: ${error.message}`;
        console.error(`${MODULE_ID} | Import failed`, error);
        if (this.api.settings.get("stopBulkOnFailure")) break;
      }
      await this.render({ force: true });
    }

    if (succeeded) ui.notifications.info(`Imported ${succeeded} archive(s) successfully.`);
    if (failed) ui.notifications.error(`${failed} archive import(s) failed. Review the queue and diagnostics before reloading.`);
    if (succeeded && !failed && this.api.settings.get("autoReload")) {
      const reload = await this.api.compat.confirm({ title: "Reload Foundry", content: "<p>All prepared imports finished successfully. Reload the world now?</p>", yes: "Reload", no: "Not now" });
      if (reload) this.api.compat.reloadWorld();
    }
  }
  static async #downloadAudit(event, target) { await this.api.audit.downloadEntry(target.dataset.auditId); }
  static async #pruneAudit() {
    const confirmed = await this.api.compat.confirm({
      title: "Prune audit logs",
      content: `<p>Apply the configured retention policy and permanently remove audit entries outside it?</p><p><code>${escapeHtml(game.settings.get(MODULE_ID, "auditRetention"))}</code></p>`,
      yes: "Prune",
      no: "Cancel"
    });
    if (!confirmed) return;
    const result = await this.api.audit.prune(game.settings.get(MODULE_ID, "auditRetention"));
    ui.notifications.info(`Pruned ${result.removed} audit log(s).`);
    await this.render({ force: true });
  }
  static async #verifyAudit() {
    const result = await this.api.audit.verify();
    ui.notifications[result.valid ? "info" : "error"](result.valid ? "Audit store integrity verified." : "Audit store integrity check failed.");
  }
  static async #resetGeometry() {
    await game.settings.set(MODULE_ID, "dashboardGeometry", {});
    this.setPosition({ width: 1120, height: 760, left: undefined, top: undefined });
    ui.notifications.info("Dashboard layout reset.");
  }
}
