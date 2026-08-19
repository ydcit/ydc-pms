var PMS = PMS || {};

PMS.LegacyImport = (function () {
  var CACHE_PREFIX = 'PMS_LEGACY_IMPORT_';
  var CACHE_STATE_SUFFIX = '_STATE';
  var CACHE_ID_CHUNK_SIZE = 200;

  function splitAssetTags(value) {
    var values = Array.isArray(value) ? value : [value];
    var output = [];
    values.forEach(function (item) {
      String(item === null || item === undefined ? '' : item)
        .split(/[\r\n,;|]+/)
        .forEach(function (part) {
          var tag = PMS.Util.normalizeAssetTag(part);
          if (tag) output.push(tag);
        });
    });
    return output;
  }

  function normalizeRequest(request) {
    var source = request && typeof request === 'object' ? request : {};
    var section = PMS.Util.section(PMS.Util.cleanText(source.section, 40).toUpperCase());
    var date = PMS.Util.parseDateInput(source.maintenanceDate);
    var cycle = PMS.Util.deriveCycle(date);
    var maintenanceDate = Utilities.formatDate(date, PMS.CONFIG.TIME_ZONE, 'yyyy-MM-dd');
    var submittedTags = splitAssetTags(source.assetTags);
    if (!submittedTags.length) {
      PMS.Util.fail('Enter at least one asset tag to import.', 'VALIDATION_ERROR');
    }
    var seen = {};
    var uniqueTags = [];
    var duplicates = [];
    submittedTags.forEach(function (tag) {
      if (seen[tag]) {
        duplicates.push(tag);
        return;
      }
      seen[tag] = true;
      uniqueTags.push(tag);
    });
    if (uniqueTags.length > PMS.CONFIG.LEGACY_IMPORT_MAX_TAGS) {
      PMS.Util.fail(
        'A legacy import can contain at most ' + PMS.CONFIG.LEGACY_IMPORT_MAX_TAGS + ' unique asset tags.',
        'VALIDATION_ERROR'
      );
    }
    var sourceNote = PMS.Util.cleanText(source.sourceNote, PMS.CONFIG.MAX_TEXT_LENGTH);
    var canonical = {
      section: section.key,
      maintenanceDate: maintenanceDate,
      assetTags: uniqueTags.slice().sort(),
      sourceNote: sourceNote
    };
    return {
      section: section,
      maintenanceDate: maintenanceDate,
      cycle: cycle,
      submittedTags: submittedTags,
      uniqueTags: uniqueTags,
      duplicates: duplicates,
      sourceNote: sourceNote,
      requestDigest: PMS.Util.hashText(JSON.stringify(canonical))
    };
  }

  function recordProjection() {
    return [
      'recordId', 'recordType', 'itSection', 'assetTag', 'cycleId',
      'maintenanceDate', 'technicianEmail', 'pmsCompletion', 'dataQualityFlags'
    ];
  }

  /**
   * Legacy import is open to any registered technician, not administrators
   * only, but scoped down from what an administrator can do:
   *
   *   - a technician may import only into their own registered section —
   *     they cannot backfill work for a section they don't belong to;
   *   - a technician may import only into the currently open tracker year —
   *     the "historical" mode that rewrites a past, already-closed year
   *     without touching the live tracker stays administrator-only, since it
   *     can silently create completed history for a year nobody is actively
   *     working in.
   *
   * An administrator is unrestricted, exactly as before.
   */
  function requireImportAuthorization(actor, sectionKey, historical) {
    if (actor.isAdmin) return;
    if (sectionKey !== actor.section) {
      PMS.Util.fail('You can import legacy PMS only for your own registered IT section.', 'ACCESS_DENIED');
    }
    if (historical) {
      PMS.Util.fail(
        'Only an administrator can import legacy PMS for a year other than the current open tracker year.',
        'ACCESS_DENIED'
      );
    }
  }

  function assertImportWindowOpen() {
    var rollover = PropertiesService.getScriptProperties().getProperty(PMS.CONFIG.ROLLOVER_STATE_PROPERTY);
    if (rollover) {
      PMS.Util.fail(
        'A PMS year rollover is in progress. Finish or recover the rollover before importing legacy records.',
        'ROLLOVER_BLOCKED'
      );
    }
    var years = Object.keys(PMS.CONFIG.SECTIONS).map(function (sectionKey) {
      var sheet = PMS.Assets.sheetForSection(sectionKey);
      return Number(
        sheet.getRange(PMS.CONFIG.TRACKER_YEAR_ROW, PMS.CONFIG.TRACKER_YEAR_COLUMN).getValue()
      );
    });
    if (!years.length || !years[0] || !years.every(function (year) { return year === years[0]; })) {
      PMS.Util.fail(
        'The two PMS tracker sheets must have the same valid open year before a legacy import.',
        'ROLLOVER_BLOCKED'
      );
    }
    return years[0];
  }

  function buildPlan(normalized, suppliedRecords) {
    var sectionKey = normalized.section.key;
    var sheet = PMS.Assets.sheetForSection(sectionKey);
    var trackerYear = Number(
      sheet.getRange(PMS.CONFIG.TRACKER_YEAR_ROW, PMS.CONFIG.TRACKER_YEAR_COLUMN).getValue()
    );
    if (!trackerYear) {
      PMS.Util.fail(sheet.getName() + ' is missing its tracker year in D2.', 'CONFIGURATION_ERROR');
    }
    if (Number(normalized.cycle.year) > trackerYear) {
      PMS.Util.fail(
        'The maintenance year ' + normalized.cycle.year +
          ' is ahead of the open ' + trackerYear + ' tracker. Open that PMS year before importing it.',
        'TRACKER_YEAR_MISMATCH'
      );
    }
    var historical = Number(normalized.cycle.year) < trackerYear;
    var trackerMode = historical ? 'HISTORICAL_RECORD_ONLY' : 'CURRENT_TRACKER';

    var assetsByTag = {};
    PMS.Assets.readAll(sectionKey).forEach(function (asset) {
      if (!assetsByTag[asset.tag]) assetsByTag[asset.tag] = [];
      assetsByTag[asset.tag].push(asset);
    });

    var records = Array.isArray(suppliedRecords)
      ? suppliedRecords
      : PMS.Records.readRecordFields(recordProjection());
    var recordsById = {};
    var recordsByNaturalKey = {};
    records.forEach(function (record) {
      if (record.recordId) {
        if (recordsById[record.recordId]) {
          PMS.Util.fail('Duplicate record identifiers exist in PMS Records.', 'DATA_INTEGRITY_ERROR');
        }
        recordsById[record.recordId] = record;
      }
      if (!PMS.Records.isMaintenanceRecord(record) || !record.itSection || !record.assetTag || !record.cycleId) return;
      var key = PMS.Records.completionKey(record.itSection, record.assetTag, record.cycleId);
      if (!recordsByNaturalKey[key]) recordsByNaturalKey[key] = [];
      recordsByNaturalKey[key].push(record);
    });

    var requestedNaturalById = {};
    var rows = normalized.uniqueTags.map(function (tag) {
      var recordId = PMS.Records.legacySeedRecordId(sectionKey, tag, normalized.cycle.cycleId);
      var naturalKey = PMS.Records.completionKey(sectionKey, tag, normalized.cycle.cycleId);
      if (requestedNaturalById[recordId] && requestedNaturalById[recordId] !== naturalKey) {
        PMS.Util.fail(
          'Two requested assets produced the same deterministic legacy import identifier.',
          'DATA_INTEGRITY_ERROR'
        );
      }
      requestedNaturalById[recordId] = naturalKey;
      var idRecord = recordsById[recordId];
      if (idRecord && (String(idRecord.recordType) !== 'LEGACY_SEED' ||
          PMS.Records.completionKey(idRecord.itSection, idRecord.assetTag, idRecord.cycleId) !== naturalKey)) {
        PMS.Util.fail(
          'The deterministic legacy import identifier for ' + tag + ' is already used by another record.',
          'DATA_INTEGRITY_ERROR'
        );
      }
      if (idRecord && (String(idRecord.dataQualityFlags || '').split('|').map(function (item) {
        return item.trim();
      }).indexOf('ADMIN_BULK_SEED') < 0 || PMS.Util.normalizeEmail(idRecord.technicianEmail))) {
        PMS.Util.fail(
          'The reserved legacy import record for ' + tag + ' is not a valid server-created seed row.',
          'DATA_INTEGRITY_ERROR'
        );
      }

      var matches = assetsByTag[tag] || [];
      if (matches.length !== 1) {
        return {
          assetTag: tag,
          classification: 'INVALID',
          ready: false,
          recordId: recordId,
          sourceRow: 0,
          assetStatus: '',
          location: '',
          message: matches.length
            ? 'Asset tag is duplicated in ' + sheet.getName() + '.'
            : 'Asset tag was not found in ' + sheet.getName() + '.',
          warnings: [],
          _asset: null,
          _existing: null
        };
      }
      var asset = matches[0];
      var warnings = [];
      if (!historical && asset.status !== 'INPROD') {
        return {
          assetTag: tag,
          classification: 'INVALID',
          ready: false,
          recordId: recordId,
          sourceRow: asset.row,
          assetStatus: asset.status,
          location: asset.location,
          message: 'Current-year tracker projection requires an INPROD asset.',
          warnings: [],
          _asset: asset,
          _existing: null
        };
      }
      if (historical && asset.status !== 'INPROD') {
        warnings.push('Asset is currently ' + (asset.status || 'without a status') +
          '; the historical completion will not change the current tracker.');
      }

      var keyRecords = recordsByNaturalKey[naturalKey] || [];
      var completed = keyRecords.filter(function (record) {
        return PMS.Util.completionState(record.pmsCompletion) === 'COMPLETED';
      });
      if (completed.length) {
        return {
          assetTag: tag,
          classification: 'ALREADY_COMPLETED',
          ready: false,
          recordId: completed[completed.length - 1].recordId,
          sourceRow: asset.row,
          assetStatus: asset.status,
          location: asset.location,
          message: 'This asset already has a completed record for ' + normalized.cycle.cycleId + '.',
          warnings: warnings,
          _asset: asset,
          _existing: completed[completed.length - 1]
        };
      }

      var conflicts = keyRecords.filter(function (record) {
        return record.recordId !== recordId && PMS.Util.completionState(record.pmsCompletion) !== 'COMPLETED';
      });
      if (conflicts.length) {
        return {
          assetTag: tag,
          classification: 'INVALID',
          ready: false,
          recordId: recordId,
          sourceRow: asset.row,
          assetStatus: asset.status,
          location: asset.location,
          message: 'An incomplete non-import record already exists for this asset and cycle.',
          warnings: warnings,
          _asset: asset,
          _existing: null
        };
      }

      if (idRecord && maintenanceDateText(idRecord.maintenanceDate) !== normalized.maintenanceDate) {
        return {
          assetTag: tag,
          classification: 'INVALID',
          ready: false,
          recordId: recordId,
          sourceRow: asset.row,
          assetStatus: asset.status,
          location: asset.location,
          message: 'A resumable legacy import exists with a different maintenance date.',
          warnings: warnings,
          _asset: asset,
          _existing: idRecord
        };
      }
      return {
        assetTag: tag,
        classification: idRecord ? 'RESUMABLE' : 'READY',
        ready: true,
        recordId: recordId,
        sourceRow: asset.row,
        assetStatus: asset.status,
        location: asset.location,
        message: idRecord
          ? 'A previously staged legacy import will be resumed.'
          : historical
            ? 'Ready for historical record-only import.'
            : 'Ready for record creation and current tracker synchronization.',
        warnings: warnings,
        _asset: asset,
        _existing: idRecord || null
      };
    });

    rows.forEach(function (row) {
      row._seedRecordId = PMS.Records.legacySeedRecordId(
        sectionKey,
        row.assetTag,
        normalized.cycle.cycleId
      );
    });
    normalized.duplicates.forEach(function (tag) {
      rows.push({
        assetTag: tag,
        classification: 'DUPLICATE_INPUT',
        ready: false,
        recordId: '',
        sourceRow: 0,
        assetStatus: '',
        location: '',
        message: 'Duplicate input was collapsed into the first occurrence.',
        warnings: []
      });
    });
    return {
      trackerYear: trackerYear,
      trackerMode: trackerMode,
      historical: historical,
      rows: rows,
      recordsById: recordsById
    };
  }

  function maintenanceDateText(value) {
    if (Object.prototype.toString.call(value) === '[object Date]') {
      return Utilities.formatDate(value, PMS.CONFIG.TIME_ZONE, 'yyyy-MM-dd');
    }
    return String(value || '').slice(0, 10);
  }

  function publicRow(row) {
    return {
      assetTag: row.assetTag,
      classification: row.classification,
      ready: row.ready,
      recordId: row.recordId,
      sourceRow: row.sourceRow,
      assetStatus: row.assetStatus,
      location: row.location,
      message: row.message,
      warnings: row.warnings || []
    };
  }

  function planCounts(normalized, rows) {
    return {
      submitted: normalized.submittedTags.length,
      unique: normalized.uniqueTags.length,
      ready: rows.filter(function (row) { return row.ready; }).length,
      newRecords: rows.filter(function (row) { return row.classification === 'READY'; }).length,
      resumable: rows.filter(function (row) { return row.classification === 'RESUMABLE'; }).length,
      duplicates: rows.filter(function (row) { return row.classification === 'DUPLICATE_INPUT'; }).length,
      alreadyCompleted: rows.filter(function (row) { return row.classification === 'ALREADY_COMPLETED'; }).length,
      invalid: rows.filter(function (row) { return row.classification === 'INVALID'; }).length,
      warnings: rows.filter(function (row) { return (row.warnings || []).length > 0; }).length
    };
  }

  function cacheBase(token) {
    return CACHE_PREFIX + PMS.Util.hashText(token).slice(0, 32);
  }

  function readState(token) {
    var cleanToken = PMS.Util.cleanText(token, 100);
    if (!/^[0-9a-f-]{36}$/i.test(cleanToken)) {
      PMS.Util.fail('Legacy import confirmation is invalid.', 'IMPORT_TOKEN_INVALID');
    }
    var cache = CacheService.getScriptCache();
    var base = cacheBase(cleanToken);
    var raw = cache.get(base + CACHE_STATE_SUFFIX);
    if (!raw) PMS.Util.fail('Legacy import confirmation expired. Preview the import again.', 'IMPORT_TOKEN_EXPIRED');
    var manifest;
    try {
      manifest = JSON.parse(raw);
    } catch (error) {
      PMS.Util.fail('Legacy import confirmation is corrupt. Preview the import again.', 'IMPORT_TOKEN_INVALID');
    }
    if (manifest.tokenHash !== PMS.Util.hashText(cleanToken) || Number(manifest.expiresAt) < Date.now()) {
      PMS.Util.fail('Legacy import confirmation expired. Preview the import again.', 'IMPORT_TOKEN_EXPIRED');
    }
    var chunkValues = cache.getAll(manifest.chunkKeys || []);
    var remainingIds = [];
    (manifest.chunkKeys || []).forEach(function (key) {
      if (!chunkValues[key]) PMS.Util.fail('Legacy import confirmation expired. Preview the import again.', 'IMPORT_TOKEN_EXPIRED');
      try {
        remainingIds = remainingIds.concat(JSON.parse(chunkValues[key]));
      } catch (error) {
        PMS.Util.fail('Legacy import confirmation is corrupt. Preview the import again.', 'IMPORT_TOKEN_INVALID');
      }
    });
    manifest.remainingIds = remainingIds;
    manifest.token = cleanToken;
    return manifest;
  }

  function writeState(state) {
    var cache = CacheService.getScriptCache();
    var base = cacheBase(state.token);
    var stateKey = base + CACHE_STATE_SUFFIX;
    var oldRaw = cache.get(stateKey);
    var oldKeys = [];
    if (oldRaw) {
      try { oldKeys = JSON.parse(oldRaw).chunkKeys || []; } catch (ignore) { oldKeys = []; }
    }
    var generation = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
    var chunks = [];
    for (var index = 0; index < state.remainingIds.length; index += CACHE_ID_CHUNK_SIZE) {
      chunks.push(state.remainingIds.slice(index, index + CACHE_ID_CHUNK_SIZE));
    }
    var values = {};
    var chunkKeys = chunks.map(function (chunk, index) {
      var key = base + '_' + generation + '_' + index;
      values[key] = JSON.stringify(chunk);
      return key;
    });
    if (chunkKeys.length) cache.putAll(values, PMS.CONFIG.LEGACY_IMPORT_TOKEN_SECONDS);
    var manifest = {
      version: 1,
      tokenHash: PMS.Util.hashText(state.token),
      batchId: state.batchId,
      adminEmail: state.adminEmail,
      requestDigest: state.requestDigest,
      createdAt: state.createdAt,
      expiresAt: state.expiresAt,
      totalReady: state.totalReady,
      section: state.section,
      cycleId: state.cycleId,
      trackerYear: state.trackerYear,
      trackerMode: state.trackerMode,
      started: Boolean(state.started),
      totals: state.totals || { processed: 0, imported: 0, resumed: 0, completed: 0, skipped: 0, failed: 0 },
      chunkKeys: chunkKeys
    };
    cache.put(stateKey, JSON.stringify(manifest), PMS.CONFIG.LEGACY_IMPORT_TOKEN_SECONDS);
    var staleKeys = oldKeys.filter(function (key) { return chunkKeys.indexOf(key) < 0; });
    if (staleKeys.length) cache.removeAll(staleKeys);
  }

  function deleteState(state) {
    var cache = CacheService.getScriptCache();
    var keys = (state.chunkKeys || []).concat([cacheBase(state.token) + CACHE_STATE_SUFFIX]);
    cache.removeAll(keys);
  }

  function preview(request) {
    var actor = PMS.Auth.requireProfile();
    var openYear = assertImportWindowOpen();
    var normalized = normalizeRequest(request);
    var plan = buildPlan(normalized);
    requireImportAuthorization(actor, normalized.section.key, plan.historical);
    var confirmedOpenYear = assertImportWindowOpen();
    if (openYear !== confirmedOpenYear || Number(plan.trackerYear) !== confirmedOpenYear) {
      PMS.Util.fail('The tracker year changed while preparing the preview. Preview it again.', 'IMPORT_PREVIEW_STALE');
    }
    var counts = planCounts(normalized, plan.rows);
    var token = '';
    var batchId = '';
    var expiresAt = 0;
    if (counts.ready > 0) {
      token = Utilities.getUuid();
      batchId = [
        'LEGACY-IMPORT', normalized.cycle.year, normalized.cycle.cycle,
        Utilities.getUuid().replace(/-/g, '').slice(0, 16).toUpperCase()
      ].join('-');
      expiresAt = Date.now() + PMS.CONFIG.LEGACY_IMPORT_TOKEN_SECONDS * 1000;
      writeState({
        token: token,
        batchId: batchId,
        adminEmail: actor.email,
        requestDigest: normalized.requestDigest,
        createdAt: PMS.Util.nowIso(),
        expiresAt: expiresAt,
        totalReady: counts.ready,
        section: normalized.section.key,
        cycleId: normalized.cycle.cycleId,
        trackerYear: plan.trackerYear,
        trackerMode: plan.trackerMode,
        remainingIds: plan.rows.filter(function (row) { return row.ready; }).map(function (row) { return row.recordId; }),
        started: false,
        totals: { processed: 0, imported: 0, resumed: 0, completed: 0, skipped: 0, failed: 0 }
      });
    }
    return {
      ok: true,
      batchId: batchId,
      section: normalized.section.key,
      sectionLabel: normalized.section.label,
      maintenanceDate: normalized.maintenanceDate,
      maintenanceYear: normalized.cycle.year,
      cycle: normalized.cycle.cycle,
      cycleId: normalized.cycle.cycleId,
      trackerYear: plan.trackerYear,
      trackerMode: plan.trackerMode,
      sourceNote: normalized.sourceNote,
      confirmationToken: token,
      confirmationPhrase: 'IMPORT ' + counts.ready,
      expiresInSeconds: token ? PMS.CONFIG.LEGACY_IMPORT_TOKEN_SECONDS : 0,
      hasReady: counts.ready > 0,
      counts: counts,
      rows: plan.rows.map(publicRow)
    };
  }

  function bestEffortEvent(recordId, eventType, data) {
    try {
      PMS.Records.appendSystemEvent(recordId, eventType, data);
    } catch (error) {
      console.warn('Legacy import audit event could not be written: ' + error.message);
    }
  }

  function assertState(state, normalized, actor) {
    if (PMS.Util.normalizeEmail(state.adminEmail) !== actor.email) {
      PMS.Util.fail('This legacy import confirmation belongs to another user.', 'ACCESS_DENIED');
    }
    if (state.requestDigest !== normalized.requestDigest) {
      PMS.Util.fail('The legacy import input changed after preview. Preview it again.', 'IMPORT_PREVIEW_STALE');
    }
  }

  function execute(request, confirmationToken) {
    var actor = PMS.Auth.requireProfile();
    var normalized = normalizeRequest(request);
    var state = readState(confirmationToken);
    assertState(state, normalized, actor);
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      PMS.Util.fail('Another maintenance operation is running. Try the import again shortly.', 'BUSY');
    }
    var response;
    try {
      // Re-read the token and every authoritative sheet value after acquiring
      // the mutation lock. A concurrent completion may legitimately turn a
      // planned item into an idempotent skip.
      assertImportWindowOpen();
      state = readState(confirmationToken);
      assertState(state, normalized, actor);
      var allRecords = PMS.Records.allRecords();
      var plan = buildPlan(normalized, allRecords);
      requireImportAuthorization(actor, normalized.section.key, plan.historical);
      if (state.section !== normalized.section.key || state.cycleId !== normalized.cycle.cycleId ||
          Number(state.trackerYear) !== Number(plan.trackerYear) || state.trackerMode !== plan.trackerMode) {
        PMS.Util.fail(
          'The tracker year or import mode changed after preview. Preview the import again.',
          'IMPORT_PREVIEW_STALE'
        );
      }
      var rowsById = {};
      plan.rows.forEach(function (row) {
        var seedRecordId = row._seedRecordId || row.recordId;
        if (seedRecordId && !rowsById[seedRecordId]) rowsById[seedRecordId] = row;
      });
      state.remainingIds.forEach(function (recordId) {
        var row = rowsById[recordId];
        if (!row || (!row.ready && row.classification !== 'ALREADY_COMPLETED')) {
          PMS.Util.fail(
            row && row.message ? row.message : 'The legacy import preview no longer matches the tracker.',
            'IMPORT_PREVIEW_STALE'
          );
        }
      });
      var selectedIds = state.remainingIds.slice(0, PMS.CONFIG.LEGACY_IMPORT_CHUNK_SIZE);
      var selectedRows = [];
      var skippedRows = [];
      selectedIds.forEach(function (recordId) {
        var row = rowsById[recordId];
        if (!row) {
          PMS.Util.fail('The legacy import preview no longer matches the tracker.', 'IMPORT_PREVIEW_STALE');
        }
        if (row.ready) {
          selectedRows.push(row);
          return;
        }
        if (row.classification === 'ALREADY_COMPLETED') {
          skippedRows.push(row);
          return;
        }
        PMS.Util.fail(row.message || 'The legacy import preview is stale.', 'IMPORT_PREVIEW_STALE');
      });

      // A batch small enough to finish in this one call needs no separate
      // START marker — it is about to get a FINISH event a few lines down,
      // and a start-and-finish pair for something that both started and
      // finished in the same synchronous call is two audit rows saying the
      // same thing. START only earns its place when the batch is genuinely
      // going to span more than one execute() call, which is exactly when an
      // admin might later want to know "did this import ever actually begin".
      var willSpanMultipleChunks = selectedIds.length < state.remainingIds.length;
      if (willSpanMultipleChunks && !state.started) {
        bestEffortEvent(state.batchId + '-START', 'LEGACY_IMPORT_START', {
          year: normalized.cycle.year,
          cycleId: normalized.cycle.cycleId,
          section: normalized.section.key,
          batchId: state.batchId,
          adminEmail: actor.email,
          adminName: actor.name,
          requestDigest: normalized.requestDigest,
          totalReady: state.totalReady,
          timestamp: PMS.Util.nowIso()
        });
        state.started = true;
      }

      var stageItems = selectedRows.map(function (row) {
        return {
          recordId: row.recordId,
          batchId: state.batchId,
          section: normalized.section.key,
          maintenanceDate: normalized.maintenanceDate,
          cycle: normalized.cycle,
          trackerYear: plan.trackerYear,
          asset: row._asset,
          sourceNote: normalized.sourceNote,
          admin: actor,
          historical: plan.historical,
          existing: row._existing || null
        };
      });
      var staged = PMS.Records.stageLegacySeedBatch(stageItems);
      var selectedById = {};
      selectedRows.forEach(function (row) { selectedById[row.recordId] = row; });
      var finalized = staged;
      var trackerFailure = '';
      if (staged.length && !plan.historical) {
        var syncResults = null;
        try {
          syncResults = PMS.Tracker.syncLegacySeedBatch(staged, function (preparedById) {
            PMS.Records.stageLegacySeedTrackerState(staged, preparedById);
          });
        } catch (error) {
          trackerFailure = error.message;
        }
        finalized = PMS.Records.finalizeLegacySeedBatch(staged, syncResults, trackerFailure);
      }

      var resultRows = [];
      skippedRows.forEach(function (row) {
        resultRows.push({
          assetTag: row.assetTag,
          recordId: row.recordId,
          status: 'SKIPPED',
          pmsCompletion: row._existing ? row._existing.pmsCompletion : '',
          message: 'A completed record now exists for this asset and cycle.'
        });
      });
      finalized.forEach(function (record) {
        var completion = PMS.Util.completionState(record.pmsCompletion);
        resultRows.push({
          assetTag: record.assetTag,
          recordId: record.recordId,
          status: completion === 'COMPLETED'
            ? ((selectedById[record.recordId] || {}).classification === 'RESUMABLE' ? 'RESUMED' : 'IMPORTED')
            : 'SYNC_FAILED',
          pmsCompletion: record.pmsCompletion,
          message: completion === 'COMPLETED'
            ? plan.historical
              ? 'Historical legacy PMS imported without changing the current tracker.'
              : 'Legacy PMS imported and the current tracker was updated.'
            : record.syncError || 'Tracker synchronization failed; preview the same import to retry.'
        });
      });

      var imported = selectedRows.filter(function (row) { return row.classification === 'READY'; }).length;
      var resumed = selectedRows.filter(function (row) { return row.classification === 'RESUMABLE'; }).length;
      var completed = finalized.filter(function (record) {
        return PMS.Util.completionState(record.pmsCompletion) === 'COMPLETED';
      }).length;
      var failed = finalized.length - completed;
      var skipped = skippedRows.length;
      var processed = selectedIds.length;
      state.remainingIds = state.remainingIds.slice(selectedIds.length);
      state.totals.processed += processed;
      state.totals.imported += imported;
      state.totals.resumed += resumed;
      state.totals.completed += completed;
      state.totals.skipped += skipped;
      state.totals.failed += failed;
      var hasMore = state.remainingIds.length > 0;
      if (hasMore) {
        writeState(state);
      } else {
        bestEffortEvent(state.batchId + '-FINISH', 'LEGACY_IMPORT_FINISH', {
          year: normalized.cycle.year,
          cycleId: normalized.cycle.cycleId,
          section: normalized.section.key,
          batchId: state.batchId,
          adminEmail: actor.email,
          adminName: actor.name,
          requestDigest: normalized.requestDigest,
          totals: state.totals,
          timestamp: PMS.Util.nowIso()
        });
        deleteState(state);
      }
      response = {
        ok: true,
        batchId: state.batchId,
        section: normalized.section.key,
        cycleId: normalized.cycle.cycleId,
        trackerMode: plan.trackerMode,
        hasMore: hasMore,
        confirmationToken: hasMore ? state.token : '',
        counts: {
          processed: processed,
          imported: imported,
          resumed: resumed,
          completed: completed,
          skipped: skipped,
          failed: failed,
          remaining: state.remainingIds.length,
          totalReady: state.totalReady
        },
        cumulative: state.totals,
        rows: resultRows
      };
    } finally {
      lock.releaseLock();
    }
    return response;
  }

  return {
    preview: preview,
    execute: execute,
    normalizeRequest: normalizeRequest,
    buildPlan: buildPlan
  };
})();
