var PMS = PMS || {};

PMS.Tracker = (function () {
  // A short-lived release created range protections with this exact prefix.
  // The release was reverted, but Apps Script code changes do not remove
  // protections that were already applied to a spreadsheet. Keep this marker
  // deliberately narrow so cleanup can never remove a user's own protection.
  var LEGACY_CYCLE_PROTECTION_PREFIX = 'PMS cycle checkbox lock';

  function maintenanceDateText(value) {
    return Object.prototype.toString.call(value) === '[object Date]'
      ? Utilities.formatDate(value, PMS.CONFIG.TIME_ZONE, 'yyyy-MM-dd')
      : String(value || '').slice(0, 10);
  }

  function checklistState(value) {
    return String(value || '').toUpperCase() === 'DONE' ? 'Checked' : 'Not checked';
  }

  function infraAuditLines(record) {
    if (String(record.itSection || '') !== 'INFRA_SECURITY') return [];
    return [
      'IT-IS Asset Type: ' + (record.assetType || 'Not recorded'),
      'Physical - Power Cables: ' + checklistState(record.infraPowerCables),
      'Physical - Data Cables: ' + checklistState(record.infraDataCables),
      'Physical - Power Supply / UPS: ' + checklistState(record.infraPowerSupplyUps),
      'Digital - Firmware Version at Latest: ' + checklistState(record.infraFirmwareLatest),
      'Latest Firmware Evidence: ' + (record.firmwareEvidenceUrl || 'Not uploaded') +
        (record.firmwareEvidenceFileName ? ' (' + record.firmwareEvidenceFileName + ')' : ''),
      'Configurations / Backup / Checkpoints Evidence: ' + (record.backupEvidenceUrl || 'Not uploaded') +
        (record.backupEvidenceFileName ? ' (' + record.backupEvidenceFileName + ')' : '')
    ];
  }

  function assessmentBlock(record) {
    return [
      '[PMS Record: ' + record.recordId + ']',
      'Technician: ' + record.technicianName + ' <' + record.technicianEmail + '>',
      'Maintenance Performed On: ' + maintenanceDateText(record.maintenanceDate)
    ].concat(infraAuditLines(record)).concat([
      'Assessment Result: ' + record.assessmentResult,
      'Asset Findings: ' + record.assetFindings,
      'Action Taken: ' + record.actionTaken,
      'Recommendation: ' + record.recommendation,
      '[End PMS Record: ' + record.recordId + ']'
    ]).join('\n');
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

  /**
   * Removes only the obsolete range protections created by commit c45024e.
   * Sheet protections and range protections with any other description are
   * preserved. This is safe to run repeatedly: after the first cleanup it is
   * a no-op.
   */
  function removeLegacyCycleProtectionsFromSheet(sheet) {
    var removed = [];
    var sectionKey = '';
    Object.keys(PMS.CONFIG.SECTIONS).some(function (key) {
      if (PMS.CONFIG.SECTIONS[key].sheetName !== sheet.getName()) return false;
      sectionKey = key;
      return true;
    });
    if (!sectionKey) {
      PMS.Util.fail('Unknown tracker sheet during protection cleanup: ' + sheet.getName(), 'CONFIGURATION_ERROR');
    }
    var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
    protections.forEach(function (protection) {
      var description = String(protection.getDescription() || '');
      if (description.indexOf(LEGACY_CYCLE_PROTECTION_PREFIX) !== 0) return;

      // The reverted feature created exactly three whole-body checkbox-column
      // locks per tracker tab. Matching its description alone is not enough:
      // also require the original geometry so a later protection that happens
      // to reuse the phrase cannot be removed.
      var protectedRange;
      try {
        protectedRange = protection.getRange();
      } catch (error) {
        console.warn('Could not inspect obsolete protection "' + description + '": ' + error.message);
        return;
      }
      var matchingCycle = Object.keys(PMS.CONFIG.CYCLES).filter(function (cycleKey) {
        var expectedDescription = LEGACY_CYCLE_PROTECTION_PREFIX + ' \u00b7 ' + sectionKey + ' \u00b7 ' + cycleKey;
        return description === expectedDescription &&
          protectedRange.getColumn() === PMS.CONFIG.CYCLES[cycleKey].checkboxColumn;
      });
      if (matchingCycle.length !== 1 ||
          protectedRange.getRow() !== PMS.CONFIG.ASSET_DATA_START_ROW ||
          protectedRange.getNumColumns() !== 1 ||
          protectedRange.getNumRows() < 1) {
        console.warn('Preserved non-legacy protection that reused the PMS lock description: ' +
          sheet.getName() + '!' + protectedRange.getA1Notation());
        return;
      }

      var range = protectedRange.getA1Notation();
      try {
        protection.remove();
      } catch (error) {
        PMS.Util.fail(
          'The obsolete PMS tracker lock at ' + sheet.getName() + '!' + range +
            ' could not be removed by the web-app owner. Ask the spreadsheet owner to run ' +
            'PMS_removeLegacyTrackerProtections, then retry synchronization. Original error: ' + error.message,
          'TRACKER_PROTECTED'
        );
      }
      removed.push({ description: description, range: range });
    });
    if (removed.length) {
      console.warn('Removed ' + removed.length + ' obsolete PMS cycle protection(s) from ' + sheet.getName() + '.');
    }
    return removed;
  }

  function removeLegacyCycleProtections(sectionKey) {
    var keys = sectionKey
      ? [PMS.Util.section(sectionKey).key]
      : Object.keys(PMS.CONFIG.SECTIONS);
    var sheets = keys.map(function (key) {
      var sheet = PMS.Assets.sheetForSection(key);
      var removed = removeLegacyCycleProtectionsFromSheet(sheet);
      return {
        section: key,
        sheetName: sheet.getName(),
        removed: removed.length,
        protections: removed
      };
    });
    return {
      removed: sheets.reduce(function (total, item) { return total + item.removed; }, 0),
      sheets: sheets
    };
  }

  function syncCompletedRecord(record, beforeTrackerWrite) {
    var section = PMS.Util.section(record.itSection);
    if (section.key === 'INFRA_SECURITY') {
      // Evidence may be moved, deleted, or replaced while a future-year record
      // waits for rollover. Re-verify both files immediately before any tracker
      // remarks or checkbox write, including reconciliation retries.
      PMS.Evidence.verifyRecordEvidence(record);
    }
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

    // A reverted release may have left persistent range protections behind.
    // Remove only those known stale locks immediately before writing. This
    // makes ordinary retry reconciliation self-healing while leaving every
    // unrelated/manual protection intact.
    removeLegacyCycleProtectionsFromSheet(sheet);

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

    try {
      if (nextRemarks !== previousRemarks) remarksCell.setValue(nextRemarks);
    } catch (error) {
      PMS.Util.fail(
        'Tracker remarks could not be written at ' + sheet.getName() + '!' + remarksCell.getA1Notation() +
          '. Check that the web-app owner is allowed to edit this protected cell. Original error: ' + error.message,
        'TRACKER_PROTECTED'
      );
    }
    SpreadsheetApp.flush();
    if (remarksCell.getDisplayValue().indexOf('[PMS Record: ' + record.recordId + ']') < 0) {
      PMS.Util.fail('Remarks verification failed; the checkbox was not changed.', 'SYNC_FAILED');
    }
    try {
      checkboxCell.setValue(true);
    } catch (error) {
      PMS.Util.fail(
        'Tracker checkbox could not be checked at ' + sheet.getName() + '!' + checkboxCell.getA1Notation() +
          '. Check that the web-app owner is allowed to edit this protected cell. Original error: ' + error.message,
        'TRACKER_PROTECTED'
      );
    }
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

  return {
    assessmentBlock: assessmentBlock,
    removeLegacyCycleProtections: removeLegacyCycleProtections,
    syncCompletedRecord: syncCompletedRecord,
    trackerRows: trackerRows,
    reconcilePending: reconcilePending
  };
})();
