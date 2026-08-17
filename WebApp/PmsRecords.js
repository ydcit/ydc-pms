var PMS = PMS || {};

PMS.Records = (function () {
  function sheetDefinition(sectionKey) {
    if (sectionKey === 'INFRA_SECURITY') {
      return {
        section: 'INFRA_SECURITY',
        name: PMS.CONFIG.INFRA_RESPONSE_SHEET,
        columns: PMS.CONFIG.INFRA_RECORD_COLUMNS
      };
    }
    return {
      section: 'SERVICE_DESK',
      name: PMS.CONFIG.RESPONSE_SHEET,
      columns: PMS.CONFIG.RECORD_COLUMNS
    };
  }

  function allSheetDefinitions() {
    return [sheetDefinition('SERVICE_DESK'), sheetDefinition('INFRA_SECURITY')];
  }

  function definitionForSheet(sheet) {
    var name = typeof sheet === 'string' ? sheet : sheet.getName();
    var definitions = allSheetDefinitions();
    for (var index = 0; index < definitions.length; index += 1) {
      if (definitions[index].name === name) return definitions[index];
    }
    PMS.Util.fail('Unknown PMS record sheet: ' + name, 'CONFIGURATION_ERROR');
  }

  /**
   * Returns the record sheet for a section. With no section this deliberately
   * retains the legacy behavior and returns the Service Desk / system-event
   * sheet, so existing editor helpers remain compatible.
   */
  function responseSheet(createIfMissing, sectionKey) {
    var definition = sheetDefinition(sectionKey || 'SERVICE_DESK');
    var spreadsheet = PMS.Assets.spreadsheet();
    var sheet = spreadsheet.getSheetByName(definition.name);
    if (!sheet && createIfMissing) {
      sheet = spreadsheet.insertSheet(definition.name);
      initializeSheet(sheet, definition.columns);
    }
    if (sheet) verifyHeaders(sheet, definition.columns);
    return sheet;
  }

  function recordSheets(createIfMissing) {
    return allSheetDefinitions().map(function (definition) {
      var sheet = responseSheet(Boolean(createIfMissing), definition.section);
      return sheet ? { sheet: sheet, definition: definition } : null;
    }).filter(Boolean);
  }

  function initializeSheet(sheet, columns) {
    var columnCount = columns.length;
    if (sheet.getMaxColumns() < columnCount) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), columnCount - sheet.getMaxColumns());
    }
    var labels = columns.map(function (column) { return column.label; });
    sheet.getRange(1, 1, 1, columnCount).setValues([labels]);
    sheet.setFrozenRows(1);
    sheet.setHiddenGridlines(false);
    sheet.getRange(1, 1, 1, columnCount)
      .setBackground('#f1f3f4')
      .setFontColor('#202124')
      .setFontWeight('bold')
      .setVerticalAlignment('middle')
      .setWrap(true);
    sheet.setRowHeight(1, 42);
    sheet.setColumnWidths(1, columnCount, 130);
    setColumnWidthByKey(sheet, columns, 'recordId', 190);
    setColumnWidthByKey(sheet, columns, 'technicianName', 180);
    setColumnWidthByKey(sheet, columns, 'technicianEmail', 220);
    setColumnWidthByKey(sheet, columns, 'assetTag', 155);
    ['assetFindings', 'actionTaken', 'recommendation'].forEach(function (key) {
      setColumnWidthByKey(sheet, columns, key, 320);
    });
    setColumnWidthByKey(sheet, columns, 'pmsCompletion', 265);
    if (!sheet.getFilter()) {
      sheet.getRange(1, 1, sheet.getMaxRows(), columnCount).createFilter();
    }
    var completionColumn = columnIndex('pmsCompletion', columns);
    var statusRange = sheet.getRange(2, completionColumn + 1, Math.max(1, sheet.getMaxRows() - 1), 1);
    var rules = [
      SpreadsheetApp.newConditionalFormatRule().whenTextContains('— COMPLETED').setBackground('#e6f4ea').setFontColor('#137333').setRanges([statusRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextContains('— INCOMPLETE').setBackground('#fef7e0').setFontColor('#b06000').setRanges([statusRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextContains('SYNC').setBackground('#fce8e6').setFontColor('#b3261e').setRanges([statusRange]).build()
    ];
    sheet.setConditionalFormatRules(rules);
  }

  function setColumnWidthByKey(sheet, columns, key, width) {
    var index = optionalColumnIndex(key, columns);
    if (index >= 0) sheet.setColumnWidth(index + 1, width);
  }

  function verifyHeaders(sheet, columns) {
    var expected = columns.map(function (column) { return column.label; });
    if (sheet.getMaxColumns() < expected.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), expected.length - sheet.getMaxColumns());
    }
    var current = sheet.getRange(1, 1, 1, expected.length).getDisplayValues()[0];
    var isBlank = current.every(function (value) { return !value; });
    if (isBlank) {
      initializeSheet(sheet, columns);
      return;
    }
    var mismatches = [];
    expected.forEach(function (label, index) {
      if (current[index] !== label) mismatches.push((index + 1) + ': ' + current[index] + ' ≠ ' + label);
    });
    if (mismatches.length) {
      PMS.Util.fail(sheet.getName() + ' header mismatch. Refusing to write: ' + mismatches.slice(0, 5).join('; '), 'SCHEMA_MISMATCH');
    }
  }

  function optionalColumnIndex(key, columns) {
    for (var i = 0; i < columns.length; i += 1) {
      if (columns[i].key === key) return i;
    }
    return -1;
  }

  function columnIndex(key, columns) {
    var index = optionalColumnIndex(key, columns);
    if (index >= 0) return index;
    PMS.Util.fail('Unknown record column: ' + key, 'CONFIGURATION_ERROR');
  }

  function objectToRow(record, columns) {
    return columns.map(function (column) {
      var value = record[column.key];
      if (value === undefined || value === null) return '';
      if (typeof value === 'string' && /^[=+\-@]/.test(value)) return "'" + value;
      return value;
    });
  }

  function rowToObject(row, rowNumber, sheetName, columns) {
    var record = { _rowNumber: rowNumber, _sheetName: sheetName };
    columns.forEach(function (column, index) {
      record[column.key] = row[index] === undefined || row[index] === null ? '' : row[index];
    });
    return record;
  }

  function allRecords() {
    var records = [];
    recordSheets(false).forEach(function (entry) {
      var sheet = entry.sheet;
      var columns = entry.definition.columns;
      if (sheet.getLastRow() < 2) return;
      var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, columns.length).getValues();
      values.forEach(function (row, index) {
        records.push(rowToObject(row, index + 2, sheet.getName(), columns));
      });
    });
    return records;
  }

  // A round trip to Sheets costs far more than a few surplus columns, so
  // near-adjacent columns are merged into one read. Anything further apart than
  // this gets its own read rather than dragging the gap along.
  var FIELD_GAP_TOLERANCE = 10;

  /** Groups sorted column offsets into the ranges worth reading in one call. */
  function columnClusters(offsets) {
    var sorted = offsets.slice().sort(function (a, b) { return a - b; });
    var clusters = [];
    sorted.forEach(function (offset) {
      var current = clusters[clusters.length - 1];
      if (current && offset - current.last <= FIELD_GAP_TOLERANCE) {
        current.last = offset;
        return;
      }
      clusters.push({ first: offset, last: offset });
    });
    return clusters;
  }

  /**
   * Projects the requested columns out of the response sheet.
   *
   * This used to issue one getRange().getValues() per field; with fifteen fields
   * on the dashboard those round trips dominated bootstrap time. Columns are now
   * read in a handful of clustered ranges instead.
   */
  function readRecordFields(keys) {
    var fields = Array.isArray(keys) ? keys.filter(function (key, index, values) {
      return values.indexOf(key) === index;
    }) : [];
    if (!fields.length) return [];
    var records = [];
    recordSheets(false).forEach(function (entry) {
      var sheet = entry.sheet;
      var columns = entry.definition.columns;
      if (sheet.getLastRow() < 2) return;
      var count = sheet.getLastRow() - 1;
      var presentFields = fields.filter(function (key) {
        return optionalColumnIndex(key, columns) >= 0;
      });
      var offsets = presentFields.map(function (key) { return columnIndex(key, columns); });
      var clusters = columnClusters(offsets);
      var blocks = clusters.map(function (cluster) {
        return sheet.getRange(2, cluster.first + 1, count, cluster.last - cluster.first + 1).getValues();
      });

      for (var rowIndex = 0; rowIndex < count; rowIndex += 1) {
        var record = { _rowNumber: rowIndex + 2, _sheetName: sheet.getName() };
        fields.forEach(function (key) { record[key] = ''; });
        for (var position = 0; position < presentFields.length; position += 1) {
          var offset = offsets[position];
          for (var blockIndex = 0; blockIndex < clusters.length; blockIndex += 1) {
            var cluster = clusters[blockIndex];
            if (offset < cluster.first || offset > cluster.last) continue;
            var value = blocks[blockIndex][rowIndex][offset - cluster.first];
            record[presentFields[position]] = value === undefined || value === null ? '' : value;
            break;
          }
        }
        records.push(record);
      }
    });
    return records;
  }

  function dashboardRecords() {
    return readRecordFields([
      'recordId', 'recordType', 'createdAt', 'updatedAt', 'submittedAt',
      'technicianName', 'technicianEmail', 'itSection', 'maintenanceDate',
      'maintenanceYear', 'cycle', 'cycleId', 'assetTag', 'assessmentResult',
      'pmsCompletion'
    ]);
  }

  function findRowByColumn(sheet, key, value, columns) {
    if (!value || sheet.getLastRow() < 2) return 0;
    var column = columnIndex(key, columns || definitionForSheet(sheet).columns) + 1;
    var matches = sheet
      .getRange(2, column, sheet.getLastRow() - 1, 1)
      .createTextFinder(String(value))
      .matchEntireCell(true)
      .findAll();
    if (matches.length > 1) {
      PMS.Util.fail('Duplicate ' + key + ' values detected in ' + sheet.getName() + '.', 'DATA_INTEGRITY_ERROR');
    }
    return matches.length ? matches[0].getRow() : 0;
  }

  function getByRow(sheet, rowNumber) {
    if (!rowNumber) return null;
    var definition = definitionForSheet(sheet);
    return rowToObject(
      sheet.getRange(rowNumber, 1, 1, definition.columns.length).getValues()[0],
      rowNumber,
      sheet.getName(),
      definition.columns
    );
  }

  function findByColumn(key, value) {
    if (!value) return null;
    var matches = [];
    recordSheets(false).forEach(function (entry) {
      var row = findRowByColumn(entry.sheet, key, value, entry.definition.columns);
      if (row) matches.push(getByRow(entry.sheet, row));
    });
    if (matches.length > 1) {
      PMS.Util.fail('Duplicate ' + key + ' values detected across PMS record sheets.', 'DATA_INTEGRITY_ERROR');
    }
    return matches.length ? matches[0] : null;
  }

  function findByRecordId(recordId) {
    return findByColumn('recordId', recordId);
  }

  function findByIdempotencyKey(idempotencyKey) {
    return findByColumn('idempotencyKey', idempotencyKey);
  }

  function ensureRowCapacity(sheet, rowNumber) {
    if (rowNumber > sheet.getMaxRows()) {
      sheet.insertRowsAfter(sheet.getMaxRows(), rowNumber - sheet.getMaxRows());
    }
  }

  function writeRecord(sheet, record, rowNumber) {
    var columns = definitionForSheet(sheet).columns;
    var targetRow = rowNumber || sheet.getLastRow() + 1;
    ensureRowCapacity(sheet, targetRow);
    sheet.getRange(targetRow, 1, 1, columns.length).setValues([objectToRow(record, columns)]);
    markRecordsChanged();
    return targetRow;
  }

  function sheetForStoredRecord(record) {
    if (!record || !record._sheetName) {
      PMS.Util.fail('The stored PMS record has no sheet location.', 'DATA_INTEGRITY_ERROR');
    }
    var sheet = PMS.Assets.spreadsheet().getSheetByName(record._sheetName);
    if (!sheet) PMS.Util.fail('PMS record sheet not found: ' + record._sheetName, 'CONFIGURATION_ERROR');
    verifyHeaders(sheet, definitionForSheet(sheet).columns);
    return sheet;
  }

  function completionKey(sectionKey, assetTag, cycleId) {
    return [sectionKey, PMS.Util.normalizeAssetTag(assetTag), cycleId].join('|');
  }

  function legacySeedRecordId(sectionKey, assetTag, cycleId) {
    var section = PMS.Util.section(sectionKey);
    var normalizedTag = PMS.Util.normalizeAssetTag(assetTag);
    var cycleMatch = /^(\d{4})-(T[123])$/.exec(String(cycleId || '').trim());
    if (!normalizedTag || !cycleMatch) {
      PMS.Util.fail('Cannot create a legacy import identifier from an invalid natural key.', 'VALIDATION_ERROR');
    }
    var naturalKey = completionKey(section.key, normalizedTag, cycleMatch[0]);
    return [
      'LEGACY-SEED',
      cycleMatch[1],
      section.key,
      cycleMatch[2],
      PMS.Util.hashText(naturalKey).slice(0, 32).toUpperCase()
    ].join('-');
  }

  function isMaintenanceRecord(record) {
    return ['MAINTENANCE', 'REINSPECTION', 'LEGACY', 'LEGACY_SEED'].indexOf(String(record.recordType)) >= 0;
  }

  function completedRecord(sectionKey, assetTag, cycleId, excludeRecordId) {
    var key = completionKey(sectionKey, assetTag, cycleId);
    var records = readRecordFields(['recordId', 'recordType', 'itSection', 'assetTag', 'cycleId', 'pmsCompletion']);
    for (var i = records.length - 1; i >= 0; i -= 1) {
      var record = records[i];
      if (record.recordId === excludeRecordId || !isMaintenanceRecord(record)) continue;
      if (PMS.Util.completionState(record.pmsCompletion) !== 'COMPLETED') continue;
      if (completionKey(record.itSection, record.assetTag, record.cycleId) === key) return record;
    }
    return null;
  }

  /**
   * Only an assessment that leaves work outstanding needs a repair ticket.
   *
   * "Follow-up required" means the asset still needs something done, so the
   * repair has to be tracked. "Findings resolved" means it was dealt with during
   * the maintenance itself, and "No findings" means there was nothing to deal
   * with; neither leaves anything to follow, so neither is blocked.
   *
   * Legacy imports do not route through save(), so historical rows keep their
   * original assessment text without needing tickets invented for them.
   */
  function requireFindingsTicket(record) {
    if (record.recordType === 'LEGACY_SEED') return;
    var result = PMS.Util.cleanText(record.assessmentResult, 200).toLowerCase();
    if (result !== 'follow-up required') return;
    if (PMS.Tickets.hasForRecord(record.recordId)) return;
    PMS.Util.fail(
      'This assessment needs follow-up, so a findings ticket is required before PMS can be completed. ' +
        'File the ticket in the Assessment and review step, then complete PMS.',
      'TICKET_REQUIRED'
    );
  }

  function checklistKeys(sectionKey) {
    return PMS.Util.allChecklistItems(sectionKey).map(function (item) { return item.key; });
  }

  function maintenanceDateText(value) {
    if (Object.prototype.toString.call(value) === '[object Date]') {
      return Utilities.formatDate(value, PMS.CONFIG.TIME_ZONE, 'yyyy-MM-dd');
    }
    return String(value || '').slice(0, 10);
  }

  function applyEvidence(record, prefix, evidence) {
    var source = evidence && typeof evidence === 'object' ? evidence : null;
    if (!source) return;
    var recordKeys = PMS.Evidence.evidenceRecordKeys(prefix);
    Object.keys(recordKeys).forEach(function (sourceKey) {
      if (source[sourceKey] === undefined || source[sourceKey] === null) return;
      record[recordKeys[sourceKey]] = source[sourceKey];
    });
  }

  function buildRecord(normalized, asset, existing) {
    var profile = normalized.profile;
    var timestamp = PMS.Util.nowIso();
    var priorCompletion = completedRecord(profile.section, asset.tag, normalized.cycle.cycleId, existing ? existing.recordId : '');
    var record = existing || {};
    record.recordId = record.recordId || PMS.Util.makeRecordId(normalized.cycle);
    record.recordType = priorCompletion ? 'REINSPECTION' : (record.recordType || 'MAINTENANCE');
    // Preserve the schema that originally shaped an existing row. New records
    // use the current schema, while resuming a legacy Service Desk draft must
    // not silently relabel its stored layout as a newer version.
    record.schemaVersion = record.schemaVersion || PMS.CONFIG.SCHEMA_VERSION;
    record.createdAt = record.createdAt || timestamp;
    record.updatedAt = timestamp;
    record.submittedAt = record.submittedAt || '';
    record.idempotencyKey = record.idempotencyKey || normalized.idempotencyKey;
    record.technicianName = profile.name;
    record.technicianEmail = profile.email;
    record.itSection = profile.section;
    if (profile.section === 'INFRA_SECURITY') record.formType = 'INFRA_SECURITY_V1';
    record.maintenanceDate = normalized.maintenanceDate;
    record.maintenanceYear = normalized.cycle.year;
    record.cycle = normalized.cycle.cycle;
    record.cycleId = normalized.cycle.cycleId;
    record.cycleDeadline = normalized.cycle.deadline;
    record.sourceSheet = asset.sheetName;
    record.sourceRow = asset.row;
    record.assetTag = asset.tag;
    record.assetStatus = asset.status;
    record.masterLocation = PMS.Util.safeCellText(asset.location, 500);
    record.observedLocation = PMS.Util.safeCellText(normalized.observedLocation, 500);
    record.locationDiscrepancy = normalized.locationDiscrepancy ? 'YES' : 'NO';

    if (profile.section === 'INFRA_SECURITY') {
      record.assetType = PMS.Util.safeCellText(normalized.assetType, 100);
      applyEvidence(record, 'firmware', normalized.evidence && normalized.evidence.firmware);
      applyEvidence(record, 'backup', normalized.evidence && normalized.evidence.backup);
    } else {
      Object.keys(PMS.CONFIG.PERIPHERAL_RECORD_KEYS).forEach(function (key) {
        record[PMS.CONFIG.PERIPHERAL_RECORD_KEYS[key]] = PMS.Util.safeCellText(
          normalized.peripherals && normalized.peripherals[key],
          2000
        );
      });
    }
    Object.keys(normalized.checklist.values || {}).forEach(function (key) {
      record[key] = normalized.checklist.values[key];
    });
    record.assessmentResult = PMS.Util.safeCellText(normalized.assessment.result, 100);
    record.assetFindings = PMS.Util.safeCellText(normalized.assessment.findings, PMS.CONFIG.MAX_TEXT_LENGTH);
    record.actionTaken = PMS.Util.safeCellText(normalized.assessment.actionTaken, PMS.CONFIG.MAX_TEXT_LENGTH);
    record.recommendation = PMS.Util.safeCellText(normalized.assessment.recommendation, PMS.CONFIG.MAX_TEXT_LENGTH);
    var progress = normalized.progress || normalized.checklist;
    record.completedItems = progress.completed;
    record.applicableItems = progress.applicable;
    record.completionPercent = progress.percent / 100;
    record.trackerSheet = record.trackerSheet || asset.sheetName;
    record.trackerRow = record.trackerRow || asset.row;
    record.trackerCycle = normalized.cycle.cycle;
    record.reinspectionOf = record.reinspectionOf || (priorCompletion ? priorCompletion.recordId : '');

    var flags = [];
    if (!asset.location) flags.push('MISSING_MASTER_LOCATION');
    if (normalized.locationDiscrepancy) flags.push('LOCATION_DISCREPANCY');
    if (normalized.assetTypeUnverified) flags.push('ASSET_TYPE_UNVERIFIED');
    record.dataQualityFlags = flags.join(' | ');
    return record;
  }

  function save(rawPayload, mode) {
    var profile = PMS.Auth.requireProfile();
    var normalized = PMS.Validation.payload(rawPayload, mode, profile);
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) PMS.Util.fail('The system is busy. Please try again.', 'BUSY');
    var result;
    // Set when maintenance actually completes, so the email goes out after the
    // lock is released rather than extending how long it is held.
    var completionNotice = null;
    try {
      var existing = null;
      if (normalized.recordId) {
        existing = findByRecordId(normalized.recordId);
        if (!existing) PMS.Util.fail('The PMS draft was not found. Start a new questionnaire.', 'NOT_FOUND');
      }
      if (!existing) existing = findByIdempotencyKey(normalized.idempotencyKey);
      if (existing && existing.technicianEmail !== profile.email) {
        PMS.Util.fail('You cannot edit another technician’s record.', 'ACCESS_DENIED');
      }
      if (existing && existing.itSection !== profile.section) {
        PMS.Util.fail('You cannot edit a record assigned to another IT section.', 'ACCESS_DENIED');
      }
      if (existing && PMS.Util.completionState(existing.pmsCompletion) === 'COMPLETED') {
        return {
          ok: true,
          recordId: existing.recordId,
          pmsCompletion: existing.pmsCompletion,
          syncStatus: 'COMPLETED',
          message: 'This record was already completed.'
        };
      }

      if (existing && existing.itSection === 'INFRA_SECURITY' && existing._sheetName === PMS.CONFIG.RESPONSE_SHEET) {
        PMS.Util.fail(
          'This Infrastructure & Security draft uses the retired shared-record format and cannot be edited. Start a new maintenance record; the historical draft will remain preserved.',
          'LEGACY_DRAFT_INCOMPATIBLE'
        );
      }

      var sheet = existing ? sheetForStoredRecord(existing) : responseSheet(true, profile.section);

      var asset = PMS.Assets.requireEligible(profile.section, normalized.assetTag);
      PMS.Validation.validateObservedLocation(normalized, asset);
      if (existing && (existing.assetTag !== asset.tag || existing.cycleId !== normalized.cycle.cycleId ||
          maintenanceDateText(existing.maintenanceDate) !== normalized.maintenanceDate ||
          String(existing.idempotencyKey || '') !== normalized.idempotencyKey ||
          (profile.section === 'INFRA_SECURITY' && existing.assetType !== normalized.assetType))) {
        PMS.Util.fail('Asset, asset type, maintenance date, cycle, and request identifier cannot be changed after a draft is created.', 'VALIDATION_ERROR');
      }
      var record = buildRecord(normalized, asset, existing);
      var rowNumber = existing ? existing._rowNumber : 0;

      if (normalized.mode === 'SAVE') {
        record.syncError = '';
        record.pmsCompletion = PMS.Util.progressText(
          normalized.progress.percent,
          normalized.progress.completed,
          normalized.progress.applicable,
          'INCOMPLETE'
        );
        rowNumber = writeRecord(sheet, record, rowNumber);
        result = {
          ok: true,
          recordId: record.recordId,
          pmsCompletion: record.pmsCompletion,
          syncStatus: 'INCOMPLETE',
          message: 'Progress saved. No PMS tracker status was changed.'
        };
      } else {
        requireFindingsTicket(record);
        record.pmsCompletion = PMS.Util.progressText(100, record.completedItems, record.applicableItems, 'SYNCING');
        rowNumber = writeRecord(sheet, record, rowNumber);
        SpreadsheetApp.flush();
        var syncResult;
        try {
          syncResult = PMS.Tracker.syncCompletedRecord(record, function (prepared) {
            record.trackerSheet = prepared.sheetName;
            record.trackerRow = prepared.row;
            record.trackerYear = prepared.trackerYear;
            if (record.previousTrackerCheckbox === '' || record.previousTrackerCheckbox === undefined) {
              record.previousTrackerCheckbox = prepared.previousCheckbox;
            }
            if (!record.previousTrackerRemarks) record.previousTrackerRemarks = prepared.previousRemarks;
            record.syncError = '';
            writeRecord(sheet, record, rowNumber);
            SpreadsheetApp.flush();
          });
        } catch (error) {
          syncResult = { status: 'SYNC_FAILED', error: error.message };
        }
        record.updatedAt = PMS.Util.nowIso();
        record.trackerSheet = syncResult.sheetName || record.trackerSheet;
        record.trackerRow = syncResult.row || record.trackerRow;
        record.trackerYear = syncResult.trackerYear || '';
        if ((record.previousTrackerCheckbox === '' || record.previousTrackerCheckbox === undefined) && syncResult.previousCheckbox !== undefined) {
          record.previousTrackerCheckbox = syncResult.previousCheckbox;
        }
        if (!record.previousTrackerRemarks && syncResult.previousRemarks !== undefined) {
          record.previousTrackerRemarks = syncResult.previousRemarks;
        }
        record.trackerSyncedAt = syncResult.syncedAt || '';
        record.syncError = syncResult.error || '';

        var completedWithoutTracker = syncResult.status === 'HISTORICAL_COMPLETED';
        if (syncResult.status === 'COMPLETED' || completedWithoutTracker) {
          completionNotice = { record: record, trackerStatus: syncResult.trackerStatus || '' };
          record.submittedAt = record.submittedAt || record.updatedAt;
          if (completedWithoutTracker && String(record.dataQualityFlags || '').indexOf('HISTORICAL_NO_TRACKER_WRITE') < 0) {
            record.dataQualityFlags = [record.dataQualityFlags, 'HISTORICAL_NO_TRACKER_WRITE'].filter(Boolean).join(' | ');
          }
          record.pmsCompletion = PMS.Util.progressText(100, record.completedItems, record.applicableItems, 'COMPLETED');
        } else if (syncResult.status === 'SYNC_REQUIRED') {
          record.pmsCompletion = PMS.Util.progressText(100, record.completedItems, record.applicableItems, 'SYNC REQUIRED');
        } else {
          record.pmsCompletion = PMS.Util.progressText(100, record.completedItems, record.applicableItems, 'SYNC FAILED');
        }
        writeRecord(sheet, record, rowNumber);
        result = {
          ok: true,
          recordId: record.recordId,
          pmsCompletion: record.pmsCompletion,
          syncStatus: PMS.Util.completionState(record.pmsCompletion),
          syncError: syncResult.status === 'SYNC_FAILED' ? String(syncResult.error || '').slice(0, 1500) : '',
          trackerStatus: syncResult.trackerStatus || '',
          message: syncResult.status === 'COMPLETED'
            ? 'PMS completed and the ' + record.cycle + ' tracker now shows ' +
              (syncResult.trackerStatus || PMS.CONFIG.TRACKER_COMPLETED_VALUE) + '.'
            : syncResult.status === 'HISTORICAL_COMPLETED'
              ? 'Historical PMS completed in PMS Records. No current-year tracker cell was changed.'
              : syncResult.status === 'SYNC_REQUIRED'
                ? 'PMS is 100% complete but awaits the correct tracker year rollover.'
                : 'The record was saved, but tracker synchronization failed. ' +
                  (syncResult.error ? String(syncResult.error).slice(0, 1500) : 'An administrator can retry it.')
        };
      }
    } finally {
      lock.releaseLock();
    }

    try {
      var refreshedRecords = dashboardRecords();
      result.metrics = PMS.Metrics.dashboard({ section: profile.isAdmin ? 'ALL' : profile.section }, refreshedRecords);
      result.recentRecords = recent(profile, 10, refreshedRecords);
    } catch (error) {
      console.error('Post-save dashboard refresh failed: ' + error.message);
    }

    // Outside the lock, and best effort: a completed record must not be undone
    // by a mail failure, and the module may be absent in a partial deployment.
    if (completionNotice && PMS.Notify) {
      try {
        result.notification = PMS.Notify.pmsCompleted(completionNotice.record, {
          trackerStatus: completionNotice.trackerStatus
        });
      } catch (error) {
        console.warn('PMS completion notification failed: ' + error.message);
      }
    }
    return result;
  }

  function clientRecord(recordId) {
    var profile = PMS.Auth.requireProfile();
    var record = findByRecordId(recordId);
    if (!record) PMS.Util.fail('PMS record was not found.', 'NOT_FOUND');
    if (record.technicianEmail !== profile.email) {
      PMS.Util.fail('You cannot open another technician’s record.', 'ACCESS_DENIED');
    }
    if (record.itSection === 'INFRA_SECURITY' && record._sheetName === PMS.CONFIG.RESPONSE_SHEET &&
        PMS.Util.completionState(record.pmsCompletion) !== 'COMPLETED') {
      PMS.Util.fail(
        'This Infrastructure & Security draft uses the retired shared-record format and cannot be edited. Start a new maintenance record; the historical draft will remain preserved.',
        'LEGACY_DRAFT_INCOMPATIBLE'
      );
    }
    var peripherals = {};
    if (record.itSection !== 'INFRA_SECURITY') {
      Object.keys(PMS.CONFIG.PERIPHERAL_RECORD_KEYS).forEach(function (key) {
        var value = String(record[PMS.CONFIG.PERIPHERAL_RECORD_KEYS[key]] || '');
        peripherals[key] = value ? value.split(' | ') : [];
      });
    }
    var checklist = {};
    if (record.itSection === 'INFRA_SECURITY') {
      checklistKeys('INFRA_SECURITY').forEach(function (key) { checklist[key] = record[key] || ''; });
    } else {
      PMS.Util.allChecklistItems().forEach(function (item) { checklist[item.key] = record[item.key] || ''; });
    }
    return {
      ok: true,
      recordId: record.recordId,
      idempotencyKey: record.idempotencyKey,
      maintenanceDate: maintenanceDateText(record.maintenanceDate),
      formType: record.formType || record.itSection,
      assetType: record.assetType || '',
      assetTag: record.assetTag,
      observedLocation: record.observedLocation,
      locationDiscrepancy: record.locationDiscrepancy === 'YES',
      peripherals: peripherals,
      checklist: checklist,
      evidence: {
        firmware: evidenceFromRecord(record, 'firmware'),
        backup: evidenceFromRecord(record, 'backup')
      },
      assessment: {
        result: record.assessmentResult,
        findings: record.assetFindings,
        actionTaken: record.actionTaken,
        recommendation: record.recommendation
      },
      // Lets a resumed draft know a findings ticket already exists, so the
      // technician is not asked to file a second one.
      tickets: PMS.Tickets.forRecord(record.recordId),
      // Every ticket on this asset, open and closed, including ones raised from
      // an earlier cycle's record. An outstanding repair changes what this visit
      // should be looking at; a closed one is the evidence that a known fault
      // was dealt with, so both belong on the asset.
      assetTickets: PMS.Tickets.ticketsForAsset(record.assetTag),
      pmsCompletion: record.pmsCompletion
    };
  }

  function evidenceFromRecord(record, prefix) {
    return PMS.Evidence.descriptorFromRecord(record, prefix);
  }

  /**
   * Commits an already-created, signed Drive evidence descriptor to an Infra
   * draft. Upload and persistence are deliberately separate: once this write
   * succeeds, a browser reload can recover the evidence from the record.
   */
  function attachEvidence(recordId, evidenceKind, descriptor) {
    var profile = PMS.Auth.requireProfile();
    if (profile.section !== 'INFRA_SECURITY') {
      PMS.Util.fail('Evidence can be attached only to Infrastructure & Security records.', 'ACCESS_DENIED');
    }
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) PMS.Util.fail('The system is busy. Please try again.', 'BUSY');
    try {
      var record = findByRecordId(recordId);
      if (!record) PMS.Util.fail('The PMS draft was not found. Reopen the questionnaire.', 'NOT_FOUND');
      if (record.itSection === 'INFRA_SECURITY' && record._sheetName === PMS.CONFIG.RESPONSE_SHEET) {
        PMS.Util.fail(
          'This Infrastructure & Security draft uses the retired shared-record format and cannot accept evidence. Start a new maintenance record; the historical draft will remain preserved.',
          'LEGACY_DRAFT_INCOMPATIBLE'
        );
      }
      if (record._sheetName !== PMS.CONFIG.INFRA_RESPONSE_SHEET || record.itSection !== 'INFRA_SECURITY') {
        PMS.Util.fail('Evidence can be attached only to the Infrastructure & Security record sheet.', 'ACCESS_DENIED');
      }
      if (PMS.Util.normalizeEmail(record.technicianEmail) !== profile.email) {
        PMS.Util.fail('You cannot attach evidence to another technician\'s record.', 'ACCESS_DENIED');
      }
      if (PMS.Util.completionState(record.pmsCompletion) === 'COMPLETED') {
        PMS.Util.fail('Completed PMS evidence cannot be replaced.', 'RECORD_LOCKED');
      }
      var verified = PMS.Evidence.verifyDescriptor(descriptor, {
        recordId: record.recordId,
        idempotencyKey: record.idempotencyKey,
        assetType: record.assetType,
        assetTag: record.assetTag,
        maintenanceDate: record.maintenanceDate,
        cycleId: record.cycleId,
        itSection: record.itSection,
        evidenceKind: evidenceKind,
        uploadedBy: profile.email
      });
      var keys = PMS.Evidence.evidenceRecordKeys(evidenceKind);
      Object.keys(keys).forEach(function (descriptorKey) {
        record[keys[descriptorKey]] = verified[descriptorKey];
      });

      var completed = checklistKeys('INFRA_SECURITY').reduce(function (total, key) {
        return total + (String(record[key] || '').toUpperCase() === 'DONE' ? 1 : 0);
      }, 0);
      if (record.firmwareEvidenceFileId) completed += 1;
      if (record.backupEvidenceFileId) completed += 1;
      var percent = Math.round(completed / 6 * 100);
      record.updatedAt = PMS.Util.nowIso();
      record.completedItems = completed;
      record.applicableItems = 6;
      record.completionPercent = percent / 100;
      record.pmsCompletion = PMS.Util.progressText(percent, completed, 6, 'INCOMPLETE');
      writeRecord(sheetForStoredRecord(record), record, record._rowNumber);
      SpreadsheetApp.flush();
      return {
        ok: true,
        recordId: record.recordId,
        evidenceKind: verified.evidenceKind,
        descriptor: verified,
        pmsCompletion: record.pmsCompletion
      };
    } finally {
      lock.releaseLock();
    }
  }

  /*
    Completed-maintenance archive.

    Deliberately a narrow projection: readRecordFields() issues one range read
    per field, so every extra column costs another sheet round trip. Year and
    cycle are derived from cycleId, and the location discrepancy from the two
    location fields, rather than read as their own columns.
  */
  var COMPLETED_FIELDS = [
    'recordId', 'recordType', 'submittedAt', 'technicianName', 'technicianEmail',
    'itSection', 'maintenanceDate', 'cycleId', 'assetTag', 'masterLocation',
    'observedLocation', 'assessmentResult', 'pmsCompletion'
  ];

  function cellText(value) {
    if (value === undefined || value === null) return '';
    if (Object.prototype.toString.call(value) === '[object Date]') {
      return Utilities.formatDate(value, PMS.CONFIG.TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
    }
    return String(value).trim();
  }

  function cycleParts(cycleId) {
    var match = /^(\d{4})-(T[123])$/.exec(String(cycleId || '').trim());
    return match ? { year: Number(match[1]), cycle: match[2] } : { year: 0, cycle: '' };
  }

  function boundedInteger(value, fallback, minimum, maximum) {
    var number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(minimum, Math.min(maximum, Math.floor(number)));
  }

  // Sortable columns, plus the fallbacks used to break ties so ordering is
  // deterministic and a row can never appear on two pages.
  var COMPLETED_SORTS = Object.freeze({
    maintenanceDate: ['maintenanceDate', 'submittedAt'],
    submittedAt: ['submittedAt', 'maintenanceDate'],
    assetTag: ['assetTag', 'maintenanceDate'],
    location: ['location', 'assetTag'],
    cycleId: ['cycleId', 'maintenanceDate'],
    technicianName: ['technicianName', 'maintenanceDate'],
    assessmentResult: ['assessmentResult', 'maintenanceDate']
  });

  // "All" still needs a ceiling: google.script.run has already proven to fail
  // silently on an oversized response, so the count is capped and the caller is
  // told when the list was cut short.
  var COMPLETED_ALL_CAP = 1000;

  function completedComparator(sortKey, ascending) {
    var keys = COMPLETED_SORTS[sortKey] || COMPLETED_SORTS.maintenanceDate;
    var factor = ascending ? 1 : -1;
    return function (a, b) {
      for (var index = 0; index < keys.length; index += 1) {
        var key = keys[index];
        var left = String(a[key] || '');
        var right = String(b[key] || '');
        if (left !== right) {
          return factor * left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
        }
      }
      var idComparison = String(a.recordId || '').localeCompare(String(b.recordId || ''));
      return idComparison ? factor * idComparison : factor * (a.row - b.row);
    };
  }

  /**
   * Completed maintenance visible to the caller.
   *
   * An administrator sees every section; a technician sees only their own
   * records in their registered section. The scope is enforced here from the
   * server-resolved context, never from a browser-supplied value.
   */
  /*
    Cache version and generation for the completed-records projection.

    The version is in the key, so a deployment that changes the projected shape
    ignores what an older one stored. The generation is bumped by every record
    write, which is what makes this cache safe rather than merely fast: paging,
    sorting, filtering and searching all run against the cached projection, and
    the moment any record changes, every cached scope for every viewer becomes
    unreachable instead of stale.

    Scope is in the key too, because it decides which rows exist at all. An
    administrator's projection is not a superset another technician may read from:
    that would leak other sections' records if the key were ever shared.
  */
  var COMPLETED_CACHE_VERSION = 1;
  var GENERATION_PROPERTY = 'PMS_RECORDS_GENERATION';

  function completedCacheKey(isAdmin, viewerEmail, section) {
    // Spelled out rather than hashed: a digest would cost a Utilities round trip
    // on a path whose whole purpose is to avoid round trips, and a legible key is
    // easier to reason about when something is stale.
    var scope = isAdmin
      ? 'ALL'
      : String(viewerEmail + '_' + section).replace(/[^A-Za-z0-9]+/g, '_');
    return 'PMS_COMPLETED_V' + COMPLETED_CACHE_VERSION + '_' +
      PMS.Util.generation(GENERATION_PROPERTY) + '_' + scope;
  }

  /**
   * Marks the record sheets as changed.
   *
   * Called from the three places that write a record row rather than from the
   * higher-level operations, so a path added later cannot forget: a save, a
   * legacy import and a batched seed all funnel through those writes.
   */
  function markRecordsChanged() {
    PMS.Util.bumpGeneration(GENERATION_PROPERTY);
  }

  /**
   * Completed records the viewer may see, projected to what the list needs.
   *
   * The expensive half of completedList, split out so it can be cached whole.
   * Filtering and paging deliberately stay outside: they change with every
   * keystroke, while this changes only when somebody finishes maintenance.
   */
  function completedProjection(isAdmin, viewerEmail, section, forceRefresh) {
    var key = completedCacheKey(isAdmin, viewerEmail, section);
    if (!forceRefresh) {
      var cached = PMS.Util.cacheGet(key);
      if (Array.isArray(cached)) return cached;
    }

    var scoped = readRecordFields(COMPLETED_FIELDS)
      .filter(function (record) {
        if (!isMaintenanceRecord(record)) return false;
        if (PMS.Util.completionState(cellText(record.pmsCompletion)) !== 'COMPLETED') return false;
        if (isAdmin) return true;
        return PMS.Util.normalizeEmail(cellText(record.technicianEmail)) === viewerEmail &&
          cellText(record.itSection) === section;
      })
      .map(function (record) {
        var parts = cycleParts(record.cycleId);
        var master = cellText(record.masterLocation);
        var observed = cellText(record.observedLocation);
        return {
          recordId: cellText(record.recordId),
          assetTag: PMS.Util.normalizeAssetTag(record.assetTag),
          maintenanceDate: maintenanceDateText(record.maintenanceDate),
          submittedAt: cellText(record.submittedAt),
          cycleId: cellText(record.cycleId),
          year: parts.year,
          cycle: parts.cycle,
          section: cellText(record.itSection),
          technicianName: cellText(record.technicianName),
          technicianEmail: cellText(record.technicianEmail),
          assessmentResult: cellText(record.assessmentResult),
          location: observed || master,
          locationDiscrepancy: Boolean(observed && observed !== master),
          row: record._rowNumber
        };
      });

    PMS.Util.cachePut(key, scoped);
    return scoped;
  }

  function completedList(context, options) {
    var request = options && typeof options === 'object' ? options : {};
    var isAdmin = Boolean(context.isAdmin);
    var viewerEmail = PMS.Util.normalizeEmail(context.email);
    var scoped = completedProjection(
      isAdmin, viewerEmail, context.section, Boolean(request.refresh)
    );

    // Filter options come from everything in scope, so they stay stable while
    // the user narrows the list.
    var yearSet = {};
    var cycleSet = {};
    var sectionSet = {};
    scoped.forEach(function (record) {
      if (record.year) yearSet[record.year] = true;
      if (record.cycle) cycleSet[record.cycle] = true;
      if (record.section) sectionSet[record.section] = true;
    });

    var search = PMS.Util.cleanText(request.search, 120).toUpperCase();
    var year = Number(request.year) || 0;
    var cycle = PMS.Util.cleanText(request.cycle, 4).toUpperCase();
    var section = isAdmin ? PMS.Util.cleanText(request.section, 40).toUpperCase() : '';

    var filtered = scoped.filter(function (record) {
      if (year && record.year !== year) return false;
      if (cycle && record.cycle !== cycle) return false;
      if (section && record.section !== section) return false;
      if (!search) return true;
      return [record.assetTag, record.location, record.technicianName, record.recordId, record.assessmentResult]
        .join(' ')
        .toUpperCase()
        .indexOf(search) >= 0;
    });

    var sortKey = COMPLETED_SORTS[PMS.Util.cleanText(request.sort, 40)] ? PMS.Util.cleanText(request.sort, 40) : 'maintenanceDate';
    var ascending = PMS.Util.cleanText(request.direction, 4).toUpperCase() === 'ASC';
    filtered.sort(completedComparator(sortKey, ascending));

    var uniqueAssets = {};
    filtered.forEach(function (record) {
      if (record.assetTag) uniqueAssets[record.section + '|' + record.assetTag] = true;
    });

    var showAll = PMS.Util.cleanText(request.pageSize, 8).toUpperCase() === 'ALL';
    var truncated = false;
    var pageSize;
    var page;
    var start;
    if (showAll) {
      truncated = filtered.length > COMPLETED_ALL_CAP;
      pageSize = Math.max(1, Math.min(filtered.length || 1, COMPLETED_ALL_CAP));
      page = 1;
      start = 0;
    } else {
      pageSize = boundedInteger(request.pageSize, 20, 5, 100);
      page = boundedInteger(request.page, 1, 1, Math.max(1, Math.ceil(filtered.length / pageSize)));
      start = (page - 1) * pageSize;
    }
    var totalPages = showAll ? 1 : Math.max(1, Math.ceil(filtered.length / pageSize));

    /*
      Tickets, attached to the page rather than to everything in scope: one
      ticket read decorates the twenty rows about to be drawn, and annotating
      rows nobody will look at is what made this list slow the first time it was
      tried.

      Closed tickets come too. A row whose asset was broken and then repaired
      should say so; showing only open ones made a resolved repair look like it
      never happened.

      The projection is cached, so these are copies rather than the cached
      objects themselves. Decorating in place would otherwise write the ticket
      state into the cache and outlive the ticket sheet it came from.
    */
    var pageRows = filtered.slice(start, start + pageSize).map(function (record) {
      return Object.assign({}, record);
    });
    var byAsset = PMS.Tickets.ticketsByAsset(pageRows.map(function (record) {
      return record.assetTag;
    }));
    pageRows.forEach(function (record) {
      var entry = byAsset[record.assetTag];
      record.assetTickets = entry ? entry.tickets : [];
      record.openTicketCount = entry ? entry.openCount : 0;
      record.closedTicketCount = entry ? entry.closedCount : 0;
      record.totalTicketCount = entry ? entry.total : 0;
    });

    return {
      ok: true,
      scope: isAdmin ? 'ALL_SECTIONS' : 'OWN_RECORDS',
      rows: pageRows,
      page: page,
      pageSize: pageSize,
      pageSizeMode: showAll ? 'ALL' : String(pageSize),
      totalPages: totalPages,
      total: filtered.length,
      totalInScope: scoped.length,
      uniqueAssets: Object.keys(uniqueAssets).length,
      rangeStart: filtered.length ? start + 1 : 0,
      rangeEnd: Math.min(start + pageSize, filtered.length),
      sort: sortKey,
      direction: ascending ? 'ASC' : 'DESC',
      truncated: truncated,
      cap: COMPLETED_ALL_CAP,
      filters: {
        years: Object.keys(yearSet).map(Number).sort(function (a, b) { return b - a; }),
        cycles: Object.keys(cycleSet).sort(),
        sections: Object.keys(sectionSet).sort()
      }
    };
  }

  function recent(profile, limit, recordSet) {
    var records = Array.isArray(recordSet) ? recordSet.slice() : dashboardRecords();
    records.sort(function (a, b) {
      var aTime = String(a.submittedAt || a.updatedAt || a.createdAt || '');
      var bTime = String(b.submittedAt || b.updatedAt || b.createdAt || '');
      return bTime.localeCompare(aTime) ||
        String(b.recordId || '').localeCompare(String(a.recordId || '')) ||
        b._rowNumber - a._rowNumber;
    });
    var output = [];
    for (var i = 0; i < records.length && output.length < (limit || 10); i += 1) {
      var record = records[i];
      if (!isMaintenanceRecord(record)) continue;
      if (!profile.isAdmin && record.technicianEmail !== profile.email) continue;
      if (!profile.isAdmin && record.itSection !== profile.section) continue;
      output.push({
        recordId: record.recordId,
        maintenanceDate: maintenanceDateText(record.maintenanceDate),
        cycleId: record.cycleId,
        assetTag: record.assetTag,
        technicianName: record.technicianName,
        assessmentResult: record.assessmentResult,
        pmsCompletion: record.pmsCompletion,
        editable: record.recordType !== 'LEGACY_SEED' &&
          PMS.Util.completionState(record.pmsCompletion) !== 'COMPLETED'
      });
    }
    return output;
  }

  function completionKeys(year) {
    var keys = {};
    readRecordFields(['recordId', 'recordType', 'itSection', 'assetTag', 'maintenanceYear', 'cycleId', 'pmsCompletion']).forEach(function (record) {
      if (!isMaintenanceRecord(record)) return;
      if (Number(record.maintenanceYear) !== Number(year)) return;
      if (PMS.Util.completionState(record.pmsCompletion) !== 'COMPLETED') return;
      keys[completionKey(record.itSection, record.assetTag, record.cycleId)] = record.recordId;
    });
    return keys;
  }

  function legacyRecordObject(data, timestamp) {
    var cycle = PMS.CONFIG.CYCLES[data.cycle];
    var legacyRemarks = String(data.remarks || 'Legacy assessment not captured');
    var legacyFlags = ['LEGACY_IMPORT'];
    if (legacyRemarks.length > PMS.CONFIG.MAX_TEXT_LENGTH) legacyFlags.push('LEGACY_REMARKS_TRUNCATED_IN_FINDINGS');
    return {
      recordId: data.recordId,
      recordType: 'LEGACY',
      schemaVersion: PMS.CONFIG.SCHEMA_VERSION,
      createdAt: timestamp,
      updatedAt: timestamp,
      submittedAt: timestamp,
      idempotencyKey: data.recordId,
      technicianName: 'Legacy Tracker Import',
      technicianEmail: '',
      itSection: data.section,
      formType: data.section === 'INFRA_SECURITY' ? 'INFRA_SECURITY_V1' : data.section,
      maintenanceDate: '',
      maintenanceYear: data.year,
      cycle: data.cycle,
      cycleId: data.year + '-' + data.cycle,
      cycleDeadline: data.year + '-' + String(cycle.endMonth).padStart(2, '0') + '-' + String(cycle.endDay).padStart(2, '0'),
      sourceSheet: data.sheetName,
      sourceRow: data.row,
      assetTag: data.assetTag,
      assetStatus: data.assetStatus,
      masterLocation: PMS.Util.safeCellText(data.location, 500),
      assessmentResult: 'Legacy record',
      assetFindings: PMS.Util.safeCellText(legacyRemarks.slice(0, PMS.CONFIG.MAX_TEXT_LENGTH), PMS.CONFIG.MAX_TEXT_LENGTH),
      actionTaken: 'Imported from the legacy PMS tracker baseline.',
      recommendation: data.remarks ? 'Review the preserved legacy tracker remarks.' : 'Legacy assessment not captured.',
      completedItems: 0,
      applicableItems: 0,
      completionPercent: data.checkbox ? 1 : 0,
      trackerSheet: data.sheetName,
      trackerRow: data.row,
      trackerYear: data.year,
      trackerCycle: data.cycle,
      previousTrackerCheckbox: data.checkbox,
      previousTrackerRemarks: PMS.Util.safeCellText(data.remarks, PMS.CONFIG.MAX_REMARKS_CELL_LENGTH),
      trackerSyncedAt: timestamp,
      dataQualityFlags: legacyFlags.join(' | '),
      pmsCompletion: PMS.Util.progressText(data.checkbox ? 100 : 0, 0, 0, data.checkbox ? 'COMPLETED' : 'INCOMPLETE')
    };
  }

  function addDataQualityFlag(record, flag) {
    var flags = String(record.dataQualityFlags || '').split('|').map(function (item) {
      return item.trim();
    }).filter(Boolean);
    if (flags.indexOf(flag) < 0) flags.push(flag);
    record.dataQualityFlags = flags.join(' | ');
  }

  function hasDataQualityFlag(record, flag) {
    return String(record.dataQualityFlags || '').split('|').map(function (item) {
      return item.trim();
    }).indexOf(flag) >= 0;
  }

  function legacySeedRecordObject(data, timestamp) {
    var cycle = data.cycle;
    var asset = data.asset;
    var admin = data.admin;
    var sourceNote = PMS.Util.safeCellText(
      data.sourceNote || 'Legacy source note not provided.',
      PMS.CONFIG.MAX_TEXT_LENGTH
    );
    var flags = [
      'LEGACY_IMPORT',
      'ADMIN_BULK_SEED',
      'LEGACY_CHECKLIST_NOT_CAPTURED',
      'IMPORT_BATCH:' + data.batchId
    ];
    if (!data.sourceNote) flags.push('LEGACY_SOURCE_NOTE_NOT_CAPTURED');
    if (data.historical) flags.push('HISTORICAL_NO_TRACKER_WRITE');
    if (asset.status !== 'INPROD') flags.push('HISTORICAL_NON_INPROD_ASSET');
    if (data.section === 'INFRA_SECURITY') flags.push('LEGACY_EVIDENCE_NOT_CAPTURED');

    var record = {
      recordId: data.recordId,
      recordType: 'LEGACY_SEED',
      schemaVersion: PMS.CONFIG.SCHEMA_VERSION,
      formType: data.section === 'INFRA_SECURITY' ? 'INFRA_SECURITY_V1' : data.section,
      createdAt: timestamp,
      updatedAt: timestamp,
      submittedAt: data.historical ? timestamp : '',
      idempotencyKey: data.recordId,
      technicianName: 'Legacy PMS Import',
      // Deliberately blank: the importing administrator certified the legacy
      // source but must not receive "My Completed" technician credit.
      technicianEmail: '',
      itSection: data.section,
      maintenanceDate: data.maintenanceDate,
      maintenanceYear: cycle.year,
      cycle: cycle.cycle,
      cycleId: cycle.cycleId,
      cycleDeadline: cycle.deadline,
      sourceSheet: asset.sheetName,
      sourceRow: asset.row,
      assetTag: asset.tag,
      assetStatus: asset.status,
      masterLocation: PMS.Util.safeCellText(asset.location, 500),
      observedLocation: '',
      locationDiscrepancy: 'NO',
      assessmentResult: 'Legacy record',
      assetFindings: sourceNote,
      actionTaken: PMS.Util.safeCellText(
        'Legacy PMS completion imported by ' + admin.name + ' <' + admin.email + '> on ' +
          timestamp + '. Import batch: ' + data.batchId + '.',
        PMS.CONFIG.MAX_TEXT_LENGTH
      ),
      recommendation: data.section === 'INFRA_SECURITY'
        ? 'Detailed legacy checklist and Infrastructure evidence were not captured by this import.'
        : 'Detailed legacy checklist results were not captured by this import.',
      completedItems: 0,
      applicableItems: 0,
      completionPercent: 1,
      trackerSheet: asset.sheetName,
      trackerRow: asset.row,
      trackerYear: data.trackerYear,
      trackerCycle: cycle.cycle,
      previousTrackerCheckbox: '',
      previousTrackerRemarks: '',
      trackerSyncedAt: '',
      syncError: '',
      reinspectionOf: '',
      dataQualityFlags: flags.join(' | '),
      pmsCompletion: PMS.Util.progressText(100, 0, 0, data.historical ? 'COMPLETED' : 'SYNCING')
    };
    if (data.section === 'INFRA_SECURITY') {
      record.assetType = PMS.Validation.inferInfraAssetType(asset.tag) || '';
      if (!record.assetType) addDataQualityFlag(record, 'ASSET_TYPE_UNVERIFIED');
    }
    return record;
  }

  function writeRecordObjectsBatch(sheet, records) {
    if (!records.length) return;
    var columns = definitionForSheet(sheet).columns;
    var sorted = records.slice().sort(function (left, right) {
      return Number(left._rowNumber) - Number(right._rowNumber);
    });
    var groups = [];
    sorted.forEach(function (record) {
      var current = groups[groups.length - 1];
      if (current && Number(record._rowNumber) === current.startRow + current.records.length) {
        current.records.push(record);
      } else {
        groups.push({ startRow: Number(record._rowNumber), records: [record] });
      }
    });
    groups.forEach(function (group) {
      ensureRowCapacity(sheet, group.startRow + group.records.length - 1);
      sheet.getRange(group.startRow, 1, group.records.length, columns.length).setValues(
        group.records.map(function (record) { return objectToRow(record, columns); })
      );
    });
    markRecordsChanged();
  }

  /**
   * Stages one already-authorized legacy-import chunk. Callers must hold the
   * script lock and supply either a fresh item or its exact existing
   * LEGACY_SEED record from the same locked revalidation pass.
   */
  function stageLegacySeedBatch(items) {
    var list = Array.isArray(items) ? items : [];
    if (!list.length) return [];
    var sectionKey = list[0].section;
    if (!list.every(function (item) { return item.section === sectionKey; })) {
      PMS.Util.fail('A legacy import chunk must contain one IT section.', 'DATA_INTEGRITY_ERROR');
    }
    var sheet = responseSheet(true, sectionKey);
    var timestamp = PMS.Util.nowIso();
    var nextRow = sheet.getLastRow() + 1;
    var records = list.map(function (item) {
      var record = item.existing || legacySeedRecordObject(item, timestamp);
      var expectedId = legacySeedRecordId(item.section, item.asset.tag, item.cycle.cycleId);
      if (record.recordId !== expectedId || String(record.recordType) !== 'LEGACY_SEED' ||
          completionKey(record.itSection, record.assetTag, record.cycleId) !==
            completionKey(item.section, item.asset.tag, item.cycle.cycleId)) {
        PMS.Util.fail('A legacy import record conflicts with its deterministic natural key.', 'DATA_INTEGRITY_ERROR');
      }
      if (item.existing && maintenanceDateText(record.maintenanceDate) !== item.maintenanceDate) {
        PMS.Util.fail('A resumable legacy import has a different maintenance date.', 'IMPORT_PREVIEW_STALE');
      }
      if (item.existing && record._sheetName !== sheet.getName()) {
        PMS.Util.fail('A legacy import record is stored in the wrong section sheet.', 'DATA_INTEGRITY_ERROR');
      }
      if (!item.existing) {
        record._sheetName = sheet.getName();
        record._rowNumber = nextRow;
        nextRow += 1;
      }
      record.updatedAt = timestamp;
      record.trackerYear = item.trackerYear;
      record.trackerSheet = item.asset.sheetName;
      record.trackerRow = item.asset.row;
      record.trackerCycle = item.cycle.cycle;
      record.syncError = '';
      addDataQualityFlag(record, 'ADMIN_BULK_SEED');
      if (item.historical) {
        addDataQualityFlag(record, 'HISTORICAL_NO_TRACKER_WRITE');
        if (item.asset.status !== 'INPROD') addDataQualityFlag(record, 'HISTORICAL_NON_INPROD_ASSET');
        record.submittedAt = record.submittedAt || timestamp;
        record.pmsCompletion = PMS.Util.progressText(100, 0, 0, 'COMPLETED');
      } else {
        record.pmsCompletion = PMS.Util.progressText(100, 0, 0, 'SYNCING');
      }
      return record;
    });
    writeRecordObjectsBatch(sheet, records);
    SpreadsheetApp.flush();
    return records;
  }

  function finalizeLegacySeedBatch(records, syncResults, failureMessage) {
    var list = Array.isArray(records) ? records : [];
    if (!list.length) return [];
    var results = syncResults || {};
    var timestamp = PMS.Util.nowIso();
    list.forEach(function (record) {
      var result = results[record.recordId] || {
        status: 'SYNC_FAILED',
        error: failureMessage || 'Legacy tracker synchronization did not return a result.'
      };
      record.updatedAt = timestamp;
      record.trackerSheet = result.sheetName || record.trackerSheet;
      record.trackerRow = result.row || record.trackerRow;
      record.trackerYear = result.trackerYear || record.trackerYear;
      if (!hasDataQualityFlag(record, 'TRACKER_PRIOR_STATE_CAPTURED') &&
          result.previousCheckbox !== undefined) {
        record.previousTrackerCheckbox = result.previousCheckbox;
        record.previousTrackerRemarks = result.previousRemarks;
        addDataQualityFlag(record, 'TRACKER_PRIOR_STATE_CAPTURED');
      }
      record.trackerSyncedAt = result.syncedAt || '';
      record.syncError = result.error ? String(result.error).slice(0, 1500) : '';
      if (result.status === 'COMPLETED') {
        record.submittedAt = record.submittedAt || timestamp;
        record.pmsCompletion = PMS.Util.progressText(100, 0, 0, 'COMPLETED');
      } else {
        record.pmsCompletion = PMS.Util.progressText(100, 0, 0, 'SYNC FAILED');
      }
    });
    var sheet = sheetForStoredRecord(list[0]);
    if (!list.every(function (record) { return record._sheetName === sheet.getName(); })) {
      PMS.Util.fail('A legacy import finalize chunk crossed record sheets.', 'DATA_INTEGRITY_ERROR');
    }
    writeRecordObjectsBatch(sheet, list);
    SpreadsheetApp.flush();
    return list;
  }

  function stageLegacySeedTrackerState(records, preparedById) {
    var list = Array.isArray(records) ? records : [];
    var prepared = preparedById || {};
    list.forEach(function (record) {
      var state = prepared[record.recordId];
      if (!state) PMS.Util.fail('Legacy tracker preparation is incomplete.', 'DATA_INTEGRITY_ERROR');
      record.trackerSheet = state.sheetName || record.trackerSheet;
      record.trackerRow = state.row || record.trackerRow;
      record.trackerYear = state.trackerYear || record.trackerYear;
      if (!hasDataQualityFlag(record, 'TRACKER_PRIOR_STATE_CAPTURED')) {
        record.previousTrackerCheckbox = state.previousCheckbox;
        record.previousTrackerRemarks = state.previousRemarks;
        addDataQualityFlag(record, 'TRACKER_PRIOR_STATE_CAPTURED');
      }
      record.updatedAt = PMS.Util.nowIso();
    });
    if (!list.length) return list;
    var sheet = sheetForStoredRecord(list[0]);
    writeRecordObjectsBatch(sheet, list);
    SpreadsheetApp.flush();
    return list;
  }

  function appendLegacyRecordsBatch(dataList, existingById) {
    var items = Array.isArray(dataList) ? dataList : [];
    if (!items.length) return { appended: 0, appendedBySection: {} };
    var recordsById = existingById || {};
    if (!existingById) {
      readRecordFields(['recordId', 'recordType', 'itSection', 'cycleId']).forEach(function (record) {
        recordsById[record.recordId] = record;
      });
    }
    var timestamp = PMS.Util.nowIso();
    var rowsBySection = { SERVICE_DESK: [], INFRA_SECURITY: [] };
    var appendedBySection = {};
    items.forEach(function (data) {
      var existing = recordsById[data.recordId];
      if (existing) {
        if (existing.recordType !== 'LEGACY' || existing.itSection !== data.section || String(existing.cycleId) !== data.year + '-' + data.cycle) {
          PMS.Util.fail('A reserved legacy audit identifier is already used by another record.', 'DATA_INTEGRITY_ERROR');
        }
        return;
      }
      var record = legacyRecordObject(data, timestamp);
      recordsById[data.recordId] = record;
      var definition = sheetDefinition(data.section);
      rowsBySection[data.section].push(objectToRow(record, definition.columns));
      appendedBySection[data.section] = (appendedBySection[data.section] || 0) + 1;
    });
    Object.keys(rowsBySection).forEach(function (sectionKey) {
      var rows = rowsBySection[sectionKey];
      if (!rows.length) return;
      var sheet = responseSheet(true, sectionKey);
      var columns = sheetDefinition(sectionKey).columns;
      var firstRow = sheet.getLastRow() + 1;
      ensureRowCapacity(sheet, firstRow + rows.length - 1);
      sheet.getRange(firstRow, 1, rows.length, columns.length).setValues(rows);
    });
    var appended = Object.keys(rowsBySection).reduce(function (total, sectionKey) {
      return total + rowsBySection[sectionKey].length;
    }, 0);
    if (appended) markRecordsChanged();
    return { appended: appended, appendedBySection: appendedBySection };
  }

  function appendLegacyRecord(data) {
    return appendLegacyRecordsBatch([data]).appended === 1;
  }

  /**
   * Cheap check for "the baseline already exists for every section".
   *
   * Reads only each tracker's year cell, so the steady state costs two single
   * cell reads instead of a script lock plus a full scan of the response sheet
   * and both tracker sheets. Returns null when anything is missing, so the
   * caller falls through to the real, locked path.
   */
  function existingBaselines(propertyStore) {
    var sectionKeys = Object.keys(PMS.CONFIG.SECTIONS);
    var found = [];
    for (var index = 0; index < sectionKeys.length; index += 1) {
      var sectionKey = sectionKeys[index];
      var sheet = PMS.Assets.sheetForSection(sectionKey);
      var year = Number(
        sheet.getRange(PMS.CONFIG.TRACKER_YEAR_ROW, PMS.CONFIG.TRACKER_YEAR_COLUMN).getValue()
      );
      if (!year) return null;
      if (!propertyStore.getProperty(PMS.CONFIG.BASELINE_PROPERTY_PREFIX + year + '_' + sectionKey)) {
        return null;
      }
      found.push({ section: sectionKey, year: year, status: 'EXISTS' });
    }
    return found.length === sectionKeys.length ? found : null;
  }

  function ensureTrackerBaseline() {
    var propertyStore = PropertiesService.getScriptProperties();
    // Fast path first: this runs on every bootstrap, and after the one-time
    // migration there is nothing left to do.
    var alreadyDone = existingBaselines(propertyStore);
    if (alreadyDone) {
      return { migrated: 0, baselines: alreadyDone };
    }
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) PMS.Util.fail('The system is preparing the PMS baseline. Please try again.', 'BUSY');
    var baselines = [];
    try {
      var knownRecords = {};
      readRecordFields(['recordId', 'recordType', 'itSection', 'cycleId']).forEach(function (record) {
        knownRecords[record.recordId] = record;
      });
      var candidates = [];
      var pendingBaselines = [];
      Object.keys(PMS.CONFIG.SECTIONS).forEach(function (sectionKey) {
        var tracker = PMS.Tracker.trackerRows(sectionKey);
        if (!tracker.year) PMS.Util.fail(tracker.sheetName + ' is missing its tracker year in D2.', 'CONFIGURATION_ERROR');
        var propertyKey = PMS.CONFIG.BASELINE_PROPERTY_PREFIX + tracker.year + '_' + sectionKey;
        if (propertyStore.getProperty(propertyKey)) {
          baselines.push({ section: sectionKey, year: tracker.year, status: 'EXISTS' });
          return;
        }
        pendingBaselines.push({ propertyKey: propertyKey, section: sectionKey, year: tracker.year });
        tracker.rows.forEach(function (row) {
          Object.keys(PMS.CONFIG.CYCLES).forEach(function (cycle) {
            var term = row[cycle];
            if (!term.checkbox && !term.remarks) return;
            var markers = String(term.remarks || '').match(/\[PMS Record: ([^\]]+)\]/g) || [];
            var hasKnownAppRecord = markers.some(function (marker) {
              var recordId = marker.slice(13, -1);
              return Boolean(knownRecords[recordId]);
            });
            if (hasKnownAppRecord) return;
            var recordId = [
              'LEGACY',
              tracker.year,
              sectionKey,
              cycle,
              PMS.Util.hashText(row.assetTag).slice(0, 12).toUpperCase()
            ].join('-');
            candidates.push({
              recordId: recordId,
              section: sectionKey,
              year: tracker.year,
              cycle: cycle,
              sheetName: tracker.sheetName,
              row: row.row,
              assetTag: row.assetTag,
              assetStatus: row.status,
              location: row.location,
              checkbox: term.checkbox,
              remarks: term.remarks
            });
          });
        });
      });
      var batch = appendLegacyRecordsBatch(candidates, knownRecords);
      pendingBaselines.forEach(function (baseline) {
        propertyStore.setProperty(baseline.propertyKey, PMS.Util.nowIso());
        baselines.push({
          section: baseline.section,
          year: baseline.year,
          status: 'CREATED',
          migrated: batch.appendedBySection[baseline.section] || 0
        });
      });
    } finally {
      lock.releaseLock();
    }
    return {
      migrated: baselines.reduce(function (total, baseline) { return total + (Number(baseline.migrated) || 0); }, 0),
      baselines: baselines
    };
  }

  function appendSystemEvent(eventId, eventType, data) {
    var sheet = responseSheet(true);
    var existing = findByRecordId(eventId);
    if (existing) {
      if (existing.recordType !== eventType || Number(existing.maintenanceYear) !== Number(data.year || 0)) {
        PMS.Util.fail('A reserved rollover audit identifier is already used by another record.', 'DATA_INTEGRITY_ERROR');
      }
      return false;
    }
    var timestamp = PMS.Util.nowIso();
    var record = {
      recordId: eventId,
      recordType: eventType,
      schemaVersion: PMS.CONFIG.SCHEMA_VERSION,
      createdAt: timestamp,
      updatedAt: timestamp,
      submittedAt: timestamp,
      idempotencyKey: eventId,
      technicianName: data.adminName || '',
      technicianEmail: data.adminEmail || '',
      maintenanceYear: data.year || '',
      cycleId: data.cycleId || '',
      assetFindings: PMS.Util.safeCellText(JSON.stringify(data), PMS.CONFIG.MAX_TEXT_LENGTH),
      dataQualityFlags: 'SYSTEM_EVENT',
      pmsCompletion: eventType
    };
    writeRecord(sheet, record, 0);
    return true;
  }

  function pendingSyncPage(year, limit, afterRow) {
    var cursor = Number(afterRow) || 0;
    var pending = readRecordFields(['maintenanceYear', 'pmsCompletion']).filter(function (record) {
      if (Number(record.maintenanceYear) !== Number(year)) return false;
      var state = PMS.Util.completionState(record.pmsCompletion);
      return state === 'SYNC REQUIRED' || state === 'SYNC FAILED' || state === 'SYNCING';
    }).sort(function (a, b) {
      return pendingCursor(a) - pendingCursor(b);
    });
    var candidates = pending.filter(function (record) { return pendingCursor(record) > cursor; });
    var selected = candidates.slice(0, limit || 50);
    var records = selected.map(function (record) {
      return getByRow(sheetForStoredRecord(record), record._rowNumber);
    });
    return {
      records: records,
      totalPending: pending.length,
      nextCursor: selected.length ? pendingCursor(selected[selected.length - 1]) : cursor,
      remainingAfterCursor: Math.max(candidates.length - records.length, 0)
    };
  }

  function pendingCursor(record) {
    var sheetOffset = record._sheetName === PMS.CONFIG.INFRA_RESPONSE_SHEET ? 1000000000 : 0;
    return sheetOffset + Number(record._rowNumber || 0);
  }

  function pendingSync(year, limit, afterRow) {
    return pendingSyncPage(year, limit, afterRow).records;
  }

  function finalizeSync(record, syncResult) {
    var fresh = findByRecordId(record.recordId);
    if (!fresh) PMS.Util.fail('Pending record not found during reconciliation.', 'NOT_FOUND');
    var sheet = sheetForStoredRecord(fresh);
    fresh.updatedAt = PMS.Util.nowIso();
    fresh.trackerSheet = syncResult.sheetName || fresh.trackerSheet;
    fresh.trackerRow = syncResult.row || fresh.trackerRow;
    fresh.trackerYear = syncResult.trackerYear || fresh.trackerYear;
    if (fresh.recordType === 'LEGACY_SEED') {
      if (!hasDataQualityFlag(fresh, 'TRACKER_PRIOR_STATE_CAPTURED') && syncResult.previousCheckbox !== undefined) {
        fresh.previousTrackerCheckbox = syncResult.previousCheckbox;
        fresh.previousTrackerRemarks = syncResult.previousRemarks;
        addDataQualityFlag(fresh, 'TRACKER_PRIOR_STATE_CAPTURED');
      }
    } else {
      if ((fresh.previousTrackerCheckbox === '' || fresh.previousTrackerCheckbox === undefined) && syncResult.previousCheckbox !== undefined) {
        fresh.previousTrackerCheckbox = syncResult.previousCheckbox;
      }
      if (!fresh.previousTrackerRemarks && syncResult.previousRemarks !== undefined) {
        fresh.previousTrackerRemarks = syncResult.previousRemarks;
      }
    }
    fresh.trackerSyncedAt = syncResult.syncedAt || '';
    fresh.syncError = syncResult.error || '';
    var historical = syncResult.status === 'HISTORICAL_COMPLETED';
    var state = syncResult.status === 'COMPLETED' || historical ? 'COMPLETED' : syncResult.status === 'SYNC_REQUIRED' ? 'SYNC REQUIRED' : 'SYNC FAILED';
    if (historical && String(fresh.dataQualityFlags || '').indexOf('HISTORICAL_NO_TRACKER_WRITE') < 0) {
      fresh.dataQualityFlags = [fresh.dataQualityFlags, 'HISTORICAL_NO_TRACKER_WRITE'].filter(Boolean).join(' | ');
    }
    fresh.pmsCompletion = PMS.Util.progressText(100, Number(fresh.completedItems) || 0, Number(fresh.applicableItems) || 0, state);
    if (state === 'COMPLETED') fresh.submittedAt = fresh.submittedAt || fresh.updatedAt;
    writeRecord(sheet, fresh, fresh._rowNumber);
    return fresh;
  }

  function stageSync(record, prepared) {
    var fresh = findByRecordId(record.recordId);
    if (!fresh) PMS.Util.fail('Pending record not found before tracker synchronization.', 'NOT_FOUND');
    var sheet = sheetForStoredRecord(fresh);
    fresh.updatedAt = PMS.Util.nowIso();
    fresh.trackerSheet = prepared.sheetName || fresh.trackerSheet;
    fresh.trackerRow = prepared.row || fresh.trackerRow;
    fresh.trackerYear = prepared.trackerYear || fresh.trackerYear;
    if (fresh.recordType === 'LEGACY_SEED') {
      if (!hasDataQualityFlag(fresh, 'TRACKER_PRIOR_STATE_CAPTURED')) {
        fresh.previousTrackerCheckbox = prepared.previousCheckbox;
        fresh.previousTrackerRemarks = prepared.previousRemarks;
        addDataQualityFlag(fresh, 'TRACKER_PRIOR_STATE_CAPTURED');
      }
    } else {
      if (fresh.previousTrackerCheckbox === '' || fresh.previousTrackerCheckbox === undefined) {
        fresh.previousTrackerCheckbox = prepared.previousCheckbox;
      }
      if (!fresh.previousTrackerRemarks) fresh.previousTrackerRemarks = prepared.previousRemarks;
    }
    fresh.syncError = '';
    fresh.pmsCompletion = PMS.Util.progressText(100, Number(fresh.completedItems) || 0, Number(fresh.applicableItems) || 0, 'SYNCING');
    writeRecord(sheet, fresh, fresh._rowNumber);
    SpreadsheetApp.flush();
    return fresh;
  }

  return {
    responseSheet: responseSheet,
    allRecords: allRecords,
    readRecordFields: readRecordFields,
    dashboardRecords: dashboardRecords,
    findByRecordId: findByRecordId,
    findByIdempotencyKey: findByIdempotencyKey,
    save: save,
    clientRecord: clientRecord,
    attachEvidence: attachEvidence,
    recent: recent,
    completedList: completedList,
    completionKey: completionKey,
    legacySeedRecordId: legacySeedRecordId,
    completionKeys: completionKeys,
    appendLegacyRecord: appendLegacyRecord,
    appendLegacyRecordsBatch: appendLegacyRecordsBatch,
    stageLegacySeedBatch: stageLegacySeedBatch,
    stageLegacySeedTrackerState: stageLegacySeedTrackerState,
    finalizeLegacySeedBatch: finalizeLegacySeedBatch,
    ensureTrackerBaseline: ensureTrackerBaseline,
    appendSystemEvent: appendSystemEvent,
    pendingSync: pendingSync,
    pendingSyncPage: pendingSyncPage,
    stageSync: stageSync,
    finalizeSync: finalizeSync,
    isMaintenanceRecord: isMaintenanceRecord
  };
})();
