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
    var defaultDateText = PMS.Util.cleanText(source.maintenanceDate, 10);
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

    // A bulk batch can span more than one actual maintenance date, so each
    // tag resolves its own date: the per-tag value from an uploaded file's
    // second column when present, otherwise the one shared date field every
    // earlier version of this import required. A tag whose date can't be
    // resolved or parsed is not a whole-request failure — it becomes an
    // INVALID row later, reported the same way an unknown asset tag is.
    var tagDatesInput = source.tagDates && typeof source.tagDates === 'object' ? source.tagDates : {};
    var items = uniqueTags.map(function (tag) {
      var rawDate = PMS.Util.cleanText(tagDatesInput[tag], 10) || defaultDateText;
      var item = { tag: tag, dateText: rawDate, date: null, cycle: null, dateError: '' };
      if (!rawDate) {
        item.dateError = 'No maintenance date was supplied for this asset.';
        return item;
      }
      try {
        item.date = PMS.Util.parseDateInput(rawDate);
        item.cycle = PMS.Util.deriveCycle(item.date);
        item.dateText = Utilities.formatDate(item.date, PMS.CONFIG.TIME_ZONE, 'yyyy-MM-dd');
      } catch (error) {
        item.dateError = error.message;
      }
      return item;
    });

    var sourceNote = PMS.Util.cleanText(source.sourceNote, PMS.CONFIG.MAX_TEXT_LENGTH);
    var canonical = {
      section: section.key,
      items: items.map(function (item) { return { tag: item.tag, date: item.dateText }; })
        .sort(function (a, b) { return a.tag.localeCompare(b.tag); }),
      sourceNote: sourceNote
    };
    return {
      section: section,
      submittedTags: submittedTags,
      uniqueTags: uniqueTags,
      items: items,
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
   * only, but a technician may import only into their own registered
   * section — they cannot backfill work for a section they don't belong to.
   * An administrator is unrestricted. The other half of the old
   * authorization split — "historical" rows for an already-closed year stay
   * administrator-only — now happens per row inside buildPlan, since one
   * request can mix historical and current-tracker rows once each tag
   * carries its own date.
   */
  function requireSectionAuthorization(actor, sectionKey) {
    if (actor.isAdmin) return;
    if (sectionKey !== actor.section) {
      PMS.Util.fail('You can import legacy PMS only for your own registered IT section.', 'ACCESS_DENIED');
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

  function buildPlan(normalized, suppliedRecords, actor) {
    var sectionKey = normalized.section.key;
    var sheet = PMS.Assets.sheetForSection(sectionKey);
    var trackerYear = Number(
      sheet.getRange(PMS.CONFIG.TRACKER_YEAR_ROW, PMS.CONFIG.TRACKER_YEAR_COLUMN).getValue()
    );
    if (!trackerYear) {
      PMS.Util.fail(sheet.getName() + ' is missing its tracker year in D2.', 'CONFIGURATION_ERROR');
    }

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
    var historicalCount = 0;
    var currentCount = 0;
    var rows = normalized.items.map(function (item) {
      var tag = item.tag;
      if (item.dateError) {
        return {
          assetTag: tag,
          classification: 'INVALID',
          ready: false,
          recordId: '',
          sourceRow: 0,
          assetStatus: '',
          location: '',
          maintenanceDate: item.dateText,
          cycleId: '',
          message: item.dateError,
          warnings: [],
          _asset: null,
          _existing: null
        };
      }
      var cycle = item.cycle;
      if (Number(cycle.year) > trackerYear) {
        return {
          assetTag: tag,
          classification: 'INVALID',
          ready: false,
          recordId: '',
          sourceRow: 0,
          assetStatus: '',
          location: '',
          maintenanceDate: item.dateText,
          cycleId: cycle.cycleId,
          message: 'The maintenance year ' + cycle.year + ' is ahead of the open ' + trackerYear + ' tracker.',
          warnings: [],
          _asset: null,
          _existing: null
        };
      }
      var historical = Number(cycle.year) < trackerYear;
      if (historical && actor && !actor.isAdmin) {
        return {
          assetTag: tag,
          classification: 'INVALID',
          ready: false,
          recordId: '',
          sourceRow: 0,
          assetStatus: '',
          location: '',
          maintenanceDate: item.dateText,
          cycleId: cycle.cycleId,
          message: 'Only an administrator can import a date outside the current tracker year (' + trackerYear + ').',
          warnings: [],
          _asset: null,
          _existing: null
        };
      }
      if (historical) historicalCount += 1; else currentCount += 1;

      var recordId = PMS.Records.legacySeedRecordId(sectionKey, tag, cycle.cycleId);
      var naturalKey = PMS.Records.completionKey(sectionKey, tag, cycle.cycleId);
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
      if (idRecord && (String(idRecord.dataQualityFlags || '').split('|').map(function (item2) {
        return item2.trim();
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
          maintenanceDate: item.dateText,
          cycleId: cycle.cycleId,
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
          maintenanceDate: item.dateText,
          cycleId: cycle.cycleId,
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
          maintenanceDate: item.dateText,
          cycleId: cycle.cycleId,
          message: 'This asset already has a completed record for ' + cycle.cycleId + '.',
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
          maintenanceDate: item.dateText,
          cycleId: cycle.cycleId,
          message: 'An incomplete non-import record already exists for this asset and cycle.',
          warnings: warnings,
          _asset: asset,
          _existing: null
        };
      }

      if (idRecord && maintenanceDateText(idRecord.maintenanceDate) !== item.dateText) {
        return {
          assetTag: tag,
          classification: 'INVALID',
          ready: false,
          recordId: recordId,
          sourceRow: asset.row,
          assetStatus: asset.status,
          location: asset.location,
          maintenanceDate: item.dateText,
          cycleId: cycle.cycleId,
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
        maintenanceDate: item.dateText,
        cycleId: cycle.cycleId,
        message: idRecord
          ? 'A previously staged legacy import will be resumed.'
          : historical
            ? 'Ready for historical record-only import.'
            : 'Ready for record creation and current tracker synchronization.',
        warnings: warnings,
        _asset: asset,
        _existing: idRecord || null,
        _cycle: cycle,
        _historical: historical
      };
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
        maintenanceDate: '',
        cycleId: '',
        message: 'Duplicate input was collapsed into the first occurrence.',
        warnings: []
      });
    });

    var trackerMode = !historicalCount ? 'CURRENT_TRACKER' : !currentCount ? 'HISTORICAL_RECORD_ONLY' : 'MIXED';
    return {
      trackerYear: trackerYear,
      trackerMode: trackerMode,
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
      maintenanceDate: row.maintenanceDate,
      cycleId: row.cycleId,
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
      trackerYear: state.trackerYear,
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
    requireSectionAuthorization(actor, normalized.section.key);
    var plan = buildPlan(normalized, null, actor);
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
        'LEGACY-IMPORT', plan.trackerYear,
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
        trackerYear: plan.trackerYear,
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
      requireSectionAuthorization(actor, normalized.section.key);
      var allRecords = PMS.Records.allRecords();
      var plan = buildPlan(normalized, allRecords, actor);
      if (state.section !== normalized.section.key || Number(state.trackerYear) !== Number(plan.trackerYear)) {
        PMS.Util.fail(
          'The tracker year changed after preview. Preview the import again.',
          'IMPORT_PREVIEW_STALE'
        );
      }
      var rowsById = {};
      plan.rows.forEach(function (row) {
        if (row.recordId && !rowsById[row.recordId]) rowsById[row.recordId] = row;
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
          trackerYear: plan.trackerYear,
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
          maintenanceDate: row.maintenanceDate,
          cycle: row._cycle,
          trackerYear: plan.trackerYear,
          asset: row._asset,
          sourceNote: normalized.sourceNote,
          admin: actor,
          historical: row._historical,
          existing: row._existing || null
        };
      });
      var staged = PMS.Records.stageLegacySeedBatch(stageItems);
      var selectedById = {};
      selectedRows.forEach(function (row) { selectedById[row.recordId] = row; });

      // Every staged record already knows its own cycle, and a historical
      // row never touches the tracker at all. syncLegacySeedBatch refuses a
      // call whose records cross a cycle boundary, so the current-tracker
      // records are grouped by cycleId and synced one homogeneous group at a
      // time instead of in a single call across the whole chunk.
      var historicalStaged = staged.filter(function (record) {
        return (selectedById[record.recordId] || {})._historical;
      });
      var currentStaged = staged.filter(function (record) {
        return !(selectedById[record.recordId] || {})._historical;
      });
      var cycleGroups = {};
      var cycleOrder = [];
      currentStaged.forEach(function (record) {
        if (!cycleGroups[record.cycleId]) {
          cycleGroups[record.cycleId] = [];
          cycleOrder.push(record.cycleId);
        }
        cycleGroups[record.cycleId].push(record);
      });
      var finalized = historicalStaged.slice();
      cycleOrder.forEach(function (cycleId) {
        var groupRecords = cycleGroups[cycleId];
        var syncResults = null;
        var trackerFailure = '';
        try {
          syncResults = PMS.Tracker.syncLegacySeedBatch(groupRecords, function (preparedById) {
            PMS.Records.stageLegacySeedTrackerState(groupRecords, preparedById);
          });
        } catch (error) {
          trackerFailure = error.message;
        }
        finalized = finalized.concat(PMS.Records.finalizeLegacySeedBatch(groupRecords, syncResults, trackerFailure));
      });

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
        var sourceRow = selectedById[record.recordId] || {};
        resultRows.push({
          assetTag: record.assetTag,
          recordId: record.recordId,
          status: completion === 'COMPLETED'
            ? (sourceRow.classification === 'RESUMABLE' ? 'RESUMED' : 'IMPORTED')
            : 'SYNC_FAILED',
          pmsCompletion: record.pmsCompletion,
          message: completion === 'COMPLETED'
            ? sourceRow._historical
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
          trackerYear: plan.trackerYear,
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
