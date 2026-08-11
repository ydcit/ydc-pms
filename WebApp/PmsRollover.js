var PMS = PMS || {};

PMS.Rollover = (function () {
  function cacheKey(email, nextYear) {
    return 'PMS_ROLLOVER_TOKEN_' + PMS.Util.hashText(email + '|' + nextYear).slice(0, 24);
  }

  function capacitySnapshot() {
    var spreadsheet = PMS.Assets.spreadsheet();
    var cells = spreadsheet.getSheets().reduce(function (total, sheet) {
      return total + sheet.getMaxRows() * sheet.getMaxColumns();
    }, 0);
    return {
      allocatedCells: cells,
      limitCells: 10000000,
      utilizationPercent: Math.round(cells / 10000000 * 1000) / 10
    };
  }

  function summarizeTracker(sectionKey) {
    var tracker = PMS.Tracker.trackerRows(sectionKey);
    var completedByCycle = { T1: 0, T2: 0, T3: 0 };
    var remarksByCycle = { T1: 0, T2: 0, T3: 0 };
    var seen = {};
    var assetCount = 0;
    tracker.rows.forEach(function (row) {
      if (row.status !== 'INPROD' || seen[row.assetTag]) return;
      seen[row.assetTag] = true;
      assetCount += 1;
      Object.keys(PMS.CONFIG.CYCLES).forEach(function (cycle) {
        if (row[cycle].checkbox) completedByCycle[cycle] += 1;
        if (row[cycle].remarks) remarksByCycle[cycle] += 1;
      });
    });
    return {
      section: sectionKey,
      sectionLabel: PMS.CONFIG.SECTIONS[sectionKey].label,
      sheetName: tracker.sheetName,
      trackerYear: tracker.year,
      assetCount: assetCount,
      completedByCycle: completedByCycle,
      remarksByCycle: remarksByCycle
    };
  }

  function validateNextYear(summaries, nextYear) {
    var years = {};
    summaries.forEach(function (summary) { years[summary.trackerYear] = true; });
    var values = Object.keys(years).map(Number);
    var stateRaw = PropertiesService.getScriptProperties().getProperty(PMS.CONFIG.ROLLOVER_STATE_PROPERTY);
    if (stateRaw) {
      var state = JSON.parse(stateRaw);
      var resumable = Number(state.newYear) === Number(nextYear) && values.every(function (year) {
        return year === Number(state.oldYear) || year === Number(state.newYear);
      });
      if (resumable) return Number(state.oldYear);
    }
    if (values.length !== 1 || !values[0]) {
      PMS.Util.fail('The two PMS sheets do not have the same valid tracker year.', 'ROLLOVER_BLOCKED');
    }
    if (Number(nextYear) !== values[0] + 1) {
      PMS.Util.fail('The next tracker year must be ' + (values[0] + 1) + '.', 'ROLLOVER_BLOCKED');
    }
    return values[0];
  }

  function dryRun(nextYear) {
    var admin = PMS.Auth.requireAdmin();
    PMS.Records.ensureTrackerBaseline();
    var targetYear = Number(nextYear);
    if (!/^\d{4}$/.test(String(targetYear))) PMS.Util.fail('Enter a valid four-digit year.', 'VALIDATION_ERROR');
    var summaries = Object.keys(PMS.CONFIG.SECTIONS).map(summarizeTracker);
    var currentYear = validateNextYear(summaries, targetYear);
    var pending = PMS.Records.pendingSyncPage(currentYear, 1, 0).totalPending;
    if (pending > 0) {
      PMS.Util.fail(
        pending + ' closing-year record(s) still require tracker synchronization. Use Retry pending sync and resolve failures before rollover.',
        'ROLLOVER_BLOCKED'
      );
    }
    var token = Utilities.getUuid();
    CacheService.getScriptCache().put(
      cacheKey(admin.email, targetYear),
      JSON.stringify({ token: token, email: admin.email, currentYear: currentYear, nextYear: targetYear }),
      PMS.CONFIG.ROLLOVER_TOKEN_SECONDS
    );
    return {
      ok: true,
      currentYear: currentYear,
      nextYear: targetYear,
      sections: summaries,
      capacity: capacitySnapshot(),
      confirmationToken: token,
      expiresInSeconds: PMS.CONFIG.ROLLOVER_TOKEN_SECONDS
    };
  }

  function readConfirmation(admin, nextYear, token) {
    var key = cacheKey(admin.email, nextYear);
    var raw = CacheService.getScriptCache().get(key);
    if (!raw) PMS.Util.fail('Rollover confirmation expired. Run the dry run again.', 'ROLLOVER_TOKEN_EXPIRED');
    var data = JSON.parse(raw);
    if (data.token !== token || data.email !== admin.email || Number(data.nextYear) !== Number(nextYear)) {
      PMS.Util.fail('Rollover confirmation is invalid.', 'ACCESS_DENIED');
    }
    CacheService.getScriptCache().remove(key);
    return data;
  }

  function resetTracker(sectionKey, oldYear, nextYear) {
    var sheet = PMS.Assets.sheetForSection(sectionKey);
    var yearCell = sheet.getRange(PMS.CONFIG.TRACKER_YEAR_ROW, PMS.CONFIG.TRACKER_YEAR_COLUMN);
    var currentYear = Number(yearCell.getValue());
    if (currentYear === nextYear) return { sheetName: sheet.getName(), skipped: true };
    if (currentYear !== oldYear) {
      PMS.Util.fail(sheet.getName() + ' has unexpected tracker year ' + currentYear + '.', 'ROLLOVER_BLOCKED');
    }
    var lastRow = sheet.getLastRow();
    if (lastRow >= PMS.CONFIG.ASSET_DATA_START_ROW) {
      var count = lastRow - PMS.CONFIG.ASSET_DATA_START_ROW + 1;
      var resetValues = Array.from({ length: count }, function () { return [false, '', false, '', false, '']; });
      sheet.getRange(PMS.CONFIG.ASSET_DATA_START_ROW, 4, count, 6).setValues(resetValues);
    }
    yearCell.setValue(nextYear);
    SpreadsheetApp.flush();
    if (Number(yearCell.getValue()) !== nextYear) {
      PMS.Util.fail('Failed to verify the new tracker year for ' + sheet.getName() + '.', 'SYNC_FAILED');
    }
    if (lastRow >= PMS.CONFIG.ASSET_DATA_START_ROW) {
      var verify = sheet.getRange(PMS.CONFIG.ASSET_DATA_START_ROW, 4, lastRow - PMS.CONFIG.ASSET_DATA_START_ROW + 1, 6).getValues();
      var dirty = verify.some(function (row) {
        return row[0] === true || row[1] !== '' || row[2] === true || row[3] !== '' || row[4] === true || row[5] !== '';
      });
      if (dirty) PMS.Util.fail('Tracker reset verification failed for ' + sheet.getName() + '.', 'SYNC_FAILED');
    }
    return { sheetName: sheet.getName(), skipped: false };
  }

  function execute(nextYear, confirmationToken) {
    var admin = PMS.Auth.requireAdmin();
    var targetYear = Number(nextYear);
    var baseline = PMS.Records.ensureTrackerBaseline();
    var confirmation = readConfirmation(admin, targetYear, confirmationToken);
    var oldYear = Number(confirmation.currentYear);
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) PMS.Util.fail('Another maintenance operation is running.', 'BUSY');
    var migrated = baseline.migrated;
    var sectionResults = [];
    var reconciliation;
    try {
      var propertyStore = PropertiesService.getScriptProperties();
      var priorStateRaw = propertyStore.getProperty(PMS.CONFIG.ROLLOVER_STATE_PROPERTY);
      var currentSummaries = Object.keys(PMS.CONFIG.SECTIONS).map(summarizeTracker);
      var allAlreadyOpen = currentSummaries.every(function (summary) {
        return Number(summary.trackerYear) === targetYear;
      });
      if (allAlreadyOpen && !priorStateRaw) {
        PMS.Util.fail('The ' + targetYear + ' PMS tracker is already open.', 'ROLLOVER_ALREADY_COMPLETE');
      }
      var revalidatedOldYear = validateNextYear(currentSummaries, targetYear);
      if (Number(revalidatedOldYear) !== oldYear) {
        PMS.Util.fail('The rollover preview is stale. Run the safety check again.', 'ROLLOVER_TOKEN_EXPIRED');
      }
      var closingPending = PMS.Records.pendingSyncPage(oldYear, 1, 0).totalPending;
      if (closingPending > 0) {
        PMS.Util.fail(
          closingPending + ' closing-year record(s) still require tracker synchronization. The tracker was not reset.',
          'ROLLOVER_BLOCKED'
        );
      }
      propertyStore.setProperty(PMS.CONFIG.ROLLOVER_STATE_PROPERTY, JSON.stringify({
        oldYear: oldYear,
        newYear: targetYear,
        adminEmail: admin.email,
        stage: 'ARCHIVING',
        updatedAt: PMS.Util.nowIso()
      }));
      PMS.Records.appendSystemEvent('ROLLOVER-' + oldYear + '-YEAR_CLOSE', 'YEAR_CLOSE', {
        year: oldYear,
        nextYear: targetYear,
        migratedLegacyRecords: migrated,
        adminEmail: admin.email,
        adminName: admin.name,
        timestamp: PMS.Util.nowIso()
      });
      propertyStore.setProperty(PMS.CONFIG.ROLLOVER_STATE_PROPERTY, JSON.stringify({
        oldYear: oldYear,
        newYear: targetYear,
        adminEmail: admin.email,
        stage: 'RESETTING',
        updatedAt: PMS.Util.nowIso()
      }));

      Object.keys(PMS.CONFIG.SECTIONS).forEach(function (sectionKey) {
        sectionResults.push(resetTracker(sectionKey, oldYear, targetYear));
      });

      PMS.Records.appendSystemEvent('ROLLOVER-' + targetYear + '-YEAR_OPEN', 'YEAR_OPEN', {
        year: targetYear,
        previousYear: oldYear,
        adminEmail: admin.email,
        adminName: admin.name,
        timestamp: PMS.Util.nowIso()
      });
      propertyStore.deleteProperty(PMS.CONFIG.ROLLOVER_STATE_PROPERTY);
      PMS.Assets.invalidate('SERVICE_DESK');
      PMS.Assets.invalidate('INFRA_SECURITY');
      reconciliation = PMS.Tracker.reconcilePending(targetYear, 50, 0);
    } finally {
      lock.releaseLock();
    }

    var continuation = recordReconciliation(targetYear, reconciliation, admin.email);
    return {
      ok: true,
      oldYear: oldYear,
      newYear: targetYear,
      migratedLegacyRecords: migrated,
      reconciledRecords: reconciliation.completed,
      reconciliationFailed: reconciliation.failed,
      reconciliationPending: reconciliation.pendingRemaining,
      reconciliationContinuation: continuation,
      sections: sectionResults,
      message: 'The ' + targetYear + ' PMS tracker is open. Historical ' + oldYear + ' records remain in PMS Records.'
    };
  }

  function clearContinuationTriggers() {
    ScriptApp.getProjectTriggers().forEach(function (trigger) {
      if (trigger.getHandlerFunction() === 'PMS_continueReconciliation_') {
        ScriptApp.deleteTrigger(trigger);
      }
    });
  }

  function scheduleContinuation() {
    clearContinuationTriggers();
    ScriptApp.newTrigger('PMS_continueReconciliation_').timeBased().after(60000).create();
  }

  function recordReconciliation(year, reconciliation, requestedBy) {
    var propertyStore = PropertiesService.getScriptProperties();
    var state = {
      year: Number(year),
      cursor: Number(reconciliation.nextCursor) || 0,
      remainingAfterCursor: Number(reconciliation.remainingAfterCursor) || 0,
      pendingRemaining: Number(reconciliation.pendingRemaining) || 0,
      completedInLastBatch: Number(reconciliation.completed) || 0,
      failedInLastBatch: Number(reconciliation.failed) || 0,
      requestedBy: requestedBy || '',
      updatedAt: PMS.Util.nowIso(),
      status: reconciliation.remainingAfterCursor > 0
        ? 'RUNNING'
        : reconciliation.pendingRemaining > 0 ? 'COMPLETED_WITH_FAILURES' : 'COMPLETED'
    };
    if (state.remainingAfterCursor > 0) {
      try {
        scheduleContinuation();
      } catch (error) {
        state.status = 'MANUAL_RETRY_REQUIRED';
        state.scheduleError = error.message;
      }
    } else {
      clearContinuationTriggers();
    }
    propertyStore.setProperty(PMS.CONFIG.RECONCILIATION_STATE_PROPERTY, JSON.stringify(state));
    return state;
  }

  function continueReconciliation() {
    var propertyStore = PropertiesService.getScriptProperties();
    var raw = propertyStore.getProperty(PMS.CONFIG.RECONCILIATION_STATE_PROPERTY);
    if (!raw) {
      clearContinuationTriggers();
      return { ok: true, status: 'NO_PENDING_JOB' };
    }
    var state = JSON.parse(raw);
    if (state.status !== 'RUNNING') {
      clearContinuationTriggers();
      return { ok: true, status: state.status, reconciliation: state };
    }
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      scheduleContinuation();
      return { ok: false, status: 'BUSY' };
    }
    var reconciliation;
    try {
      reconciliation = PMS.Tracker.reconcilePending(state.year, 50, state.cursor);
      state = recordReconciliation(state.year, reconciliation, state.requestedBy);
    } finally {
      lock.releaseLock();
    }
    return { ok: true, status: state.status, reconciliation: state };
  }

  function retryReconciliation(year) {
    var admin = PMS.Auth.requireAdmin();
    var targetYear = Number(year);
    if (!/^\d{4}$/.test(String(targetYear))) PMS.Util.fail('Enter a valid four-digit year.', 'VALIDATION_ERROR');
    var trackerYears = Object.keys(PMS.CONFIG.SECTIONS).map(function (sectionKey) {
      return Number(PMS.Tracker.trackerRows(sectionKey).year);
    });
    if (!trackerYears.every(function (trackerYear) { return trackerYear === targetYear; })) {
      PMS.Util.fail('Both tracker sheets must be open for ' + targetYear + ' before retrying synchronization.', 'ROLLOVER_BLOCKED');
    }
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) PMS.Util.fail('Another maintenance operation is running.', 'BUSY');
    var reconciliation;
    try {
      reconciliation = PMS.Tracker.reconcilePending(targetYear, 50, 0);
    } finally {
      lock.releaseLock();
    }
    return {
      ok: true,
      reconciliation: recordReconciliation(targetYear, reconciliation, admin.email)
    };
  }

  function status() {
    var profile = PMS.Auth.requireProfile();
    if (!profile.isAdmin) return null;
    var raw = PropertiesService.getScriptProperties().getProperty(PMS.CONFIG.ROLLOVER_STATE_PROPERTY);
    var sections = Object.keys(PMS.CONFIG.SECTIONS).map(summarizeTracker);
    var years = sections.map(function (item) { return Number(item.trackerYear); });
    var sameYear = years.length && years.every(function (year) { return year === years[0]; });
    var reconciliationRaw = PropertiesService.getScriptProperties().getProperty(PMS.CONFIG.RECONCILIATION_STATE_PROPERTY);
    var pendingSync = sameYear ? PMS.Records.pendingSyncPage(years[0], 1, 0).totalPending : null;
    var activeState = raw ? JSON.parse(raw) : null;
    return {
      active: Boolean(raw),
      state: activeState,
      currentYear: sameYear ? years[0] : activeState ? Number(activeState.oldYear) : null,
      nextYear: activeState ? Number(activeState.newYear) : sameYear ? years[0] + 1 : null,
      sections: sections,
      capacity: capacitySnapshot(),
      reconciliation: reconciliationRaw ? JSON.parse(reconciliationRaw) : null,
      pendingSync: pendingSync
    };
  }

  return {
    dryRun: dryRun,
    execute: execute,
    continueReconciliation: continueReconciliation,
    retryReconciliation: retryReconciliation,
    status: status,
    capacitySnapshot: capacitySnapshot
  };
})();
