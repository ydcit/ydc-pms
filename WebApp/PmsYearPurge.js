var PMS = PMS || {};

/**
 * Deleting a whole closed year's data to reclaim space.
 *
 * PMS Records, PMS Tickets and PMS Ticket Log are append-only by design —
 * nothing about a normal year of operation ever removes a row from them.
 * That is exactly right while a year might still be looked at, but it also
 * means the workbook only ever grows. This module is the deliberate,
 * audited escape hatch: an administrator can retire one closed year at a
 * time, once it is safely a photograph of itself in a downloaded backup.
 *
 * Three things make this safe enough to expose as a button:
 *   - Only a year that is not the live tracker year is eligible. The year
 *     currently being worked can never be a target.
 *   - A year with any unresolved ticket is refused outright, the same way
 *     rollover already refuses to close a year with pending tracker syncs.
 *   - Execution requires a backup token that only buildBackup() can hand
 *     out, and buildBackup() only runs after consuming a token that only
 *     preview() can hand out. There is no way to reach execute() without
 *     the server itself having produced a downloadable backup first — this
 *     is enforced by the token chain, not merely suggested by the UI.
 */
PMS.YearPurge = (function () {
  var PREVIEW_TOKEN_SECONDS = 300;
  // Longer than the preview token: downloading a zip and actually looking at
  // it takes longer than reading a summary and typing a phrase.
  var BACKUP_TOKEN_SECONDS = 900;
  var LAST_PURGE_PROPERTY = 'PMS_LAST_YEAR_PURGE';

  function previewCacheKey(email, year) {
    return 'PMS_YEAR_PURGE_PREVIEW_' + PMS.Util.hashText(email + '|' + year).slice(0, 24);
  }

  function backupCacheKey(email, year) {
    return 'PMS_YEAR_PURGE_BACKUP_' + PMS.Util.hashText(email + '|' + year).slice(0, 24);
  }

  /** Typing the year itself, not a static word, so confirming one year can never be mistaken for another. */
  function confirmationPhrase(year) {
    return 'DELETE ' + year;
  }

  function columnIndexOf(columns, key) {
    for (var index = 0; index < columns.length; index += 1) {
      if (columns[index].key === key) return index;
    }
    return -1;
  }

  function safeFileName(name) {
    return String(name || 'sheet').replace(/[\\/:*?"<>|]/g, '-');
  }

  function csvEscape(value) {
    var text = value === null || value === undefined ? '' : String(value);
    if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function toCsv(headers, rows) {
    var lines = [headers.map(csvEscape).join(',')];
    rows.forEach(function (row) { lines.push(row.map(csvEscape).join(',')); });
    return lines.join('\r\n');
  }

  function activeTrackerYears() {
    return Object.keys(PMS.CONFIG.SECTIONS).map(function (sectionKey) {
      var sheet = PMS.Assets.sheetForSection(sectionKey);
      return Number(sheet.getRange(PMS.CONFIG.TRACKER_YEAR_ROW, PMS.CONFIG.TRACKER_YEAR_COLUMN).getValue()) || 0;
    });
  }

  /**
   * Throws if this year cannot be purged. Shared by preview, buildBackup and
   * execute so the three can never disagree about what is allowed — each
   * step re-checks rather than trusting the previous one's answer, since
   * real time passes between them (an admin reading a preview, downloading
   * a zip, typing a phrase).
   */
  function assertEligible(targetYear) {
    if (activeTrackerYears().indexOf(targetYear) >= 0) {
      PMS.Util.fail(
        targetYear + ' is still the open PMS tracker year. Roll over to a new year before deleting it.',
        'YEAR_PURGE_BLOCKED'
      );
    }
    var tickets = PMS.Tickets.ticketsForYear(targetYear);
    var stillActive = tickets.filter(function (ticket) { return ticket.isActive; });
    if (stillActive.length) {
      PMS.Util.fail(
        stillActive.length + ' ticket(s) from ' + targetYear + ' are still unresolved. Resolve or close them before deleting this year.',
        'YEAR_PURGE_BLOCKED'
      );
    }
    return tickets;
  }

  function recordCountsFor(targetYear) {
    return PMS.Records.recordSheets(false).map(function (entry) {
      var yearColumn = columnIndexOf(entry.definition.columns, 'maintenanceYear');
      var count = 0;
      if (yearColumn >= 0 && entry.sheet.getLastRow() >= 2) {
        var values = entry.sheet.getRange(2, yearColumn + 1, entry.sheet.getLastRow() - 1, 1).getDisplayValues();
        values.forEach(function (row) { if (Number(row[0]) === targetYear) count += 1; });
      }
      return { sheetName: entry.sheet.getName(), rows: count };
    });
  }

  function archivedTrackersFor(targetYear) {
    var match = PMS.Rollover.archivedYears().filter(function (entry) { return entry.year === targetYear; });
    return match.length ? match[0].sections : [];
  }

  /** Years that exist anywhere in the workbook and are not the live tracker year. */
  function eligibleYears() {
    PMS.Auth.requireAdmin();
    var active = activeTrackerYears();
    var years = {};
    PMS.Records.recordSheets(false).forEach(function (entry) {
      var yearColumn = columnIndexOf(entry.definition.columns, 'maintenanceYear');
      if (yearColumn < 0 || entry.sheet.getLastRow() < 2) return;
      var values = entry.sheet.getRange(2, yearColumn + 1, entry.sheet.getLastRow() - 1, 1).getDisplayValues();
      values.forEach(function (row) {
        var year = Number(row[0]);
        if (year) years[year] = true;
      });
    });
    PMS.Rollover.archivedYears().forEach(function (entry) { years[entry.year] = true; });
    return Object.keys(years).map(Number)
      .filter(function (year) { return active.indexOf(year) < 0; })
      .sort(function (a, b) { return b - a; });
  }

  /**
   * What a purge would remove, and the token that lets buildBackup produce
   * the mandatory backup. Read-only: nothing here changes the spreadsheet.
   */
  function preview(year) {
    var admin = PMS.Auth.requireAdmin();
    var targetYear = Number(year);
    if (!/^\d{4}$/.test(String(targetYear))) PMS.Util.fail('Enter a valid four-digit year.', 'VALIDATION_ERROR');

    var tickets = assertEligible(targetYear);
    var recordCounts = recordCountsFor(targetYear);
    var totalRecords = recordCounts.reduce(function (sum, entry) { return sum + entry.rows; }, 0);
    var archived = archivedTrackersFor(targetYear);

    if (!totalRecords && !tickets.length && !archived.length) {
      PMS.Util.fail('There is nothing recorded for ' + targetYear + '.', 'YEAR_PURGE_BLOCKED');
    }

    var token = Utilities.getUuid();
    CacheService.getScriptCache().put(
      previewCacheKey(admin.email, targetYear),
      JSON.stringify({ token: token, email: admin.email, year: targetYear }),
      PREVIEW_TOKEN_SECONDS
    );

    return {
      ok: true,
      year: targetYear,
      records: recordCounts,
      totalRecords: totalRecords,
      ticketCount: tickets.length,
      archivedTrackerSheets: archived,
      phrase: confirmationPhrase(targetYear),
      confirmationToken: token,
      expiresInSeconds: PREVIEW_TOKEN_SECONDS,
      lastPurge: lastPurge()
    };
  }

  function readPreviewConfirmation(admin, year, token) {
    var key = previewCacheKey(admin.email, year);
    var raw = CacheService.getScriptCache().get(key);
    if (!raw) PMS.Util.fail('The preview expired. Review the summary again.', 'YEAR_PURGE_TOKEN_EXPIRED');
    var data = JSON.parse(raw);
    if (data.token !== token || data.email !== admin.email || Number(data.year) !== Number(year)) {
      PMS.Util.fail('The preview confirmation is invalid.', 'ACCESS_DENIED');
    }
    CacheService.getScriptCache().remove(key);
    return data;
  }

  function readBackupConfirmation(admin, year, token) {
    var key = backupCacheKey(admin.email, year);
    var raw = CacheService.getScriptCache().get(key);
    if (!raw) {
      PMS.Util.fail('Download the backup again before deleting — the confirmation expired.', 'YEAR_PURGE_BACKUP_REQUIRED');
    }
    var data = JSON.parse(raw);
    if (data.token !== token || data.email !== admin.email || Number(data.year) !== Number(year)) {
      PMS.Util.fail('The backup confirmation is invalid.', 'ACCESS_DENIED');
    }
    CacheService.getScriptCache().remove(key);
    return data;
  }

  /**
   * Builds the downloadable backup and, only on success, hands back the
   * token execute() requires. Consumes the preview token, so a backup can
   * only be built once per preview — asking for the summary again is what
   * gets a fresh one.
   */
  function buildBackup(year, previewToken) {
    var admin = PMS.Auth.requireAdmin();
    var targetYear = Number(year);
    readPreviewConfirmation(admin, targetYear, previewToken);
    assertEligible(targetYear);

    var tickets = PMS.Tickets.ticketsForYear(targetYear);
    var ticketIds = {};
    tickets.forEach(function (ticket) { ticketIds[ticket.ticketId] = true; });

    var blobs = [];

    PMS.Records.recordSheets(false).forEach(function (entry) {
      var yearColumn = columnIndexOf(entry.definition.columns, 'maintenanceYear');
      if (yearColumn < 0 || entry.sheet.getLastRow() < 2) return;
      var values = entry.sheet.getRange(2, 1, entry.sheet.getLastRow() - 1, entry.definition.columns.length).getValues();
      var matched = values.filter(function (row) { return Number(row[yearColumn]) === targetYear; });
      if (!matched.length) return;
      var headers = entry.definition.columns.map(function (column) { return column.label; });
      blobs.push(Utilities.newBlob(toCsv(headers, matched), 'text/csv', safeFileName(entry.sheet.getName()) + '.csv'));
    });

    if (tickets.length) {
      var ticketSheet = PMS.Assets.spreadsheet().getSheetByName(PMS.CONFIG.TICKET_SHEET);
      var ticketColumns = PMS.Tickets.ticketColumns();
      if (ticketSheet && ticketSheet.getLastRow() >= 2) {
        var ticketIdIndex = columnIndexOf(ticketColumns, 'ticketId');
        var ticketValues = ticketSheet.getRange(2, 1, ticketSheet.getLastRow() - 1, ticketColumns.length).getValues();
        var matchedTickets = ticketValues.filter(function (row) { return ticketIds[String(row[ticketIdIndex] || '').trim()]; });
        blobs.push(Utilities.newBlob(
          toCsv(ticketColumns.map(function (column) { return column.label; }), matchedTickets),
          'text/csv', safeFileName(PMS.CONFIG.TICKET_SHEET) + '.csv'
        ));
      }
      var logSheet = PMS.Assets.spreadsheet().getSheetByName(PMS.CONFIG.TICKET_LOG_SHEET);
      var logColumns = PMS.Tickets.logColumns();
      if (logSheet && logSheet.getLastRow() >= 2) {
        var logTicketIndex = columnIndexOf(logColumns, 'ticketId');
        var logValues = logSheet.getRange(2, 1, logSheet.getLastRow() - 1, logColumns.length).getValues();
        var matchedLog = logValues.filter(function (row) { return ticketIds[String(row[logTicketIndex] || '').trim()]; });
        blobs.push(Utilities.newBlob(
          toCsv(logColumns.map(function (column) { return column.label; }), matchedLog),
          'text/csv', safeFileName(PMS.CONFIG.TICKET_LOG_SHEET) + '.csv'
        ));
      }
    }

    archivedTrackersFor(targetYear).forEach(function (section) {
      var sheet = PMS.Assets.spreadsheet().getSheetByName(section.sheetName);
      if (!sheet) return;
      var lastRow = sheet.getLastRow();
      var lastCol = sheet.getLastColumn();
      if (lastRow < 1 || lastCol < 1) return;
      var grid = sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
      blobs.push(Utilities.newBlob(
        grid.map(function (row) { return row.map(csvEscape).join(','); }).join('\r\n'),
        'text/csv', safeFileName(section.sheetName) + '.csv'
      ));
    });

    if (!blobs.length) {
      PMS.Util.fail('There is nothing recorded for ' + targetYear + ' to back up.', 'YEAR_PURGE_BLOCKED');
    }

    var zipName = 'PMS-' + targetYear + '-backup.zip';
    var zip = Utilities.zip(blobs, zipName);
    var bytes = zip.getBytes();

    var token = Utilities.getUuid();
    CacheService.getScriptCache().put(
      backupCacheKey(admin.email, targetYear),
      JSON.stringify({ token: token, email: admin.email, year: targetYear }),
      BACKUP_TOKEN_SECONDS
    );

    return {
      ok: true,
      year: targetYear,
      filename: zipName,
      base64: Utilities.base64Encode(bytes),
      bytes: bytes.length,
      backupToken: token,
      expiresInSeconds: BACKUP_TOKEN_SECONDS
    };
  }

  function rewriteKeepingRows(sheet, keepPredicate, columnCount) {
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { kept: 0, removed: 0 };
    var count = lastRow - 1;
    var values = sheet.getRange(2, 1, count, columnCount).getValues();
    var kept = values.filter(keepPredicate);
    sheet.getRange(2, 1, count, columnCount).clearContent();
    if (kept.length) sheet.getRange(2, 1, kept.length, columnCount).setValues(kept);
    return { kept: kept.length, removed: values.length - kept.length };
  }

  function recordPurge(admin, summary) {
    try {
      PropertiesService.getScriptProperties().setProperty(LAST_PURGE_PROPERTY, JSON.stringify({
        at: PMS.Util.nowIso(),
        by: admin.email,
        year: summary.year,
        recordsRemoved: summary.records.reduce(function (sum, entry) { return sum + entry.rowsRemoved; }, 0),
        ticketsRemoved: summary.ticketsRemoved,
        logEntriesRemoved: summary.logEntriesRemoved,
        archivedSheetsRemoved: summary.archivedSheetsRemoved
      }));
    } catch (error) {
      console.warn('The year-purge audit note could not be written: ' + error.message);
    }
  }

  function lastPurge() {
    try {
      var raw = PropertiesService.getScriptProperties().getProperty(LAST_PURGE_PROPERTY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Deletes everything recorded for one year. Requires a backup token that
   * only buildBackup() issues, so this cannot run without a downloadable
   * backup having actually been produced first.
   */
  function execute(year, backupToken, phrase) {
    var admin = PMS.Auth.requireAdmin();
    var targetYear = Number(year);
    if (String(phrase || '').trim().toUpperCase() !== confirmationPhrase(targetYear).toUpperCase()) {
      PMS.Util.fail('Type "' + confirmationPhrase(targetYear) + '" to confirm.', 'VALIDATION_ERROR');
    }
    readBackupConfirmation(admin, targetYear, backupToken);

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) PMS.Util.fail('Another maintenance operation is running.', 'BUSY');
    try {
      assertEligible(targetYear);
      var tickets = PMS.Tickets.ticketsForYear(targetYear);
      var ticketIds = {};
      tickets.forEach(function (ticket) { ticketIds[ticket.ticketId] = true; });

      var recordResults = PMS.Records.recordSheets(false).map(function (entry) {
        var yearColumn = columnIndexOf(entry.definition.columns, 'maintenanceYear');
        var result = yearColumn < 0
          ? { removed: 0 }
          : rewriteKeepingRows(entry.sheet, function (row) { return Number(row[yearColumn]) !== targetYear; }, entry.definition.columns.length);
        return { sheetName: entry.sheet.getName(), rowsRemoved: result.removed };
      });

      var ticketSheet = PMS.Assets.spreadsheet().getSheetByName(PMS.CONFIG.TICKET_SHEET);
      var ticketColumns = PMS.Tickets.ticketColumns();
      var ticketIdIndex = columnIndexOf(ticketColumns, 'ticketId');
      var ticketResult = ticketSheet
        ? rewriteKeepingRows(ticketSheet, function (row) { return !ticketIds[String(row[ticketIdIndex] || '').trim()]; }, ticketColumns.length)
        : { removed: 0 };

      var logSheet = PMS.Assets.spreadsheet().getSheetByName(PMS.CONFIG.TICKET_LOG_SHEET);
      var logColumns = PMS.Tickets.logColumns();
      var logTicketIndex = columnIndexOf(logColumns, 'ticketId');
      var logResult = logSheet
        ? rewriteKeepingRows(logSheet, function (row) { return !ticketIds[String(row[logTicketIndex] || '').trim()]; }, logColumns.length)
        : { removed: 0 };

      var archivedSheetsRemoved = [];
      archivedTrackersFor(targetYear).forEach(function (section) {
        var book = PMS.Assets.spreadsheet();
        var sheet = book.getSheetByName(section.sheetName);
        if (!sheet) return;
        book.deleteSheet(sheet);
        archivedSheetsRemoved.push(section.sheetName);
      });

      SpreadsheetApp.flush();
      PMS.Records.markChanged();
      PMS.Tickets.markChanged();

      // Stamped with the current live year, never the purged one, so this
      // audit trail can never itself become the target of a later purge.
      var current = PMS.Util.currentCycle();
      PMS.Records.appendSystemEvent('YEARPURGE-' + targetYear + '-' + Utilities.getUuid().slice(0, 8), 'YEAR_PURGED', {
        year: current.year,
        purgedYear: targetYear,
        adminEmail: admin.email,
        adminName: admin.name,
        recordsRemoved: recordResults.reduce(function (sum, entry) { return sum + entry.rowsRemoved; }, 0),
        ticketsRemoved: ticketResult.removed,
        logEntriesRemoved: logResult.removed,
        archivedSheetsRemoved: archivedSheetsRemoved,
        timestamp: PMS.Util.nowIso()
      });

      var summary = {
        ok: true,
        year: targetYear,
        records: recordResults,
        ticketsRemoved: ticketResult.removed,
        logEntriesRemoved: logResult.removed,
        archivedSheetsRemoved: archivedSheetsRemoved,
        message: 'Deleted every record, ticket and archived tracker sheet for ' + targetYear + '.'
      };
      recordPurge(admin, summary);
      return summary;
    } finally {
      lock.releaseLock();
    }
  }

  return {
    eligibleYears: eligibleYears,
    preview: preview,
    buildBackup: buildBackup,
    execute: execute,
    lastPurge: lastPurge,
    confirmationPhrase: confirmationPhrase
  };
})();
