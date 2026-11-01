// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
export const MODULE_ID = "runyth-backup-framework";
export const MODULE_VERSION = "1.0.0";
export const API_VERSION = 1;
export const FORMAT_ID = "runyth-backup-framework/archive";
export const FORMAT_VERSION = 1;
export const AUDIT_FORMAT_ID = "runyth-backup-framework/audit-store";
export const AUDIT_FORMAT_VERSION = 1;
export const MANIFEST_PATH = "backup-framework.json";
export const DEFAULT_FILENAME_REGEX = String.raw`^(?<module>[a-z0-9][a-z0-9-]*)-(?<operation>backup|export)-(?<moduleVersion>\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?)-(?<created>\d{8}T\d{6}Z)\.zip$`;
