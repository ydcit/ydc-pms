var PMS = PMS || {};

PMS.Records = (function () {
  function responseSheet(createIfMissing) {
    var spreadsheet = PMS.Assets.spreadsheet();
    var sheet = spreadsheet.getSheetByName(PMS.CONFIG.RESPONSE_SHEET);
    if (!sheet && createIfMissing) {
      sheet = spreadsheet.insertSheet(PMS.CONFIG.RESPONSE_SHEET);
      initializeSheet(sheet);
    }
    if (sheet) verifyHeaders(sheet);
    return sheet;
  }

  function initializeSheet(sheet) {
    var columnCount = PMS.CONFIG.RECORD_COLUMNS.length;
    if (sheet.getMaxColumns() < columnCount) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), columnCount - sheet.getMaxColumns());
    }
    var labels = PMS.CONFIG.RECORD_COLUMNS.map(function (column) { return column.label; });
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
    sheet.setColumnWidth(1, 190);
    sheet.setColumnWidth(8, 180);
    sheet.setColumnWidth(9, 220);
    sheet.setColumnWidth(18, 155);
    sheet.setColumnWidths(54, 3, 320);
    sheet.setColumnWidth(columnCount, 265);
    if (!sheet.getFilter()) {
      sheet.getRange(1, 1, sheet.getMaxRows(), columnCount).createFilter();
    }
    var statusRange = sheet.getRange(2, columnCount, Math.max(1, sheet.getMaxRows() - 1), 1);
    var rules = [
      SpreadsheetApp.newConditionalFormatRule().whenTextContains('— COMPLETED').setBackground('#e6f4ea').setFontColor('#137333').setRanges([statusRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextContains('— INCOMPLETE').setBackground('#fef7e0').setFontColor('#b06000').setRanges([statusRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextContains('SYNC').setBackground('#fce8e6').setFontColor('#b3261e').setRanges([statusRange]).build()
    ];
    sheet.setConditionalFormatRules(rules);
  }

  function verifyHeaders(sheet) {
    var expected = PMS.CONFIG.RECORD_COLUMNS.map(function (column) { return column.label; });
    if (sheet.getMaxColumns() < expected.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), expected.length - sheet.getMaxColumns());
    }
    var current = sheet.getRange(1, 1, 1, expected.length).getDisplayValues()[0];
    var isBlank = current.every(function (value) { return !value; });
    if (isBlank) {
      initializeSheet(sheet);
      return;
    }
    var mismatches = [];
    expected.forEach(function (label, index) {
      if (current[index] !== label) mismatches.push((index + 1) + ': ' + current[index] + ' ≠ ' + label);
    });
    if (mismatches.length) {
      PMS.Util.fail('PMS Records header mismatch. Refusing to write: ' + mismatches.slice(0, 5).join('; '), 'SCHEMA_MISMATCH');
    }
  }

  function columnIndex(key) {
    for (var i = 0; i < PMS.CONFIG.RECORD_COLUMNS.length; i += 1) {
      if (PMS.CONFIG.RECORD_COLUMNS[i].key === key) return i;
    }
    PMS.Util.fail('Unknown record column: ' + key, 'CONFIGURATION_ERROR');
  }

  function objectToRow(record) {
    return PMS.CONFIG.RECORD_COLUMNS.map(function (column) {
      var value = record[column.key];
      if (value === undefined || value === null) return '';
      if (typeof value === 'string' && /^[=+\-@]/.test(value)) return "'" + value;
      return value;
    });
  }

  function rowToObject(row, rowNumber) {
    var record = { _rowNumber: rowNumber };
    PMS.CONFIG.RECORD_COLUMNS.forEach(function (column, index) {
      record[column.key] = row[index] === undefined || row[index] === null ? '' : row[index];
    });
    return record;
  }

  function allRecords() {
    var sheet = responseSheet(false);
    if (!sheet || sheet.getLastRow() < 2) return [];
    var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, PMS.CONFIG.RECORD_COLUMNS.length).getValues();
    return values.map(function (row, index) { return rowToObject(row, index + 2); });
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
    var sheet = responseSheet(false);
    if (!sheet || sheet.getLastRow() < 2 || !fields.length) return [];
    var count = sheet.getLastRow() - 1;
    var offsets = fields.map(columnIndex);
    var clusters = columnClusters(offsets);
    var blocks = clusters.map(function (cluster) {
      return sheet.getRange(2, cluster.first + 1, count, cluster.last - cluster.first + 1).getValues();
    });

    var records = new Array(count);
    for (var rowIndex = 0; rowIndex < count; rowIndex += 1) {
      var record = { _rowNumber: rowIndex + 2 };
      for (var position = 0; position < fields.length; position += 1) {
        var offset = offsets[position];
        for (var blockIndex = 0; blockIndex < clusters.length; blockIndex += 1) {
          var cluster = clusters[blockIndex];
          if (offset < cluster.first || offset > cluster.last) continue;
          var value = blocks[blockIndex][rowIndex][offset - cluster.first];
          record[fields[position]] = value === undefined || value === null ? '' : value;
          break;
        }
      }
      records[rowIndex] = record;
    }
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

  function findRowByColumn(sheet, key, value) {
    if (!value || sheet.getLastRow() < 2) return 0;
    var column = columnIndex(key) + 1;
    var matches = sheet
      .getRange(2, column, sheet.getLastRow() - 1, 1)
      .createTextFinder(String(value))
      .matchEntireCell(true)
      .findAll();
    if (matches.length > 1) {
      PMS.Util.fail('Duplicate ' + key + ' values detected in PMS Records.', 'DATA_INTEGRITY_ERROR');
    }
    return matches.length ? matches[0].getRow() : 0;
  }

  function getByRow(sheet, rowNumber) {
    if (!rowNumber) return null;
    return rowToObject(
      sheet.getRange(rowNumber, 1, 1, PMS.CONFIG.RECORD_COLUMNS.length).getValues()[0],
      rowNumber
    );
  }

  function findByRecordId(recordId) {
    var sheet = responseSheet(false);
    if (!sheet) return null;
    return getByRow(sheet, findRowByColumn(sheet, 'recordId', recordId));
  }

  function findByIdempotencyKey(idempotencyKey) {
    var sheet = responseSheet(false);
    if (!sheet) return null;
    return getByRow(sheet, findRowByColumn(sheet, 'idempotencyKey', idempotencyKey));
  }

  function ensureRowCapacity(sheet, rowNumber) {
    if (rowNumber > sheet.getMaxRows()) {
      sheet.insertRowsAfter(sheet.getMaxRows(), rowNumber - sheet.getMaxRows());
    }
  }

  function writeRecord(sheet, record, rowNumber) {
    var targetRow = rowNumber || sheet.getLastRow() + 1;
    ensureRowCapacity(sheet, targetRow);
    sheet.getRange(targetRow, 1, 1, PMS.CONFIG.RECORD_COLUMNS.length).setValues([objectToRow(record)]);
    return targetRow;
  }

  function completionKey(sectionKey, assetTag, cycleId) {
    return [sectionKey, PMS.Util.normalizeAssetTag(assetTag), cycleId].join('|');
  }

  function isMaintenanceRecord(record) {
    return ['MAINTENANCE', 'REINSPECTION', 'LEGACY'].indexOf(String(record.recordType)) >= 0;
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

  function buildRecord(normalized, asset, existing) {
    var profile = normalized.profile;
    var timestamp = PMS.Util.nowIso();
    var priorCompletion = completedRecord(profile.section, asset.tag, normalized.cycle.cycleId, existing ? existing.recordId : '');
    var record = existing || {};
    record.recordId = record.recordId || PMS.Util.makeRecordId(normalized.cycle);
    record.recordType = priorCompletion ? 'REINSPECTION' : (record.recordType || 'MAINTENANCE');
    record.schemaVersion = PMS.CONFIG.SCHEMA_VERSION;
    record.createdAt = record.createdAt || timestamp;
    record.updatedAt = timestamp;
    record.submittedAt = record.submittedAt || '';
    record.idempotencyKey = record.idempotencyKey || normalized.idempotencyKey;
    record.technicianName = profile.name;
    record.technicianEmail = profile.email;
    record.itSection = profile.section;
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

    Object.keys(PMS.CONFIG.PERIPHERAL_RECORD_KEYS).forEach(function (key) {
      record[PMS.CONFIG.PERIPHERAL_RECORD_KEYS[key]] = PMS.Util.safeCellText(normalized.peripherals[key], 2000);
    });
    PMS.Util.allChecklistItems().forEach(function (item) {
      record[item.key] = normalized.checklist.values[item.key];
    });
    record.assessmentResult = PMS.Util.safeCellText(normalized.assessment.result, 100);
    record.assetFindings = PMS.Util.safeCellText(normalized.assessment.findings, PMS.CONFIG.MAX_TEXT_LENGTH);
    record.actionTaken = PMS.Util.safeCellText(normalized.assessment.actionTaken, PMS.CONFIG.MAX_TEXT_LENGTH);
    record.recommendation = PMS.Util.safeCellText(normalized.assessment.recommendation, PMS.CONFIG.MAX_TEXT_LENGTH);
    record.completedItems = normalized.checklist.completed;
    record.applicableItems = normalized.checklist.applicable;
    record.completionPercent = normalized.checklist.percent / 100;
    record.trackerSheet = record.trackerSheet || asset.sheetName;
    record.trackerRow = record.trackerRow || asset.row;
    record.trackerCycle = normalized.cycle.cycle;
    record.reinspectionOf = record.reinspectionOf || (priorCompletion ? priorCompletion.recordId : '');

    var flags = [];
    if (!asset.location) flags.push('MISSING_MASTER_LOCATION');
    if (normalized.locationDiscrepancy) flags.push('LOCATION_DISCREPANCY');
    record.dataQualityFlags = flags.join(' | ');
    return record;
  }

  function save(rawPayload, mode) {
    var profile = PMS.Auth.requireProfile();
    var normalized = PMS.Validation.payload(rawPayload, mode, profile);
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) PMS.Util.fail('The system is busy. Please try again.', 'BUSY');
    var result;
    try {
      var sheet = responseSheet(true);
      var existing = null;
      if (normalized.recordId) {
        existing = getByRow(sheet, findRowByColumn(sheet, 'recordId', normalized.recordId));
        if (!existing) PMS.Util.fail('The PMS draft was not found. Start a new questionnaire.', 'NOT_FOUND');
      }
      if (!existing) existing = getByRow(sheet, findRowByColumn(sheet, 'idempotencyKey', normalized.idempotencyKey));
      if (existing && existing.technicianEmail !== profile.email) {
        PMS.Util.fail('You cannot edit another technician’s record.', 'ACCESS_DENIED');
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

      var asset = PMS.Assets.requireEligible(profile.section, normalized.assetTag);
      PMS.Validation.validateObservedLocation(normalized, asset);
      if (existing && (existing.assetTag !== asset.tag || existing.cycleId !== normalized.cycle.cycleId)) {
        PMS.Util.fail('Asset and maintenance cycle cannot be changed after a draft is created.', 'VALIDATION_ERROR');
      }
      var record = buildRecord(normalized, asset, existing);
      var rowNumber = existing ? existing._rowNumber : 0;

      if (normalized.mode === 'SAVE') {
        record.syncError = '';
        record.pmsCompletion = PMS.Util.progressText(
          normalized.checklist.percent,
          normalized.checklist.completed,
          normalized.checklist.applicable,
          'INCOMPLETE'
        );
        rowNumber = writeRecord(sheet, record, rowNumber);
        result = {
          ok: true,
          recordId: record.recordId,
          pmsCompletion: record.pmsCompletion,
          syncStatus: 'INCOMPLETE',
          message: 'Progress saved. No PMS tracker checkbox was changed.'
        };
      } else {
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
          message: syncResult.status === 'COMPLETED'
            ? 'PMS completed and the ' + record.cycle + ' tracker was updated.'
            : syncResult.status === 'HISTORICAL_COMPLETED'
              ? 'Historical PMS completed in PMS Records. No current-year tracker cell was changed.'
              : syncResult.status === 'SYNC_REQUIRED'
                ? 'PMS is 100% complete but awaits the correct tracker year rollover.'
                : 'The record was saved, but tracker synchronization failed. An administrator can retry it.'
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
    return result;
  }

  function clientRecord(recordId) {
    var profile = PMS.Auth.requireProfile();
    var record = findByRecordId(recordId);
    if (!record) PMS.Util.fail('PMS record was not found.', 'NOT_FOUND');
    if (record.technicianEmail !== profile.email) {
      PMS.Util.fail('You cannot open another technician’s record.', 'ACCESS_DENIED');
    }
    var peripherals = {};
    Object.keys(PMS.CONFIG.PERIPHERAL_RECORD_KEYS).forEach(function (key) {
      var value = String(record[PMS.CONFIG.PERIPHERAL_RECORD_KEYS[key]] || '');
      peripherals[key] = value ? value.split(' | ') : [];
    });
    var checklist = {};
    PMS.Util.allChecklistItems().forEach(function (item) { checklist[item.key] = record[item.key] || ''; });
    return {
      ok: true,
      recordId: record.recordId,
      idempotencyKey: record.idempotencyKey,
      maintenanceDate: record.maintenanceDate,
      assetTag: record.assetTag,
      observedLocation: record.observedLocation,
      locationDiscrepancy: record.locationDiscrepancy === 'YES',
      peripherals: peripherals,
      checklist: checklist,
      assessment: {
        result: record.assessmentResult,
        findings: record.assetFindings,
        actionTaken: record.actionTaken,
        recommendation: record.recommendation
      },
      pmsCompletion: record.pmsCompletion
    };
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
      return factor * (a.row - b.row);
    };
  }

  /**
   * Completed maintenance visible to the caller.
   *
   * An administrator sees every section; a technician sees only their own
   * records in their registered section. The scope is enforced here from the
   * server-resolved context, never from a browser-supplied value.
   */
  function completedList(context, options) {
    var request = options && typeof options === 'object' ? options : {};
    var isAdmin = Boolean(context.isAdmin);
    var viewerEmail = PMS.Util.normalizeEmail(context.email);

    var scoped = readRecordFields(COMPLETED_FIELDS)
      .filter(function (record) {
        if (!isMaintenanceRecord(record)) return false;
        if (PMS.Util.completionState(cellText(record.pmsCompletion)) !== 'COMPLETED') return false;
        if (isAdmin) return true;
        return PMS.Util.normalizeEmail(cellText(record.technicianEmail)) === viewerEmail &&
          cellText(record.itSection) === context.section;
      })
      .map(function (record) {
        var parts = cycleParts(record.cycleId);
        var master = cellText(record.masterLocation);
        var observed = cellText(record.observedLocation);
        return {
          recordId: cellText(record.recordId),
          assetTag: PMS.Util.normalizeAssetTag(record.assetTag),
          maintenanceDate: cellText(record.maintenanceDate),
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
      if (record.assetTag) uniqueAssets[record.assetTag] = true;
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

    return {
      ok: true,
      scope: isAdmin ? 'ALL_SECTIONS' : 'OWN_RECORDS',
      rows: filtered.slice(start, start + pageSize),
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
      return bTime.localeCompare(aTime) || b._rowNumber - a._rowNumber;
    });
    var output = [];
    for (var i = 0; i < records.length && output.length < (limit || 10); i += 1) {
      var record = records[i];
      if (!isMaintenanceRecord(record)) continue;
      if (!profile.isAdmin && record.technicianEmail !== profile.email) continue;
      if (!profile.isAdmin && record.itSection !== profile.section) continue;
      output.push({
        recordId: record.recordId,
        maintenanceDate: record.maintenanceDate,
        cycleId: record.cycleId,
        assetTag: record.assetTag,
        technicianName: record.technicianName,
        assessmentResult: record.assessmentResult,
        pmsCompletion: record.pmsCompletion,
        editable: PMS.Util.completionState(record.pmsCompletion) !== 'COMPLETED'
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

  function appendLegacyRecordsBatch(dataList, existingById) {
    var items = Array.isArray(dataList) ? dataList : [];
    if (!items.length) return { appended: 0, appendedBySection: {} };
    var sheet = responseSheet(true);
    var recordsById = existingById || {};
    if (!existingById) {
      readRecordFields(['recordId', 'recordType', 'itSection', 'cycleId']).forEach(function (record) {
        recordsById[record.recordId] = record;
      });
    }
    var timestamp = PMS.Util.nowIso();
    var rows = [];
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
      rows.push(objectToRow(record));
      appendedBySection[data.section] = (appendedBySection[data.section] || 0) + 1;
    });
    if (rows.length) {
      var firstRow = sheet.getLastRow() + 1;
      ensureRowCapacity(sheet, firstRow + rows.length - 1);
      sheet.getRange(firstRow, 1, rows.length, PMS.CONFIG.RECORD_COLUMNS.length).setValues(rows);
    }
    return { appended: rows.length, appendedBySection: appendedBySection };
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
      return a._rowNumber - b._rowNumber;
    });
    var candidates = pending.filter(function (record) { return record._rowNumber > cursor; });
    var selected = candidates.slice(0, limit || 50);
    var sheet = responseSheet(false);
    var records = selected.map(function (record) { return getByRow(sheet, record._rowNumber); });
    return {
      records: records,
      totalPending: pending.length,
      nextCursor: selected.length ? selected[selected.length - 1]._rowNumber : cursor,
      remainingAfterCursor: Math.max(candidates.length - records.length, 0)
    };
  }

  function pendingSync(year, limit, afterRow) {
    return pendingSyncPage(year, limit, afterRow).records;
  }

  function finalizeSync(record, syncResult) {
    var sheet = responseSheet(true);
    var fresh = findByRecordId(record.recordId);
    if (!fresh) PMS.Util.fail('Pending record not found during reconciliation.', 'NOT_FOUND');
    fresh.updatedAt = PMS.Util.nowIso();
    fresh.trackerSheet = syncResult.sheetName || fresh.trackerSheet;
    fresh.trackerRow = syncResult.row || fresh.trackerRow;
    fresh.trackerYear = syncResult.trackerYear || fresh.trackerYear;
    if ((fresh.previousTrackerCheckbox === '' || fresh.previousTrackerCheckbox === undefined) && syncResult.previousCheckbox !== undefined) {
      fresh.previousTrackerCheckbox = syncResult.previousCheckbox;
    }
    if (!fresh.previousTrackerRemarks && syncResult.previousRemarks !== undefined) {
      fresh.previousTrackerRemarks = syncResult.previousRemarks;
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
    var sheet = responseSheet(true);
    var fresh = findByRecordId(record.recordId);
    if (!fresh) PMS.Util.fail('Pending record not found before tracker synchronization.', 'NOT_FOUND');
    fresh.updatedAt = PMS.Util.nowIso();
    fresh.trackerSheet = prepared.sheetName || fresh.trackerSheet;
    fresh.trackerRow = prepared.row || fresh.trackerRow;
    fresh.trackerYear = prepared.trackerYear || fresh.trackerYear;
    if (fresh.previousTrackerCheckbox === '' || fresh.previousTrackerCheckbox === undefined) {
      fresh.previousTrackerCheckbox = prepared.previousCheckbox;
    }
    if (!fresh.previousTrackerRemarks) fresh.previousTrackerRemarks = prepared.previousRemarks;
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
    save: save,
    clientRecord: clientRecord,
    recent: recent,
    completedList: completedList,
    completionKey: completionKey,
    completionKeys: completionKeys,
    appendLegacyRecord: appendLegacyRecord,
    appendLegacyRecordsBatch: appendLegacyRecordsBatch,
    ensureTrackerBaseline: ensureTrackerBaseline,
    appendSystemEvent: appendSystemEvent,
    pendingSync: pendingSync,
    pendingSyncPage: pendingSyncPage,
    stageSync: stageSync,
    finalizeSync: finalizeSync,
    isMaintenanceRecord: isMaintenanceRecord
  };
})();
