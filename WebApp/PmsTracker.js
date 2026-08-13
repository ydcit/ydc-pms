var PMS = PMS || {};

PMS.Tracker = (function () {
  function assessmentBlock(record) {
    return [
      '[PMS Record: ' + record.recordId + ']',
      'Technician: ' + record.technicianName + ' <' + record.technicianEmail + '>',
      'Maintenance Performed On: ' + record.maintenanceDate,
      'Assessment Result: ' + record.assessmentResult,
      'Asset Findings: ' + record.assetFindings,
      'Action Taken: ' + record.actionTaken,
      'Recommendation: ' + record.recommendation,
      '[End PMS Record: ' + record.recordId + ']'
    ].join('\n');
  }

  function appendAssessment(existingRemarks, record) {
    var existing = String(existingRemarks || '');
    var marker = '[PMS Record: ' + record.recordId + ']';
    var block = assessmentBlock(record);
    var markerIndex = existing.indexOf(marker);
    if (markerIndex >= 0) {
      var endMarker = '[End PMS Record: ' + record.recordId + ']';
      var endIndex = existing.indexOf(endMarker, markerIndex);
      if (endIndex >= 0) {
        endIndex += endMarker.length;
      } else {
        endIndex = existing.indexOf('\n\n---\n\n', markerIndex);
        if (endIndex < 0) endIndex = existing.length;
      }
      return existing.slice(0, markerIndex) + block + existing.slice(endIndex);
    }
    var combined = existing ? existing + '\n\n---\n\n' + block : block;
    if (combined.length > PMS.CONFIG.MAX_REMARKS_CELL_LENGTH) {
      PMS.Util.fail('The cycle Remarks cell would exceed the safe character limit.', 'REMARKS_TOO_LONG');
    }
    return combined;
  }

  function findAssetRow(sheet, assetTag) {
    var lastRow = sheet.getLastRow();
    if (lastRow < PMS.CONFIG.ASSET_DATA_START_ROW) return 0;
    var tag = PMS.Util.normalizeAssetTag(assetTag);
    var values = sheet
      .getRange(PMS.CONFIG.ASSET_DATA_START_ROW, 1, lastRow - PMS.CONFIG.ASSET_DATA_START_ROW + 1, 2)
      .getDisplayValues();
    var matches = [];
    values.forEach(function (row, index) {
      if (PMS.Util.normalizeAssetTag(row[0]) === tag) {
        matches.push({ row: PMS.CONFIG.ASSET_DATA_START_ROW + index, status: PMS.Util.cleanText(row[1], 100).toUpperCase() });
      }
    });
    if (matches.length !== 1) {
      PMS.Util.fail(matches.length ? 'Duplicate asset tag found during tracker synchronization.' : 'Asset tag not found during tracker synchronization.', 'DATA_INTEGRITY_ERROR');
    }
    if (matches[0].status !== 'INPROD') {
      PMS.Util.fail('Asset is no longer INPROD; tracker synchronization was stopped.', 'ASSET_NOT_ELIGIBLE');
    }
    return matches[0].row;
  }

  function syncCompletedRecord(record, beforeTrackerWrite) {
    var section = PMS.Util.section(record.itSection);
    var sheet = PMS.Assets.sheetForSection(section.key);
    var trackerYear = Number(sheet.getRange(PMS.CONFIG.TRACKER_YEAR_ROW, PMS.CONFIG.TRACKER_YEAR_COLUMN).getValue());
    if (!trackerYear) {
      return {
        status: 'SYNC_FAILED',
        sheetName: sheet.getName(),
        trackerYear: trackerYear,
        error: 'Tracker year is missing from D2.'
      };
    }
    if (trackerYear !== Number(record.maintenanceYear)) {
      if (Number(record.maintenanceYear) < trackerYear) {
        return {
          status: 'HISTORICAL_COMPLETED',
          sheetName: sheet.getName(),
          trackerYear: trackerYear,
          notice: 'Historical PMS was preserved in PMS Records; the current-year operational tracker was not changed.',
          error: ''
        };
      }
      return {
        status: 'SYNC_REQUIRED',
        sheetName: sheet.getName(),
        trackerYear: trackerYear,
        error: 'Maintenance year ' + record.maintenanceYear + ' does not match tracker year ' + trackerYear + '.'
      };
    }
    var cycleConfig = PMS.CONFIG.CYCLES[record.cycle];
    if (!cycleConfig) PMS.Util.fail('Unknown PMS cycle during tracker synchronization.', 'CONFIGURATION_ERROR');
    var row = findAssetRow(sheet, record.assetTag);
    var checkboxCell = sheet.getRange(row, cycleConfig.checkboxColumn);
    var remarksCell = sheet.getRange(row, cycleConfig.remarksColumn);
    var previousCheckbox = checkboxCell.getValue();
    var previousRemarks = remarksCell.getDisplayValue();
    var nextRemarks = appendAssessment(previousRemarks, record);
    var prepared = {
      status: 'SYNCING',
      sheetName: sheet.getName(),
      row: row,
      trackerYear: trackerYear,
      previousCheckbox: previousCheckbox,
      previousRemarks: previousRemarks,
      error: ''
    };
    if (typeof beforeTrackerWrite === 'function') beforeTrackerWrite(prepared);

    if (nextRemarks !== previousRemarks) remarksCell.setValue(nextRemarks);
    SpreadsheetApp.flush();
    if (remarksCell.getDisplayValue().indexOf('[PMS Record: ' + record.recordId + ']') < 0) {
      PMS.Util.fail('Remarks verification failed; the checkbox was not changed.', 'SYNC_FAILED');
    }
    checkboxCell.setValue(true);
    SpreadsheetApp.flush();
    if (checkboxCell.getValue() !== true) {
      PMS.Util.fail('Tracker checkbox verification failed.', 'SYNC_FAILED');
    }

    // The asset list is cached, and this asset has just become completed. Drop
    // the cache so the asset picker stops offering it immediately rather than
    // after the cache expires.
    try {
      PMS.Assets.invalidate(section.key);
    } catch (error) {
      console.warn('Asset cache could not be invalidated after sync: ' + error.message);
    }

    return {
      status: 'COMPLETED',
      sheetName: sheet.getName(),
      row: row,
      trackerYear: trackerYear,
      previousCheckbox: previousCheckbox,
      previousRemarks: previousRemarks,
      syncedAt: PMS.Util.nowIso(),
      error: ''
    };
  }

  function trackerRows(sectionKey) {
    var sheet = PMS.Assets.sheetForSection(sectionKey);
    var lastRow = sheet.getLastRow();
    var trackerYear = Number(sheet.getRange(PMS.CONFIG.TRACKER_YEAR_ROW, PMS.CONFIG.TRACKER_YEAR_COLUMN).getValue());
    if (lastRow < PMS.CONFIG.ASSET_DATA_START_ROW) {
      return { year: trackerYear, sheetName: sheet.getName(), rows: [] };
    }
    var values = sheet
      .getRange(PMS.CONFIG.ASSET_DATA_START_ROW, 1, lastRow - PMS.CONFIG.ASSET_DATA_START_ROW + 1, 9)
      .getValues();
    return {
      year: trackerYear,
      sheetName: sheet.getName(),
      rows: values.map(function (row, index) {
        return {
          row: PMS.CONFIG.ASSET_DATA_START_ROW + index,
          assetTag: PMS.Util.normalizeAssetTag(row[0]),
          status: PMS.Util.cleanText(row[1], 100).toUpperCase(),
          location: PMS.Util.cleanText(row[2], 500),
          T1: { checkbox: row[3] === true, remarks: PMS.Util.cleanText(row[4], PMS.CONFIG.MAX_REMARKS_CELL_LENGTH) },
          T2: { checkbox: row[5] === true, remarks: PMS.Util.cleanText(row[6], PMS.CONFIG.MAX_REMARKS_CELL_LENGTH) },
          T3: { checkbox: row[7] === true, remarks: PMS.Util.cleanText(row[8], PMS.CONFIG.MAX_REMARKS_CELL_LENGTH) }
        };
      }).filter(function (item) { return Boolean(item.assetTag); })
    };
  }

  function reconcilePending(year, limit, afterRow) {
    var page = PMS.Records.pendingSyncPage(year, limit || 50, afterRow || 0);
    var records = page.records;
    var completed = 0;
    var failed = 0;
    records.forEach(function (record) {
      var syncResult;
      try {
        syncResult = syncCompletedRecord(record, function (prepared) {
          PMS.Records.stageSync(record, prepared);
        });
      } catch (error) {
        syncResult = { status: 'SYNC_FAILED', error: error.message };
      }
      PMS.Records.finalizeSync(record, syncResult);
      if (syncResult.status === 'COMPLETED' || syncResult.status === 'HISTORICAL_COMPLETED') completed += 1;
      else failed += 1;
    });
    var remaining = PMS.Records.pendingSyncPage(year, 1, 0).totalPending;
    return {
      attempted: records.length,
      completed: completed,
      failed: failed,
      nextCursor: page.nextCursor,
      remainingAfterCursor: page.remainingAfterCursor,
      pendingRemaining: remaining
    };
  }

  var PROTECTION_TAG = 'PMS cycle checkbox lock';

  function cycleCheckboxRanges(sheet) {
    var startRow = PMS.CONFIG.ASSET_DATA_START_ROW;
    var rowCount = Math.max(sheet.getMaxRows() - startRow + 1, 1);
    return Object.keys(PMS.CONFIG.CYCLES).map(function (cycle) {
      return {
        cycle: cycle,
        range: sheet.getRange(startRow, PMS.CONFIG.CYCLES[cycle].checkboxColumn, rowCount, 1)
      };
    });
  }

  function removeExistingLocks(sheet) {
    var removed = 0;
    sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (protection) {
      if (String(protection.getDescription() || '').indexOf(PROTECTION_TAG) !== 0) return;
      protection.remove();
      removed += 1;
    });
    return removed;
  }

  /**
   * Protects the T1/T2/T3 checkbox columns so they cannot be ticked by hand.
   *
   * The web app writes those cells as its deploying owner, so the owner and the
   * configured administrators are kept as editors and everyone else is removed.
   * Run this as the account that deploys the web app, or make sure that account
   * is in PMS_ADMIN_EMAILS, otherwise completing a record would be blocked from
   * updating the tracker.
   *
   * warningOnly: true leaves the cells editable but makes Sheets ask for
   * confirmation first, which is gentler for administrators who edit directly.
   */
  function protectCycleColumns(options) {
    var settings = options || {};
    var warningOnly = settings.warningOnly === true;
    var keep = {};
    var effective = '';
    try {
      effective = PMS.Util.normalizeEmail(Session.getEffectiveUser().getEmail());
      if (effective) keep[effective] = true;
    } catch (error) {
      console.warn('Effective user unavailable while protecting the tracker: ' + error.message);
    }
    try {
      var owner = PMS.Assets.spreadsheet().getOwner();
      if (owner) keep[PMS.Util.normalizeEmail(owner.getEmail())] = true;
    } catch (error) {
      console.warn('Spreadsheet owner unavailable: ' + error.message);
    }
    var admins = PMS.Auth.configuredAdminEmails();
    admins.forEach(function (email) { keep[email] = true; });

    var applied = [];
    Object.keys(PMS.CONFIG.SECTIONS).forEach(function (sectionKey) {
      var sheet = PMS.Assets.sheetForSection(sectionKey);
      // Clear prior locks first so repeated runs replace rather than stack.
      removeExistingLocks(sheet);
      cycleCheckboxRanges(sheet).forEach(function (item) {
        var protection = item.range.protect()
          .setDescription(PROTECTION_TAG + ' · ' + sectionKey + ' · ' + item.cycle);
        if (warningOnly) {
          protection.setWarningOnly(true);
        } else {
          var editors = protection.getEditors().map(function (user) { return user.getEmail(); });
          var drop = editors.filter(function (email) {
            return !keep[PMS.Util.normalizeEmail(email)];
          });
          if (drop.length) protection.removeEditors(drop);
          if (protection.canDomainEdit()) protection.setDomainEdit(false);
          admins.forEach(function (email) {
            try {
              protection.addEditor(email);
            } catch (error) {
              console.warn('Could not keep ' + email + ' as a tracker editor: ' + error.message);
            }
          });
        }
        applied.push({
          section: sectionKey,
          sheetName: sheet.getName(),
          cycle: item.cycle,
          range: item.range.getA1Notation(),
          mode: warningOnly ? 'WARNING_ONLY' : 'RESTRICTED'
        });
      });
    });
    return {
      protections: applied.length,
      mode: warningOnly ? 'WARNING_ONLY' : 'RESTRICTED',
      editorsRetained: Object.keys(keep),
      applied: applied
    };
  }

  function unprotectCycleColumns() {
    var removed = 0;
    Object.keys(PMS.CONFIG.SECTIONS).forEach(function (sectionKey) {
      removed += removeExistingLocks(PMS.Assets.sheetForSection(sectionKey));
    });
    return { removed: removed };
  }

  /**
   * Finds cycle checkboxes that are ticked with no matching completed record.
   *
   * A tick made by hand after the one-time baseline is never turned into a
   * record, so the asset stops being offered in the questionnaire while still
   * not counting as completed on the dashboard. This reports exactly those rows.
   */
  function auditManualTicks() {
    var keysByYear = {};
    var findings = [];
    Object.keys(PMS.CONFIG.SECTIONS).forEach(function (sectionKey) {
      var tracker = trackerRows(sectionKey);
      if (!keysByYear[tracker.year]) {
        keysByYear[tracker.year] = PMS.Records.completionKeys(tracker.year);
      }
      var known = keysByYear[tracker.year];
      tracker.rows.forEach(function (row) {
        Object.keys(PMS.CONFIG.CYCLES).forEach(function (cycle) {
          if (!row[cycle].checkbox) return;
          var key = PMS.Records.completionKey(sectionKey, row.assetTag, tracker.year + '-' + cycle);
          if (known[key]) return;
          findings.push({
            section: sectionKey,
            sheetName: tracker.sheetName,
            row: row.row,
            cell: columnLetter(PMS.CONFIG.CYCLES[cycle].checkboxColumn) + row.row,
            assetTag: row.assetTag,
            assetStatus: row.status,
            cycle: cycle,
            year: tracker.year,
            hasRemarks: Boolean(row[cycle].remarks),
            reason: row[cycle].remarks
              ? 'Ticked and has remarks, but no PMS record exists'
              : 'Ticked with no PMS record and no remarks'
          });
        });
      });
    });
    return {
      checkedAt: PMS.Util.nowIso(),
      orphanCount: findings.length,
      findings: findings
    };
  }

  function columnLetter(column) {
    var letters = '';
    var remaining = column;
    while (remaining > 0) {
      var modulo = (remaining - 1) % 26;
      letters = String.fromCharCode(65 + modulo) + letters;
      remaining = Math.floor((remaining - modulo) / 26);
    }
    return letters;
  }

  return {
    assessmentBlock: assessmentBlock,
    syncCompletedRecord: syncCompletedRecord,
    trackerRows: trackerRows,
    reconcilePending: reconcilePending,
    protectCycleColumns: protectCycleColumns,
    unprotectCycleColumns: unprotectCycleColumns,
    auditManualTicks: auditManualTicks
  };
})();
