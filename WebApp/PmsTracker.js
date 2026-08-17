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
    return PMS.Util.parseChecklistValue(value).state === 'DONE' ? 'Checked' : 'Not checked';
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

  function hasRecordFlag(record, flag) {
    return String(record.dataQualityFlags || '').split('|').map(function (item) {
      return item.trim();
    }).indexOf(flag) >= 0;
  }

  function isTrustedLegacySeed(record) {
    if (!record || String(record.recordType) !== 'LEGACY_SEED' ||
        !hasRecordFlag(record, 'ADMIN_BULK_SEED') ||
        PMS.Util.normalizeEmail(record.technicianEmail)) return false;
    try {
      return record.recordId === PMS.Records.legacySeedRecordId(
        record.itSection,
        record.assetTag,
        record.cycleId
      );
    } catch (error) {
      return false;
    }
  }

  function legacySeedAssessmentBlock(record) {
    var sourceNote = String(record.assetFindings || 'Legacy source note not provided.');
    return [
      '[PMS Record: ' + record.recordId + ']',
      'Legacy PMS import: detailed checklist' +
        (record.itSection === 'INFRA_SECURITY' ? ' and Infrastructure evidence were' : ' was') +
        ' not captured.',
      'Maintenance Performed On: ' + maintenanceDateText(record.maintenanceDate),
      'Source Note: ' + sourceNote,
      'Action Taken: ' + String(record.actionTaken || 'Legacy PMS completion imported by an administrator.'),
      'Recommendation: ' + String(record.recommendation || 'Review the original legacy source when needed.'),
      '[End PMS Record: ' + record.recordId + ']'
    ].join('\n');
  }

  /**
   * Names the repair tickets raised from this record.
   *
   * The status cell carries the live repair state; this line carries the
   * identifiers, so a reader of the tracker can find the ticket and its full
   * history. Ticket ids never change, so this line stays correct without the
   * remarks cell being rewritten on every status change.
   */
  function ticketAuditLines(record) {
    var tickets;
    try {
      tickets = PMS.Tickets.forRecord(record.recordId);
    } catch (error) {
      console.warn('Ticket ids could not be read for tracker remarks: ' + error.message);
      return [];
    }
    if (!tickets.length) return [];
    return ['Findings Tickets: ' + tickets.map(function (ticket) {
      return ticket.ticketId + ' (' + PMS.Tickets.statusLabel(ticket.status) + ')';
    }).join(', ')];
  }

  /**
   * Lists the checks that were left unticked, with the reason given for each.
   *
   * Whoever reads the tracker row should see what was skipped and why without
   * opening the record.
   */
  function checklistExceptionLines(record) {
    var items;
    try {
      items = PMS.Util.allChecklistItems(record.itSection);
    } catch (error) {
      return [];
    }
    var lines = [];
    items.forEach(function (item) {
      var entry = PMS.Util.parseChecklistValue(record[item.key]);
      if (entry.state === 'NOT_DONE') lines.push('  - ' + item.label + ': ' + entry.reason);
    });
    return lines.length ? ['Checks Not Done:'].concat(lines) : [];
  }

  function assessmentBlock(record) {
    if (isTrustedLegacySeed(record)) return legacySeedAssessmentBlock(record);
    return [
      '[PMS Record: ' + record.recordId + ']',
      'Technician: ' + record.technicianName + ' <' + record.technicianEmail + '>',
      'Maintenance Performed On: ' + maintenanceDateText(record.maintenanceDate)
    ].concat(infraAuditLines(record)).concat([
      'Assessment Result: ' + record.assessmentResult,
      'Asset Findings: ' + record.assetFindings,
      'Action Taken: ' + record.actionTaken,
      'Recommendation: ' + record.recommendation
    ]).concat(checklistExceptionLines(record)).concat(ticketAuditLines(record)).concat([
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
      try {
        SpreadsheetApp.flush();
      } catch (error) {
        PMS.Util.fail(
          'The obsolete PMS tracker lock cleanup could not be committed on ' + sheet.getName() +
            ' for ' + removed.map(function (item) { return item.range; }).join(', ') +
            '. Ask the spreadsheet owner to run PMS_removeLegacyTrackerProtections, then retry synchronization. ' +
            'Original error: ' + error.message,
          'TRACKER_PROTECTED'
        );
      }
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

  function normalizedTrackerStatus(value) {
    var normalized = String(value === null || value === undefined ? '' : value).trim().toUpperCase();
    // A repair status is preserved as-is. Collapsing it to COMPLETED here would
    // erase outstanding repair state during the migration.
    if (PMS.Util.isTrackerAwaitingRepair(normalized)) return normalized;
    if (PMS.Util.isTrackerComplete(value)) return PMS.CONFIG.TRACKER_COMPLETED_VALUE;
    if (!normalized || normalized === 'FALSE') return '';
    PMS.Util.fail('Unexpected tracker status value: ' + normalized + '.', 'DATA_INTEGRITY_ERROR');
  }

  /**
   * Constrains the cycle cell to the values the application writes. The
   * dropdown stays hidden: these cells are written by the app, not chosen by
   * hand, and the allow-list exists to catch a stray manual edit.
   */
  function statusValidationRule() {
    return SpreadsheetApp.newDataValidation()
      .requireValueInList(PMS.Util.trackerStatusValues(), false)
      .setAllowInvalid(false)
      .build();
  }

  function statusMigrationPlan(sectionKey) {
    var section = PMS.Util.section(sectionKey);
    var sheet = PMS.Assets.sheetForSection(section.key);
    var startRow = PMS.CONFIG.ASSET_DATA_START_ROW;
    var lastSheetRow = sheet.getLastRow();
    var lastAssetRow = 0;
    if (lastSheetRow >= startRow) {
      var tags = sheet.getRange(startRow, 1, lastSheetRow - startRow + 1, 1).getDisplayValues();
      for (var tagIndex = tags.length - 1; tagIndex >= 0; tagIndex -= 1) {
        if (PMS.Util.normalizeAssetTag(tags[tagIndex][0])) {
          lastAssetRow = startRow + tagIndex;
          break;
        }
      }
    }
    var rowCount = lastAssetRow >= startRow ? lastAssetRow - startRow + 1 : 0;
    var completed = 0;
    var pending = 0;
    if (!rowCount) {
      return {
        section: section.key,
        sheet: sheet,
        sheetName: sheet.getName(),
        startRow: startRow,
        rowCount: 0,
        columns: [],
        completed: 0,
        pending: 0
      };
    }
    var columns = Object.keys(PMS.CONFIG.CYCLES).map(function (cycleKey) {
      var column = PMS.CONFIG.CYCLES[cycleKey].checkboxColumn;
      var range = sheet.getRange(startRow, column, rowCount, 1);
      var formulas = range.getFormulas();
      var formulaRow = formulas.findIndex(function (row) { return Boolean(row[0]); });
      if (formulaRow >= 0) {
        PMS.Util.fail(
          'Tracker status migration refused to replace a formula at ' + sheet.getName() + '!' +
            range.getCell(formulaRow + 1, 1).getA1Notation() + '.',
          'DATA_INTEGRITY_ERROR'
        );
      }
      var output = range.getValues().map(function (row) {
        var status = normalizedTrackerStatus(row[0]);
        if (status) completed += 1;
        else pending += 1;
        return [status];
      });
      return { cycle: cycleKey, column: column, range: range, values: output };
    });
    return {
      section: section.key,
      sheet: sheet,
      sheetName: sheet.getName(),
      startRow: startRow,
      rowCount: rowCount,
      columns: columns,
      completed: completed,
      pending: pending
    };
  }

  /**
   * Converts the live T1/T2/T3 checkbox columns to compact, non-interactive
   * COMPLETED status text. Every sheet is fully preflighted before any write so an
   * unexpected manual value cannot be overwritten silently.
   */
  function migrateStatusColumns(sectionKey) {
    var keys = sectionKey
      ? [PMS.Util.section(sectionKey).key]
      : Object.keys(PMS.CONFIG.SECTIONS);
    var plans = keys.map(statusMigrationPlan);
    plans.forEach(function (plan) {
      plan.columns.forEach(function (item) {
        item.range
          .setDataValidation(statusValidationRule())
          .setValues(item.values)
          .setHorizontalAlignment('center')
          .setVerticalAlignment('middle');
        if (plan.sheet.getColumnWidth(item.column) < 96) {
          plan.sheet.setColumnWidth(item.column, 96);
        }
      });
    });
    SpreadsheetApp.flush();

    var results = plans.map(function (plan) {
      plan.columns.forEach(function (item) {
        var values = item.range.getDisplayValues();
        var validations = item.range.getDataValidations();
        var invalidRow = -1;
        var expectedValues = PMS.Util.trackerStatusValues();
        for (var index = 0; index < values.length; index += 1) {
          var value = String(values[index][0] || '').trim().toUpperCase();
          if (value !== '' && expectedValues.indexOf(value) < 0) {
            invalidRow = plan.startRow + index;
            break;
          }
          var validation = validations[index][0];
          if (!validation || validation.getCriteriaType() !== SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
            invalidRow = plan.startRow + index;
            break;
          }
          var criteriaValues = validation.getCriteriaValues();
          var allowedValues = Array.isArray(criteriaValues[0]) ? criteriaValues[0].map(String) : [];
          var allowedMatches = allowedValues.length === expectedValues.length &&
            expectedValues.every(function (expected) { return allowedValues.indexOf(expected) >= 0; });
          if (validation.getAllowInvalid() || !allowedMatches || criteriaValues[1] !== false) {
            invalidRow = plan.startRow + index;
            break;
          }
        }
        if (invalidRow >= 0) {
          PMS.Util.fail(
            'Tracker status migration verification failed at ' + plan.sheetName + '!' +
              item.range.getCell(invalidRow - plan.startRow + 1, 1).getA1Notation() + '.',
            'SYNC_FAILED'
          );
        }
      });
      return {
        section: plan.section,
        sheetName: plan.sheetName,
        completed: plan.completed,
        pending: plan.pending,
        rows: plan.rowCount
      };
    });
    Object.keys(PMS.CONFIG.SECTIONS).forEach(function (key) {
      if (keys.indexOf(key) >= 0) PMS.Assets.invalidate(key);
    });
    return { status: PMS.CONFIG.TRACKER_COMPLETED_VALUE, sheets: results };
  }

  function rangeContainsCell(range, cell) {
    var row = cell.getRow();
    var column = cell.getColumn();
    return row >= range.getRow() &&
      row <= range.getLastRow() &&
      column >= range.getColumn() &&
      column <= range.getLastColumn();
  }

  function conciseProtectionText(value) {
    var text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > 120 ? text.slice(0, 117) + '...' : text;
  }

  /**
   * Describes protections that cover a tracker cell without
   * changing them. Editor lists are intentionally omitted from saved errors.
   */
  function protectionDetailsForCell(sheet, cell) {
    var details = [];
    var incomplete = false;
    var maximumDetails = 5;
    sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (protection) {
      if (details.length >= maximumDetails) return;
      var range;
      try {
        range = protection.getRange();
        if (!rangeContainsCell(range, cell)) return;
        var warningOnly = protection.isWarningOnly();
        details.push(
          'range "' + (conciseProtectionText(protection.getDescription()) || 'untitled') + '" at ' +
          sheet.getName() + '!' + range.getA1Notation() +
          ' (mode: ' + (warningOnly ? 'warning only' : 'restricted') +
          ', deployment account can edit: ' + (protection.canEdit() ? 'yes' : 'no') + ')'
        );
      } catch (error) {
        incomplete = true;
        details.push('a range protection that could not be inspected (' + conciseProtectionText(error.message) + ')');
      }
    });

    sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (protection) {
      if (details.length >= maximumDetails) return;
      try {
        var warningOnly = protection.isWarningOnly();
        var unprotected = protection.getUnprotectedRanges();
        if (unprotected.some(function (range) { return rangeContainsCell(range, cell); })) return;
        details.push(
          'sheet protection "' + (conciseProtectionText(protection.getDescription()) || 'untitled') + '"' +
          ' (mode: ' + (warningOnly ? 'warning only' : 'restricted') +
          ', deployment account can edit: ' + (protection.canEdit() ? 'yes' : 'no') + ')'
        );
      } catch (error) {
        incomplete = true;
        details.push('a sheet protection that could not be inspected (' + conciseProtectionText(error.message) + ')');
      }
    });
    return { details: details, incomplete: incomplete };
  }

  function protectedWriteFailure(sheet, cell, label, error) {
    var diagnostics = { details: [], incomplete: false };
    try {
      diagnostics = protectionDetailsForCell(sheet, cell);
    } catch (inspectionError) {
      diagnostics.incomplete = true;
      console.warn('Could not inspect tracker protections: ' + inspectionError.message);
    }
    var diagnostic = diagnostics.details.length
      ? ' Protections affecting this cell: ' + diagnostics.details.join('; ') + '.'
      : diagnostics.incomplete
        ? ' Protection details could not be inspected by the deployment account.'
        : ' No range or sheet protection affecting this cell was visible to the deployment account.';
    PMS.Util.fail(
      'Tracker ' + label + ' could not be written at ' + sheet.getName() + '!' + cell.getA1Notation() +
        '.' + diagnostic + ' Original error: ' + error.message,
      'TRACKER_PROTECTED'
    );
  }

  /**
   * The value a record's cycle status cell should carry.
   *
   * Legacy seeds never raise tickets and the importer writes many rows per
   * execution, so they skip the ticket lookup entirely.
   */
  function repairAwareStatus(record) {
    if (isTrustedLegacySeed(record)) return PMS.CONFIG.TRACKER_COMPLETED_VALUE;
    try {
      return PMS.Tickets.trackerStatusForRecord(record.recordId);
    } catch (error) {
      // An unreadable ticket sheet must not block a completion. The next ticket
      // change re-syncs the cell.
      console.warn('Ticket status could not be resolved for the tracker: ' + error.message);
      return PMS.CONFIG.TRACKER_COMPLETED_VALUE;
    }
  }

  function syncCompletedRecord(record, beforeTrackerWrite) {
    var section = PMS.Util.section(record.itSection);
    if (section.key === 'INFRA_SECURITY' && !isTrustedLegacySeed(record)) {
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

    var statusCell = sheet.getRange(row, cycleConfig.checkboxColumn);
    var remarksCell = sheet.getRange(row, cycleConfig.remarksColumn);
    var previousStatus = statusCell.getValue();
    var previousRemarks = remarksCell.getDisplayValue();
    var nextRemarks = appendAssessment(previousRemarks, record);
    var prepared = {
      status: 'SYNCING',
      sheetName: sheet.getName(),
      row: row,
      trackerYear: trackerYear,
      // Keep the legacy property name because it is part of the existing PMS
      // Records schema; the stored value may now be COMPLETED instead of a boolean.
      previousCheckbox: previousStatus,
      previousRemarks: previousRemarks,
      error: ''
    };
    if (typeof beforeTrackerWrite === 'function') beforeTrackerWrite(prepared);

    try {
      if (nextRemarks !== previousRemarks) {
        remarksCell.setValue(nextRemarks);
        // Protected-cell errors can be deferred until Sheets flushes the queued
        // write, so keep the flush inside the same contextual error boundary.
        SpreadsheetApp.flush();
      }
    } catch (error) {
      protectedWriteFailure(sheet, remarksCell, 'remarks', error);
    }
    if (remarksCell.getDisplayValue().indexOf('[PMS Record: ' + record.recordId + ']') < 0) {
      PMS.Util.fail('Remarks verification failed; the tracker status was not changed.', 'SYNC_FAILED');
    }
    // The cell reports the repair state when this record raised a findings
    // ticket, and plain COMPLETED otherwise. Derived from stored ticket state so
    // a reconciliation retry writes the same value this attempt would have.
    var expectedStatus = repairAwareStatus(record);
    try {
      var statusNeedsWrite = String(statusCell.getDisplayValue() || '') !== expectedStatus;
      statusCell.setDataValidation(statusValidationRule());
      if (statusNeedsWrite) {
        statusCell
          .setValue(expectedStatus)
          .setHorizontalAlignment('center')
          .setVerticalAlignment('middle');
      }
      SpreadsheetApp.flush();
    } catch (error) {
      protectedWriteFailure(sheet, statusCell, 'completion status', error);
    }
    if (String(statusCell.getDisplayValue() || '') !== expectedStatus) {
      PMS.Util.fail('Tracker completion status verification failed.', 'SYNC_FAILED');
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
      trackerStatus: expectedStatus,
      sheetName: sheet.getName(),
      row: row,
      trackerYear: trackerYear,
      previousCheckbox: previousStatus,
      previousRemarks: previousRemarks,
      syncedAt: PMS.Util.nowIso(),
      error: ''
    };
  }

  /**
   * Re-points a completed record's cycle status cell at the current repair state.
   *
   * Called after a ticket is filed or moved. Only the status cell changes: the
   * remarks block already names the ticket, and rewriting a remarks cell that
   * can hold 49,000 characters on every status change would be wasteful.
   *
   * Returns a reason instead of throwing for the ordinary cases where there is
   * nothing to write, so a ticket on a draft or on a closed-out year is not an
   * error. Genuine write failures still throw, and the ticket caller treats
   * them as non-fatal because the value is recomputed on the next change.
   */
  function syncRepairStatus(record) {
    if (!record || !record.recordId) return { ok: false, changed: false, reason: 'NO_RECORD' };
    if (PMS.Util.completionState(record.pmsCompletion) !== 'COMPLETED') {
      // The cycle cell is only written once maintenance completes.
      return { ok: false, changed: false, reason: 'RECORD_NOT_COMPLETED' };
    }
    var section = PMS.Util.section(record.itSection);
    var sheet = PMS.Assets.sheetForSection(section.key);
    var trackerYear = Number(sheet.getRange(PMS.CONFIG.TRACKER_YEAR_ROW, PMS.CONFIG.TRACKER_YEAR_COLUMN).getValue());
    if (!trackerYear || trackerYear !== Number(record.maintenanceYear)) {
      // The tracker has rolled over, so this record's cells no longer exist.
      return { ok: false, changed: false, reason: 'TRACKER_YEAR_MISMATCH', trackerYear: trackerYear };
    }
    var cycleConfig = PMS.CONFIG.CYCLES[record.cycle];
    if (!cycleConfig) return { ok: false, changed: false, reason: 'UNKNOWN_CYCLE' };

    var row = findAssetRow(sheet, record.assetTag);
    var statusCell = sheet.getRange(row, cycleConfig.checkboxColumn);
    var previousStatus = String(statusCell.getDisplayValue() || '');
    var expectedStatus = repairAwareStatus(record);
    if (previousStatus === expectedStatus) {
      return { ok: true, changed: false, reason: 'ALREADY_CURRENT', status: expectedStatus, row: row };
    }
    // Refuse to touch a cell that does not already hold a value this feature
    // owns, so a manual note or an unmigrated cell is never overwritten.
    if (!PMS.Util.isTrackerComplete(previousStatus)) {
      return { ok: false, changed: false, reason: 'UNEXPECTED_CELL_VALUE', previousStatus: previousStatus, row: row };
    }

    function writeStatusCell() {
      statusCell.setDataValidation(statusValidationRule());
      statusCell
        .setValue(expectedStatus)
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle');
      SpreadsheetApp.flush();
    }

    try {
      writeStatusCell();
    } catch (error) {
      /*
        Enumerating protections costs a slow API call, and this runs on every
        ticket status change. A reverted release may have left a stale cycle lock
        behind, so pay for the cleanup only when a write actually fails, then
        retry once. The completion path still cleans up eagerly because it writes
        the remarks cell too.
      */
      try {
        removeLegacyCycleProtectionsFromSheet(sheet);
        writeStatusCell();
      } catch (retryError) {
        protectedWriteFailure(sheet, statusCell, 'repair status', retryError);
      }
    }
    if (String(statusCell.getDisplayValue() || '') !== expectedStatus) {
      PMS.Util.fail('Tracker repair status verification failed.', 'SYNC_FAILED');
    }

    // completedCycles is cached, and this cell feeds it.
    try {
      PMS.Assets.invalidate(section.key);
    } catch (error) {
      console.warn('Asset cache could not be invalidated after a repair status write: ' + error.message);
    }

    return {
      ok: true,
      changed: true,
      status: expectedStatus,
      previousStatus: previousStatus,
      sheetName: sheet.getName(),
      row: row,
      syncedAt: PMS.Util.nowIso()
    };
  }

  /**
   * Synchronizes one server-staged LEGACY_SEED chunk with a single tracker
   * read/index and a single cache invalidation. Normal maintenance records do
   * not use this path and retain the full Infra evidence requirement.
   */
  function syncLegacySeedBatch(records, beforeTrackerWrite) {
    var list = Array.isArray(records) ? records : [];
    if (!list.length) return {};
    var first = list[0];
    if (!isTrustedLegacySeed(first)) {
      PMS.Util.fail('The legacy import chunk was not created by the guarded importer.', 'ACCESS_DENIED');
    }
    var section = PMS.Util.section(first.itSection);
    var cycleConfig = PMS.CONFIG.CYCLES[first.cycle];
    if (!cycleConfig) PMS.Util.fail('Unknown legacy import cycle.', 'CONFIGURATION_ERROR');
    list.forEach(function (record) {
      if (!isTrustedLegacySeed(record) || record.itSection !== section.key ||
          record.cycleId !== first.cycleId || record.cycle !== first.cycle ||
          Number(record.maintenanceYear) !== Number(first.maintenanceYear)) {
        PMS.Util.fail('A legacy import chunk crossed its section or cycle boundary.', 'DATA_INTEGRITY_ERROR');
      }
    });

    var sheet = PMS.Assets.sheetForSection(section.key);
    var trackerYear = Number(
      sheet.getRange(PMS.CONFIG.TRACKER_YEAR_ROW, PMS.CONFIG.TRACKER_YEAR_COLUMN).getValue()
    );
    if (trackerYear !== Number(first.maintenanceYear)) {
      PMS.Util.fail(
        'Legacy import year ' + first.maintenanceYear + ' no longer matches tracker year ' + trackerYear + '.',
        'IMPORT_PREVIEW_STALE'
      );
    }
    var startRow = PMS.CONFIG.ASSET_DATA_START_ROW;
    var lastRow = sheet.getLastRow();
    if (lastRow < startRow) PMS.Util.fail('The selected tracker has no assets.', 'ASSET_NOT_ELIGIBLE');
    var values = sheet.getRange(startRow, 1, lastRow - startRow + 1, 9).getValues();
    var byTag = {};
    values.forEach(function (row, index) {
      var tag = PMS.Util.normalizeAssetTag(row[0]);
      if (!tag) return;
      if (!byTag[tag]) byTag[tag] = [];
      byTag[tag].push({ row: startRow + index, values: row });
    });

    var plans = list.map(function (record) {
      var matches = byTag[PMS.Util.normalizeAssetTag(record.assetTag)] || [];
      if (matches.length !== 1) {
        PMS.Util.fail(
          matches.length ? 'Asset tag is duplicated in the selected tracker.' : 'Asset tag is missing from the selected tracker.',
          'IMPORT_PREVIEW_STALE'
        );
      }
      var match = matches[0];
      var status = PMS.Util.cleanText(match.values[1], 100).toUpperCase();
      if (status !== 'INPROD') {
        PMS.Util.fail('A current-year legacy import asset is no longer INPROD.', 'IMPORT_PREVIEW_STALE');
      }
      var statusCell = sheet.getRange(match.row, cycleConfig.checkboxColumn);
      var remarksCell = sheet.getRange(match.row, cycleConfig.remarksColumn);
      var previousStatus = match.values[cycleConfig.checkboxColumn - 1];
      var previousRemarks = String(match.values[cycleConfig.remarksColumn - 1] || '');
      return {
        record: record,
        row: match.row,
        statusCell: statusCell,
        remarksCell: remarksCell,
        previousStatus: previousStatus,
        previousRemarks: previousRemarks,
        // A legacy seed carries no tickets, but the cell may already hold a
        // repair status from a record the importer is not replacing. Preserve it
        // rather than reporting the asset as having nothing outstanding.
        expectedStatus: PMS.Util.isTrackerAwaitingRepair(previousStatus)
          ? String(previousStatus).trim().toUpperCase()
          : PMS.CONFIG.TRACKER_COMPLETED_VALUE,
        nextRemarks: appendAssessment(previousRemarks, record)
      };
    });

    if (typeof beforeTrackerWrite === 'function') {
      var preparedById = {};
      plans.forEach(function (plan) {
        preparedById[plan.record.recordId] = {
          status: 'SYNCING',
          sheetName: sheet.getName(),
          row: plan.row,
          trackerYear: trackerYear,
          previousCheckbox: plan.previousStatus,
          previousRemarks: plan.previousRemarks,
          error: ''
        };
      });
      beforeTrackerWrite(preparedById);
    }

    // Scan and remove the exact obsolete c45024e locks once for the whole
    // chunk, never once per asset.
    removeLegacyCycleProtectionsFromSheet(sheet);

    var changedRemarks = plans.filter(function (plan) {
      return plan.nextRemarks !== plan.previousRemarks;
    });
    try {
      changedRemarks.forEach(function (plan) {
        plan.remarksCell.setValue(plan.nextRemarks);
      });
      if (changedRemarks.length) SpreadsheetApp.flush();
    } catch (error) {
      protectedWriteFailure(
        sheet,
        (changedRemarks[0] || plans[0]).remarksCell,
        'legacy import remarks batch',
        error
      );
    }

    try {
      plans.forEach(function (plan) {
        plan.statusCell.setDataValidation(statusValidationRule());
        if (String(plan.previousStatus || '').trim().toUpperCase() !== plan.expectedStatus) {
          plan.statusCell
            .setValue(plan.expectedStatus)
            .setHorizontalAlignment('center')
            .setVerticalAlignment('middle');
        }
      });
      SpreadsheetApp.flush();
    } catch (error) {
      protectedWriteFailure(sheet, plans[0].statusCell, 'legacy import completion batch', error);
    }

    var verified = sheet.getRange(startRow, 1, lastRow - startRow + 1, 9).getValues();
    var results = {};
    plans.forEach(function (plan) {
      var row = verified[plan.row - startRow];
      var statusText = String(row[cycleConfig.checkboxColumn - 1] || '').trim().toUpperCase();
      var remarksText = String(row[cycleConfig.remarksColumn - 1] || '');
      if (statusText !== plan.expectedStatus ||
          remarksText.indexOf('[PMS Record: ' + plan.record.recordId + ']') < 0) {
        PMS.Util.fail(
          'Legacy import tracker verification failed at ' + sheet.getName() + ' row ' + plan.row + '.',
          'SYNC_FAILED'
        );
      }
      results[plan.record.recordId] = {
        status: 'COMPLETED',
        sheetName: sheet.getName(),
        row: plan.row,
        trackerYear: trackerYear,
        previousCheckbox: plan.previousStatus,
        previousRemarks: plan.previousRemarks,
        syncedAt: PMS.Util.nowIso(),
        error: ''
      };
    });
    try {
      PMS.Assets.invalidate(section.key);
    } catch (error) {
      console.warn('Asset cache could not be invalidated after legacy import sync: ' + error.message);
    }
    return results;
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
          T1: { checkbox: PMS.Util.isTrackerComplete(row[3]), status: PMS.Util.isTrackerComplete(row[3]) ? PMS.CONFIG.TRACKER_COMPLETED_VALUE : String(row[3] || ''), remarks: PMS.Util.cleanText(row[4], PMS.CONFIG.MAX_REMARKS_CELL_LENGTH) },
          T2: { checkbox: PMS.Util.isTrackerComplete(row[5]), status: PMS.Util.isTrackerComplete(row[5]) ? PMS.CONFIG.TRACKER_COMPLETED_VALUE : String(row[5] || ''), remarks: PMS.Util.cleanText(row[6], PMS.CONFIG.MAX_REMARKS_CELL_LENGTH) },
          T3: { checkbox: PMS.Util.isTrackerComplete(row[7]), status: PMS.Util.isTrackerComplete(row[7]) ? PMS.CONFIG.TRACKER_COMPLETED_VALUE : String(row[7] || ''), remarks: PMS.Util.cleanText(row[8], PMS.CONFIG.MAX_REMARKS_CELL_LENGTH) }
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
    migrateStatusColumns: migrateStatusColumns,
    statusValidationRule: statusValidationRule,
    syncLegacySeedBatch: syncLegacySeedBatch,
    syncCompletedRecord: syncCompletedRecord,
    syncRepairStatus: syncRepairStatus,
    trackerRows: trackerRows,
    reconcilePending: reconcilePending
  };
})();
