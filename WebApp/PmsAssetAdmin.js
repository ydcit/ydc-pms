var PMS = PMS || {};

/**
 * Adding and editing assets (tag, status, location) from the app instead of
 * by hand-editing columns A-C of the tracker sheets.
 *
 * Direct sheet edits bypass the cache PMS.Assets keeps, so a status change
 * made in Sheets does not reliably show up in the app until that cache
 * expires on its own — the same class of problem every other write in this
 * app avoids by calling PMS.Assets.invalidate() the moment it changes
 * something. Routing asset edits through here fixes that: every write below
 * invalidates the section's cache before returning, so the app sees the
 * change on the very next read.
 *
 * Scope is intentionally narrower than PMS.Auth.requireAdmin: an
 * administrator can always do this, but so can any technician whose roster
 * row carries the Asset Manager permission, without handing them rollover,
 * the danger zone, or year deletion.
 */
PMS.AssetAdmin = (function () {
  var BULK_CACHE_PREFIX = 'PMS_ASSET_BULK_';
  var BULK_TOKEN_SECONDS = 600;
  var BULK_MAX_ROWS = 2000;
  var STATUS_COLUMN = 2;
  var LOCATION_COLUMN = 3;

  function sheetFor(sectionKey) {
    return PMS.Assets.sheetForSection(sectionKey);
  }

  /** An asset manager may only work in their own section; an admin may pick any. */
  function requireSectionAccess(context, sectionKey) {
    var section = PMS.Util.section(sectionKey);
    if (!context.isAdmin && section.key !== context.section) {
      PMS.Util.fail('You can manage assets only in your own registered IT section.', 'ACCESS_DENIED');
    }
    return section;
  }

  /**
   * Every asset row as it stands right now: tag, status, location, its
   * current cycle's PMS status (the T1/T2/T3 tracker cell for whichever
   * cycle is open today - COMPLETED, FOR FIXING, IN PROGRESS, ON HOLD,
   * DEFERRED, or blank if not yet touched this cycle), and sheet row.
   */
  function readRows(sectionKey) {
    var sheet = sheetFor(sectionKey);
    var lastRow = sheet.getLastRow();
    if (lastRow < PMS.CONFIG.ASSET_DATA_START_ROW) return [];
    var count = lastRow - PMS.CONFIG.ASSET_DATA_START_ROW + 1;
    var pmsStatusColumn = PMS.CONFIG.CYCLES[PMS.Util.currentCycle().cycle].checkboxColumn;
    var values = sheet.getRange(PMS.CONFIG.ASSET_DATA_START_ROW, 1, count, pmsStatusColumn).getDisplayValues();
    var rows = [];
    values.forEach(function (row, index) {
      var tag = PMS.Util.normalizeAssetTag(row[0]);
      if (!tag) return;
      rows.push({
        tag: tag,
        status: PMS.Util.cleanText(row[1], 100).toUpperCase(),
        location: PMS.Util.cleanText(row[2], 500),
        pmsStatus: PMS.Util.cleanText(row[pmsStatusColumn - 1], 100).toUpperCase(),
        row: PMS.CONFIG.ASSET_DATA_START_ROW + index
      });
    });
    return rows;
  }

  function findRow(rows, tag) {
    for (var index = 0; index < rows.length; index += 1) {
      if (rows[index].tag === tag) return rows[index];
    }
    return null;
  }

  /** Distinct status values already in use, so the editor can suggest real vocabulary instead of inventing one. */
  function statusSuggestions(rows) {
    var seen = {};
    var list = [];
    rows.forEach(function (row) {
      if (!row.status || seen[row.status]) return;
      seen[row.status] = true;
      list.push(row.status);
    });
    return list.sort();
  }

  /**
   * Viewing the asset list is open to any registered user, not just an
   * asset manager or admin - create/update/downloadTemplate/bulkPreview/
   * bulkExecute all still gate on requireAssetManager below, unchanged, so
   * this only widens who can look, never who can write.
   */
  function list(sectionKey) {
    var context = PMS.Auth.requireProfile();
    var section = requireSectionAccess(context, sectionKey || context.section);
    var rows = readRows(section.key);
    return {
      ok: true,
      section: section.key,
      sectionLabel: section.label,
      assets: rows,
      statusSuggestions: statusSuggestions(rows),
      canEdit: context.isAdmin || context.canManageAssets,
      // Only an admin gets to switch sections; anyone else only ever sees
      // their own, so there is nothing to choose from.
      sections: context.isAdmin ? Object.keys(PMS.CONFIG.SECTIONS).map(function (key) {
        return { key: key, label: PMS.CONFIG.SECTIONS[key].label };
      }) : []
    };
  }

  function normalizeAssetInput(request) {
    var input = request && typeof request === 'object' ? request : {};
    var tag = PMS.Util.normalizeAssetTag(input.tag);
    if (!tag) PMS.Util.fail('An asset tag is required.', 'VALIDATION_ERROR');
    var status = PMS.Util.cleanText(input.status, 100).toUpperCase();
    if (!status) PMS.Util.fail('A status is required.', 'VALIDATION_ERROR');
    var location = PMS.Util.cleanText(input.location, 500);
    return { tag: tag, status: status, location: location };
  }

  function create(request) {
    var context = PMS.Auth.requireAssetManager();
    var normalized = normalizeAssetInput(request);
    var section = requireSectionAccess(context, (request && request.section) || context.section);
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) PMS.Util.fail('Assets are busy. Try again shortly.', 'BUSY');
    try {
      var rows = readRows(section.key);
      if (findRow(rows, normalized.tag)) {
        PMS.Util.fail(normalized.tag + ' already exists in ' + section.label + '.', 'VALIDATION_ERROR');
      }
      var sheet = sheetFor(section.key);
      var targetRow = Math.max(sheet.getLastRow() + 1, PMS.CONFIG.ASSET_DATA_START_ROW);
      sheet.getRange(targetRow, 1, 1, 3).setValues([[normalized.tag, normalized.status, normalized.location]]);
      PMS.Assets.invalidate(section.key);
      return { ok: true, tag: normalized.tag, status: normalized.status, location: normalized.location, row: targetRow, section: section.key };
    } finally {
      lock.releaseLock();
    }
  }

  function update(request) {
    var context = PMS.Auth.requireAssetManager();
    var normalized = normalizeAssetInput(request);
    var section = requireSectionAccess(context, (request && request.section) || context.section);
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) PMS.Util.fail('Assets are busy. Try again shortly.', 'BUSY');
    try {
      var rows = readRows(section.key);
      var existing = findRow(rows, normalized.tag);
      if (!existing) PMS.Util.fail(normalized.tag + ' was not found in ' + section.label + '.', 'NOT_FOUND');
      var sheet = sheetFor(section.key);
      sheet.getRange(existing.row, STATUS_COLUMN, 1, 2).setValues([[normalized.status, normalized.location]]);
      PMS.Assets.invalidate(section.key);
      return { ok: true, tag: normalized.tag, status: normalized.status, location: normalized.location, row: existing.row, section: section.key };
    } finally {
      lock.releaseLock();
    }
  }

  /* ------------------------------------------------------------- bulk CSV */

  function csvEscape(value) {
    var text = value === null || value === undefined ? '' : String(value);
    if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function toCsv(rows) {
    var lines = [['Asset Tag', 'Status', 'Location'].map(csvEscape).join(',')];
    rows.forEach(function (row) {
      lines.push([row.tag, row.status, row.location].map(csvEscape).join(','));
    });
    // Trailing newline after the last row too: a downloaded file that ends
    // mid-line is the one shape a spreadsheet editor's own "add a row" never
    // produces, but a person appending a line by hand in a plain text editor
    // easily could — this keeps that safe either way.
    return lines.join('\r\n') + '\r\n';
  }

  /**
   * A downloadable, pre-filled starting point: every current asset in the
   * section, ready to be edited in place for updates and appended to at the
   * bottom for additions. Downloading first and re-uploading the same shape
   * is what lets one file cover both add and edit without a separate mode.
   */
  function downloadTemplate(sectionKey) {
    var context = PMS.Auth.requireAssetManager();
    var section = requireSectionAccess(context, sectionKey || context.section);
    var rows = readRows(section.key);
    return {
      ok: true,
      section: section.key,
      sectionLabel: section.label,
      filename: 'PMS-Assets-' + section.key + '.csv',
      csvText: toCsv(rows),
      assetCount: rows.length
    };
  }

  function bulkCacheKey(sectionKey, email) {
    return BULK_CACHE_PREFIX + PMS.Util.hashText(sectionKey + '|' + email).slice(0, 32);
  }

  function parseCsvRows(csvText) {
    // Excel prefixes a UTF-8 CSV it saves with a byte-order mark; left in
    // place, it silently attaches itself to the first header cell and the
    // header-detection below would no longer recognise "Asset Tag".
    var text = String(csvText || '').replace(/^﻿/, '');
    if (!text.trim()) return [];
    var table;
    try {
      table = Utilities.parseCsv(text);
    } catch (error) {
      PMS.Util.fail('The uploaded file is not valid CSV.', 'VALIDATION_ERROR');
    }
    if (!table.length) return [];
    var firstCell = String((table[0] && table[0][0]) || '').trim().toLowerCase();
    var hasHeader = firstCell === 'asset tag' || firstCell === 'tag';
    return hasHeader ? table.slice(1) : table;
  }

  /**
   * What a bulk upload would change. Read-only, and it hands back the token
   * execute has to return, mirroring every other bulk write in this app.
   */
  function bulkPreview(request) {
    var context = PMS.Auth.requireAssetManager();
    var input = request && typeof request === 'object' ? request : {};
    var section = requireSectionAccess(context, input.section || context.section);
    var parsedRows = parseCsvRows(input.csvText);
    if (!parsedRows.length) PMS.Util.fail('The file has no asset rows to import.', 'VALIDATION_ERROR');
    if (parsedRows.length > BULK_MAX_ROWS) {
      PMS.Util.fail('A bulk upload can contain at most ' + BULK_MAX_ROWS + ' rows.', 'VALIDATION_ERROR');
    }

    var existingByTag = {};
    readRows(section.key).forEach(function (row) { existingByTag[row.tag] = row; });

    var seenInFile = {};
    var results = parsedRows.map(function (cells) {
      var rawTag = cells[0];
      var tag = PMS.Util.normalizeAssetTag(rawTag);
      var status = PMS.Util.cleanText(cells[1], 100).toUpperCase();
      var location = PMS.Util.cleanText(cells[2], 500);
      if (!tag) {
        return { tag: PMS.Util.cleanText(rawTag, 100), status: status, location: location, classification: 'INVALID', message: 'Missing or invalid asset tag.' };
      }
      if (!status) {
        return { tag: tag, status: status, location: location, classification: 'INVALID', message: 'Missing status.' };
      }
      if (seenInFile[tag]) {
        return { tag: tag, status: status, location: location, classification: 'INVALID', message: 'Duplicate asset tag in this file.' };
      }
      seenInFile[tag] = true;
      var current = existingByTag[tag];
      if (!current) {
        return { tag: tag, status: status, location: location, classification: 'NEW', message: 'Will be added.' };
      }
      if (current.status === status && current.location === location) {
        return { tag: tag, status: status, location: location, classification: 'UNCHANGED', message: 'No change.' };
      }
      return {
        tag: tag, status: status, location: location, classification: 'UPDATED',
        message: 'Was ' + (current.status || '—') + ' / ' + (current.location || '—') + '.'
      };
    });

    var counts = {
      total: results.length,
      newCount: results.filter(function (row) { return row.classification === 'NEW'; }).length,
      updated: results.filter(function (row) { return row.classification === 'UPDATED'; }).length,
      unchanged: results.filter(function (row) { return row.classification === 'UNCHANGED'; }).length,
      invalid: results.filter(function (row) { return row.classification === 'INVALID'; }).length
    };
    var applyRows = results.filter(function (row) { return row.classification === 'NEW' || row.classification === 'UPDATED'; });
    var token = '';
    if (applyRows.length) {
      token = Utilities.getUuid();
      CacheService.getScriptCache().put(bulkCacheKey(section.key, context.email), JSON.stringify({
        token: token,
        email: context.email,
        section: section.key,
        rows: applyRows
      }), BULK_TOKEN_SECONDS);
    }
    return {
      ok: true,
      section: section.key,
      sectionLabel: section.label,
      counts: counts,
      applyCount: applyRows.length,
      rows: results.slice(0, 500),
      truncated: results.length > 500,
      confirmationPhrase: applyRows.length ? 'UPDATE ' + applyRows.length : '',
      confirmationToken: token,
      expiresInSeconds: token ? BULK_TOKEN_SECONDS : 0
    };
  }

  function bulkExecute(sectionKey, confirmationToken, phrase) {
    var context = PMS.Auth.requireAssetManager();
    var section = requireSectionAccess(context, sectionKey || context.section);
    var key = bulkCacheKey(section.key, context.email);
    var raw = CacheService.getScriptCache().get(key);
    if (!raw) PMS.Util.fail('The bulk upload preview expired. Preview it again.', 'IMPORT_TOKEN_EXPIRED');
    var state;
    try {
      state = JSON.parse(raw);
    } catch (error) {
      PMS.Util.fail('The bulk upload preview is corrupt. Preview it again.', 'IMPORT_TOKEN_INVALID');
    }
    if (state.token !== confirmationToken || state.email !== context.email || state.section !== section.key) {
      PMS.Util.fail('The bulk upload confirmation is invalid.', 'ACCESS_DENIED');
    }
    var expectedPhrase = 'UPDATE ' + state.rows.length;
    if (String(phrase || '').trim().toUpperCase() !== expectedPhrase.toUpperCase()) {
      PMS.Util.fail('Type "' + expectedPhrase + '" to confirm.', 'VALIDATION_ERROR');
    }
    CacheService.getScriptCache().remove(key);

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) PMS.Util.fail('Assets are busy. Try again shortly.', 'BUSY');
    try {
      var existingByTag = {};
      readRows(section.key).forEach(function (row) { existingByTag[row.tag] = row; });
      var sheet = sheetFor(section.key);
      var nextRow = Math.max(sheet.getLastRow() + 1, PMS.CONFIG.ASSET_DATA_START_ROW);
      var added = 0;
      var updated = 0;
      state.rows.forEach(function (row) {
        var current = existingByTag[row.tag];
        if (current) {
          sheet.getRange(current.row, STATUS_COLUMN, 1, 2).setValues([[row.status, row.location]]);
          updated += 1;
        } else {
          sheet.getRange(nextRow, 1, 1, 3).setValues([[row.tag, row.status, row.location]]);
          existingByTag[row.tag] = { tag: row.tag, row: nextRow };
          nextRow += 1;
          added += 1;
        }
      });
      PMS.Assets.invalidate(section.key);
      return {
        ok: true,
        section: section.key,
        added: added,
        updated: updated,
        message: 'Added ' + added + ' and updated ' + updated + ' asset(s) in ' + section.label + '.'
      };
    } finally {
      lock.releaseLock();
    }
  }

  return {
    list: list,
    create: create,
    update: update,
    downloadTemplate: downloadTemplate,
    bulkPreview: bulkPreview,
    bulkExecute: bulkExecute
  };
})();
