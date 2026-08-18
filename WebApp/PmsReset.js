var PMS = PMS || {};

/**
 * Clearing test data without clearing the setup.
 *
 * After a pilot the spreadsheet holds records, tickets and tracker ticks that
 * nobody wants in the real numbers, alongside things that took real effort to
 * arrange: the roster, the notification list, the sheet headers, the column
 * widths, the validation. Deleting the sheets and running setup again throws
 * away the second group to get rid of the first.
 *
 * So this clears rows and leaves everything else standing. The two lists below
 * are the contract, and they are what the browser is shown before it is allowed
 * to confirm — the preview and the execution read the same declarations, so they
 * cannot describe different things.
 */
PMS.Reset = (function () {
  /*
    A reset is confirmed twice: the administrator types the phrase, and the
    server hands out a token that the execute call has to give back. The token is
    per-administrator and short-lived, which is the same shape the rollover and
    the legacy import already use.
  */
  var TOKEN_SECONDS = 300;
  var CONFIRMATION_PHRASE = 'RESET';
  var LAST_RESET_PROPERTY = 'PMS_LAST_RESET';

  function spreadsheet() {
    return SpreadsheetApp.openById(PMS.CONFIG.SPREADSHEET_ID);
  }

  function cacheKey(email) {
    return 'PMS_RESET_' + String(email || '').toLowerCase();
  }

  /** Sheets whose data rows go. Headers, formats and validation stay. */
  function clearedSheetNames() {
    return [
      PMS.CONFIG.RESPONSE_SHEET,
      PMS.CONFIG.INFRA_RESPONSE_SHEET,
      PMS.CONFIG.TICKET_SHEET,
      PMS.CONFIG.TICKET_LOG_SHEET
    ];
  }

  /** Stated in the interface so nobody has to guess what survives. */
  function keptDescriptions() {
    return [
      'Users and their IT sections, in ' + 'PMS Users',
      'Email recipients, in ' + PMS.CONFIG.NOTIFY_SHEET,
      'Every asset in the tracker sheets, with its status and location',
      'Sheet headers, column widths, dropdowns and filters',
      'Administrator list and saved deployment settings'
    ];
  }

  function dataRowCount(sheet) {
    if (!sheet) return 0;
    return Math.max(0, sheet.getLastRow() - 1);
  }

  /**
   * How many tracker cycle cells currently hold something.
   *
   * Counted rather than assumed so the preview can say "and 34 tracker cells"
   * instead of "and some tracker cells", which is the difference between a
   * confirmation somebody reads and one they click through.
   */
  function trackerSummary(sectionKey) {
    var sheet = PMS.Assets.sheetForSection(sectionKey);
    var startRow = PMS.CONFIG.ASSET_DATA_START_ROW;
    var lastRow = sheet.getLastRow();
    var summary = {
      section: sectionKey,
      sheetName: sheet.getName(),
      trackerYear: Number(sheet.getRange(PMS.CONFIG.TRACKER_YEAR_ROW, PMS.CONFIG.TRACKER_YEAR_COLUMN).getValue()) || 0,
      assets: 0,
      filledCells: 0
    };
    if (lastRow < startRow) return summary;

    var count = lastRow - startRow + 1;
    summary.assets = count;
    var values = sheet.getRange(startRow, firstCycleColumn(), count, cycleColumnCount()).getValues();
    values.forEach(function (row) {
      row.forEach(function (value) {
        if (String(value === null || value === undefined ? '' : value).trim() !== '') summary.filledCells += 1;
      });
    });
    return summary;
  }

  /*
    The cycle block is contiguous — status and remarks for T1, T2, T3 — so it is
    read and written as one range. Derived from the configured columns rather
    than hard-coded, so adding a cycle does not silently leave one behind.
  */
  function firstCycleColumn() {
    return Object.keys(PMS.CONFIG.CYCLES).reduce(function (lowest, key) {
      var cycle = PMS.CONFIG.CYCLES[key];
      return Math.min(lowest, cycle.checkboxColumn, cycle.remarksColumn);
    }, Number.MAX_SAFE_INTEGER);
  }

  function lastCycleColumn() {
    return Object.keys(PMS.CONFIG.CYCLES).reduce(function (highest, key) {
      var cycle = PMS.CONFIG.CYCLES[key];
      return Math.max(highest, cycle.checkboxColumn, cycle.remarksColumn);
    }, 0);
  }

  function cycleColumnCount() {
    return lastCycleColumn() - firstCycleColumn() + 1;
  }

  /**
   * What a reset would remove, and the token that authorises removing it.
   *
   * Read-only. Nothing here changes the spreadsheet, so an administrator can
   * look at the numbers and walk away.
   */
  function preview() {
    var admin = PMS.Auth.requireAdmin();
    var book = spreadsheet();

    var sheets = clearedSheetNames().map(function (name) {
      var sheet = book.getSheetByName(name);
      return { sheetName: name, present: Boolean(sheet), rows: dataRowCount(sheet) };
    });
    var trackers = Object.keys(PMS.CONFIG.SECTIONS).map(trackerSummary);

    var token = Utilities.getUuid();
    CacheService.getScriptCache().put(
      cacheKey(admin.email),
      JSON.stringify({ token: token, email: admin.email }),
      TOKEN_SECONDS
    );

    return {
      ok: true,
      sheets: sheets,
      trackers: trackers,
      totals: {
        rows: sheets.reduce(function (sum, entry) { return sum + entry.rows; }, 0),
        trackerCells: trackers.reduce(function (sum, entry) { return sum + entry.filledCells; }, 0)
      },
      kept: keptDescriptions(),
      phrase: CONFIRMATION_PHRASE,
      confirmationToken: token,
      expiresInSeconds: TOKEN_SECONDS,
      lastReset: lastReset()
    };
  }

  function readConfirmation(admin, token, phrase) {
    if (String(phrase || '').trim().toUpperCase() !== CONFIRMATION_PHRASE) {
      PMS.Util.fail('Type ' + CONFIRMATION_PHRASE + ' to confirm the reset.', 'VALIDATION_ERROR');
    }
    var key = cacheKey(admin.email);
    var raw = CacheService.getScriptCache().get(key);
    if (!raw) PMS.Util.fail('The reset confirmation expired. Review the summary again.', 'RESET_TOKEN_EXPIRED');
    var data = JSON.parse(raw);
    if (data.token !== token || data.email !== admin.email) {
      PMS.Util.fail('The reset confirmation is invalid.', 'ACCESS_DENIED');
    }
    CacheService.getScriptCache().remove(key);
    return data;
  }

  /**
   * Empties a sheet's data rows.
   *
   * Content only. Deleting the rows would take the dropdowns and number formats
   * with them, because those are applied to a range that would no longer exist,
   * and reinstating them is exactly the setup work a reset is supposed to
   * preserve. An emptied row still reads as absent: getLastRow() reports the last
   * row holding content, so every reader sees an empty sheet.
   */
  function clearSheetRows(book, name) {
    var sheet = book.getSheetByName(name);
    if (!sheet) return { sheetName: name, present: false, cleared: 0 };
    var rows = dataRowCount(sheet);
    if (rows > 0) {
      sheet.getRange(2, 1, rows, sheet.getLastColumn()).clearContent();
    }
    return { sheetName: name, present: true, cleared: rows };
  }

  /**
   * Empties the cycle columns of one tracker, leaving the asset master alone.
   *
   * The first three columns are the asset itself — tag, status, location — and
   * they are the reason this is not simply a sheet clear. The status validation
   * is re-applied afterwards for the same reason rollover does it: clearing a
   * cell can drop the rule with it, and a tracker column without its dropdown
   * accepts anything.
   */
  function clearTracker(sectionKey) {
    var sheet = PMS.Assets.sheetForSection(sectionKey);
    var startRow = PMS.CONFIG.ASSET_DATA_START_ROW;
    var lastRow = sheet.getLastRow();
    var result = { section: sectionKey, sheetName: sheet.getName(), assets: 0 };
    if (lastRow < startRow) return result;

    var count = lastRow - startRow + 1;
    result.assets = count;
    sheet.getRange(startRow, firstCycleColumn(), count, cycleColumnCount()).clearContent();
    Object.keys(PMS.CONFIG.CYCLES).forEach(function (cycleKey) {
      sheet
        .getRange(startRow, PMS.CONFIG.CYCLES[cycleKey].checkboxColumn, count, 1)
        .setDataValidation(PMS.Tracker.statusValidationRule());
    });
    return result;
  }

  /**
   * Forgets state that only made sense alongside the data being removed.
   *
   * Tracker baselines record what a cycle cell held before PMS touched it; with
   * the cells emptied, the honest baseline is the empty one, and deleting these
   * lets ensureTrackerBaseline capture it again. Rollover and reconciliation
   * state describe work on records that no longer exist.
   *
   * Deliberately absent: the administrator list, user profiles, the evidence
   * signing secret and the presentation signatures. The last of those is what
   * stops a reset from re-doing every sheet's formatting.
   */
  function clearDerivedState(trackers) {
    var propertyStore = PropertiesService.getScriptProperties();
    var removed = [];
    [PMS.CONFIG.ROLLOVER_STATE_PROPERTY, PMS.CONFIG.RECONCILIATION_STATE_PROPERTY].forEach(function (key) {
      if (propertyStore.getProperty(key) === null) return;
      propertyStore.deleteProperty(key);
      removed.push(key);
    });
    trackers.forEach(function (tracker) {
      if (!tracker.trackerYear) return;
      var key = PMS.CONFIG.BASELINE_PROPERTY_PREFIX + tracker.trackerYear + '_' + tracker.section;
      if (propertyStore.getProperty(key) === null) return;
      propertyStore.deleteProperty(key);
      removed.push(key);
    });
    return removed;
  }

  function lastReset() {
    try {
      var raw = PropertiesService.getScriptProperties().getProperty(LAST_RESET_PROPERTY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function recordReset(admin, summary) {
    try {
      PropertiesService.getScriptProperties().setProperty(LAST_RESET_PROPERTY, JSON.stringify({
        at: PMS.Util.nowIso(),
        by: admin.email,
        rowsCleared: summary.rowsCleared,
        trackerCellsCleared: summary.trackerCellsCleared
      }));
    } catch (error) {
      console.warn('The reset audit note could not be written: ' + error.message);
    }
  }

  /**
   * Performs the reset.
   *
   * Under the script lock, because a record being saved or a ticket being filed
   * while the sheets empty would leave a row referring to a cycle cell that no
   * longer agrees with it.
   */
  function execute(confirmationToken, phrase) {
    var admin = PMS.Auth.requireAdmin();
    readConfirmation(admin, confirmationToken, phrase);

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) PMS.Util.fail('Another maintenance operation is running.', 'BUSY');
    try {
      var book = spreadsheet();
      // Counted before clearing: afterwards there is nothing left to count.
      var trackerBefore = Object.keys(PMS.CONFIG.SECTIONS).map(trackerSummary);
      var trackerCellsCleared = trackerBefore.reduce(function (sum, entry) {
        return sum + entry.filledCells;
      }, 0);

      var sheetResults = clearedSheetNames().map(function (name) {
        return clearSheetRows(book, name);
      });
      var trackerResults = Object.keys(PMS.CONFIG.SECTIONS).map(clearTracker);
      var propertiesRemoved = clearDerivedState(trackerBefore);
      SpreadsheetApp.flush();

      /*
        Every cached read has to become unreachable now. The lists are keyed by a
        generation stamp, so bumping it retires them for every viewer at once;
        the asset picker holds its own copy of the tracker completion flags this
        has just cleared.

        Best effort, and deliberately so. The sheets are already empty by this
        point, so a failure here is a stale cache rather than a failed reset, and
        reporting it as a failure would send somebody to run the whole thing
        again. Caches also expire on their own.
      */
      var cacheWarnings = [];
      [
        function () { PMS.Records.markChanged(); },
        function () { PMS.Tickets.markChanged(); },
        function () {
          Object.keys(PMS.CONFIG.SECTIONS).forEach(function (sectionKey) {
            PMS.Assets.invalidate(sectionKey);
          });
        }
      ].forEach(function (step) {
        try {
          step();
        } catch (error) {
          console.warn('A cache could not be cleared after the reset: ' + error.message);
          cacheWarnings.push(error.message);
        }
      });

      var rowsCleared = sheetResults.reduce(function (sum, entry) { return sum + entry.cleared; }, 0);
      var summary = {
        ok: true,
        rowsCleared: rowsCleared,
        trackerCellsCleared: trackerCellsCleared,
        sheets: sheetResults,
        trackers: trackerResults,
        propertiesRemoved: propertiesRemoved,
        cacheWarnings: cacheWarnings,
        kept: keptDescriptions(),
        message: rowsCleared || trackerCellsCleared
          ? 'Cleared ' + rowsCleared + ' row(s) and ' + trackerCellsCleared +
            ' tracker cell(s). Record and ticket numbering starts from 1 again.'
          : 'There was nothing to clear. Record and ticket numbering already starts from 1.'
      };
      recordReset(admin, summary);
      return summary;
    } finally {
      lock.releaseLock();
    }
  }

  return {
    preview: preview,
    execute: execute,
    lastReset: lastReset,
    confirmationPhrase: function () { return CONFIRMATION_PHRASE; }
  };
})();
