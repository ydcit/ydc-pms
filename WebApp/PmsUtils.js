var PMS = PMS || {};

PMS.Util = (function () {
  function fail(message, code) {
    var error = new Error(message);
    error.name = code || 'PMS_ERROR';
    throw error;
  }

  function cleanText(value, maxLength) {
    var text = value === null || value === undefined ? '' : String(value);
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    var limit = maxLength || PMS.CONFIG.MAX_TEXT_LENGTH;
    if (text.length > limit) {
      fail('A text field exceeds the ' + limit + '-character limit.', 'VALIDATION_ERROR');
    }
    return text;
  }

  function safeCellText(value, maxLength) {
    var text = cleanText(value, maxLength);
    return /^[=+\-@]/.test(text) ? "'" + text : text;
  }

  function normalizeEmail(email) {
    return cleanText(email, 320).toLowerCase();
  }

  function normalizeAssetTag(value) {
    return cleanText(value, 200).toUpperCase();
  }

  function nowIso() {
    return Utilities.formatDate(new Date(), PMS.CONFIG.TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
  }

  function todayString() {
    return Utilities.formatDate(new Date(), PMS.CONFIG.TIME_ZONE, 'yyyy-MM-dd');
  }

  function parseDateInput(value) {
    var text = cleanText(value, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      fail('Maintenance date must use YYYY-MM-DD.', 'VALIDATION_ERROR');
    }
    var date;
    try {
      date = Utilities.parseDate(text, PMS.CONFIG.TIME_ZONE, 'yyyy-MM-dd');
    } catch (error) {
      fail('Maintenance date is invalid.', 'VALIDATION_ERROR');
    }
    if (Utilities.formatDate(date, PMS.CONFIG.TIME_ZONE, 'yyyy-MM-dd') !== text) {
      fail('Maintenance date is invalid.', 'VALIDATION_ERROR');
    }
    if (text > todayString()) {
      fail('Maintenance date cannot be in the future.', 'VALIDATION_ERROR');
    }
    return date;
  }

  function deriveCycle(date) {
    var year = Number(Utilities.formatDate(date, PMS.CONFIG.TIME_ZONE, 'yyyy'));
    var month = Number(Utilities.formatDate(date, PMS.CONFIG.TIME_ZONE, 'M'));
    var cycle = month <= 4 ? 'T1' : month <= 8 ? 'T2' : 'T3';
    var config = PMS.CONFIG.CYCLES[cycle];
    var deadlineText = year + '-' + String(config.endMonth).padStart(2, '0') + '-' + String(config.endDay).padStart(2, '0');
    return {
      year: year,
      cycle: cycle,
      cycleId: year + '-' + cycle,
      deadline: deadlineText
    };
  }

  function currentCycle() {
    return deriveCycle(parseDateInput(todayString()));
  }

  function makeRecordId(cycle) {
    return 'PMS-' + cycle.year + '-' + cycle.cycle + '-' + Utilities.getUuid().replace(/-/g, '').toUpperCase();
  }

  function makeIdempotencyKey() {
    return Utilities.getUuid();
  }

  function hashText(value) {
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8);
    return bytes.map(function (byte) {
      var normalized = byte < 0 ? byte + 256 : byte;
      return ('0' + normalized.toString(16)).slice(-2);
    }).join('');
  }

  function section(sectionKey) {
    var config = PMS.CONFIG.SECTIONS[sectionKey];
    if (!config) {
      fail('Unknown IT section.', 'VALIDATION_ERROR');
    }
    return config;
  }

  function sectionKeyFromLabel(value) {
    var text = cleanText(value, 100);
    var keys = Object.keys(PMS.CONFIG.SECTIONS);
    for (var i = 0; i < keys.length; i += 1) {
      var item = PMS.CONFIG.SECTIONS[keys[i]];
      if (item.key === text || item.label === text) return item.key;
    }
    return '';
  }

  function allChecklistItems(sectionKey) {
    var result = [];
    var groups = sectionKey === 'INFRA_SECURITY' && PMS.CONFIG.INFRA_CHECKLIST
      ? PMS.CONFIG.INFRA_CHECKLIST
      : PMS.CONFIG.CHECKLIST;
    groups.forEach(function (group) {
      group.items.forEach(function (item) {
        result.push({
          key: item.key,
          label: item.label,
          groupKey: group.key,
          groupLabel: group.label
        });
      });
    });
    return result;
  }

  function progressText(percent, completed, applicable, state) {
    var normalized = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    var filled = Math.round(normalized / 10);
    var bar = '██████████'.slice(0, filled) + '░░░░░░░░░░'.slice(0, 10 - filled);
    return bar + ' ' + normalized + '% (' + completed + '/' + applicable + ') — ' + state;
  }

  function completionState(text) {
    var value = String(text || '');
    var separator = value.lastIndexOf('—');
    return separator >= 0 ? value.slice(separator + 1).trim() : value.trim();
  }

  var CHECKLIST_NOT_DONE = 'NOT DONE';
  var CHECKLIST_REASON_MAX = 500;

  /**
   * Reads a checklist cell.
   *
   * The grammar lives in the cell itself, so recording a reason needed no new
   * column: "DONE", or "NOT DONE: why", or blank for a question nobody answered
   * yet. "NA" is still accepted because records written before reasons were
   * required used it, and a bare note is treated as a reason, which is what a
   * hand-typed remark in the cell means.
   */
  function parseChecklistValue(value) {
    var text = cleanText(value, CHECKLIST_REASON_MAX + 40);
    if (!text) return { state: '', reason: '' };
    var upper = text.toUpperCase();
    if (upper === 'DONE' || upper === 'TRUE' || upper === 'CHECKED') return { state: 'DONE', reason: '' };
    if (upper === 'NA' || upper === 'N/A') return { state: 'NOT_DONE', reason: 'Not applicable' };
    var match = /^NOT\s*DONE\s*[:\-\u2013]?\s*([\s\S]*)$/i.exec(text);
    if (match) {
      var stated = cleanText(match[1], CHECKLIST_REASON_MAX);
      // Not done without a reason is not an answer, so it stays unanswered.
      return { state: stated ? 'NOT_DONE' : '', reason: stated };
    }
    return { state: 'NOT_DONE', reason: cleanText(text, CHECKLIST_REASON_MAX) };
  }

  /** Writes a checklist cell in the grammar parseChecklistValue reads. */
  function formatChecklistValue(state, reason) {
    if (cleanText(state, 20).toUpperCase() === 'DONE') return 'DONE';
    var text = cleanText(reason, CHECKLIST_REASON_MAX);
    return text ? CHECKLIST_NOT_DONE + ': ' + text : '';
  }

  /** Every value the application may write into a cycle status cell. */
  function trackerStatusValues() {
    var values = [PMS.CONFIG.TRACKER_COMPLETED_VALUE];
    Object.keys(PMS.CONFIG.TRACKER_REPAIR_VALUES).forEach(function (key) {
      values.push(PMS.CONFIG.TRACKER_REPAIR_VALUES[key]);
    });
    return values;
  }

  /**
   * True when the cycle cell says the asset was maintained.
   *
   * Accepts legacy checkbox booleans from before the text migration, and every
   * repair status, because those are only ever written AFTER a completed
   * maintenance record. This is what keeps a maintained asset out of the
   * questionnaire's picker: PmsAssets.readAll builds completedCycles from this,
   * so treating "IN PROGRESS" as incomplete would re-offer an asset whose PMS
   * is already done and merely awaiting a repair.
   */
  function isTrackerComplete(value) {
    if (value === true) return true;
    var normalized = String(value === null || value === undefined ? '' : value).trim().toUpperCase();
    if (normalized === 'TRUE' || normalized === 'DONE') return true;
    return trackerStatusValues().some(function (allowed) { return normalized === allowed; });
  }

  /**
   * True when the cycle cell still has repair work outstanding. Deliberately
   * separate from isTrackerComplete: the maintenance is finished either way.
   */
  function isTrackerAwaitingRepair(value) {
    var normalized = String(value === null || value === undefined ? '' : value).trim().toUpperCase();
    return Object.keys(PMS.CONFIG.TRACKER_REPAIR_VALUES).some(function (key) {
      return normalized === PMS.CONFIG.TRACKER_REPAIR_VALUES[key];
    });
  }

  function serializeTags(value) {
    var values = Array.isArray(value) ? value : String(value || '').split(/[,|\n]/);
    var seen = {};
    var normalized = [];
    values.forEach(function (item) {
      var tag = normalizeAssetTag(item);
      if (tag && !seen[tag]) {
        seen[tag] = true;
        normalized.push(tag);
      }
    });
    return normalized.join(' | ');
  }

  /* ------------------------------------------------------------ script cache

     A value too large for a single CacheService entry, stored as base64 chunks
     behind a manifest carrying a generation, a length and a checksum. A reader
     accepts the value only when every chunk belongs to the same write and the
     decoded JSON still matches its checksum, so a partial write or a half
     expired one reads as a miss rather than as corruption.

     The technique was proven on the asset picker in PmsAssets and now lives
     here, because the completed-records list and the ticket list need exactly
     the same thing: one sheet read serving many page requests.

     Versioning is the caller's job, folded into the base key. That keeps this
     helper ignorant of what it is storing while still letting a deployment that
     changes a payload's shape refuse to read older entries.
  */
  var CACHE_CHUNK_SIZE = 80000;
  var MAX_CACHE_CHUNKS = 100;

  function cacheManifestKey(baseKey) { return baseKey + '_MANIFEST'; }
  function cacheChunkKey(baseKey, index) { return baseKey + '_CHUNK_' + index; }

  function cacheAllKeys(baseKey) {
    var keys = [baseKey, cacheManifestKey(baseKey)];
    for (var index = 0; index < MAX_CACHE_CHUNKS; index += 1) {
      keys.push(cacheChunkKey(baseKey, index));
    }
    return keys;
  }

  function cacheChecksum(value) {
    return Utilities.base64EncodeWebSafe(Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8
    ));
  }

  function cacheParseManifest(value) {
    if (!value) return null;
    try {
      var manifest = JSON.parse(value);
      var validChunks = Number.isInteger(manifest.chunks) &&
        manifest.chunks > 0 && manifest.chunks <= MAX_CACHE_CHUNKS;
      var validLength = Number.isInteger(manifest.encodedLength) && manifest.encodedLength > 0;
      var validGeneration = typeof manifest.generation === 'string' &&
        /^[A-Za-z0-9_-]{8,64}$/.test(manifest.generation);
      var validChecksum = typeof manifest.checksum === 'string' && manifest.checksum.length > 0;
      if (!validChunks || !validLength || !validGeneration || !validChecksum) return null;
      return manifest;
    } catch (error) {
      return null;
    }
  }

  /** Drops every key a previous write of this base key could have used. */
  function cacheDrop(baseKey) {
    try {
      CacheService.getScriptCache().removeAll(cacheAllKeys(baseKey));
    } catch (error) {
      console.warn('Cache entry ' + baseKey + ' could not be dropped: ' + error.message);
    }
  }

  /** The cached value for a base key, or null on any doubt at all. */
  function cacheGet(baseKey) {
    try {
      var cache = CacheService.getScriptCache();
      var manifest = cacheParseManifest(cache.get(cacheManifestKey(baseKey)));
      if (!manifest) return null;

      var keys = [];
      for (var index = 0; index < manifest.chunks; index += 1) {
        keys.push(cacheChunkKey(baseKey, index));
      }
      var stored = cache.getAll(keys);
      var prefix = manifest.generation + ':';
      var encoded = '';
      for (var position = 0; position < keys.length; position += 1) {
        var chunk = stored[keys[position]];
        if (typeof chunk !== 'string' || chunk.indexOf(prefix) !== 0) return null;
        encoded += chunk.slice(prefix.length);
      }
      if (encoded.length !== manifest.encodedLength) return null;

      var json = Utilities.newBlob(Utilities.base64DecodeWebSafe(encoded)).getDataAsString('UTF-8');
      if (cacheChecksum(json) !== manifest.checksum) return null;
      return JSON.parse(json);
    } catch (error) {
      console.warn('Ignoring unreadable cache entry ' + baseKey + ': ' + error.message);
      return null;
    }
  }

  /**
   * Stores a value under a base key, chunked as needed.
   *
   * The manifest is written last, so a reader that arrives mid-write sees no
   * manifest and treats it as a miss. Too large to chunk is not an error: the
   * caller carries on with the value it already computed.
   */
  function cachePut(baseKey, value, seconds) {
    try {
      var json = JSON.stringify(value);
      var encoded = Utilities.base64EncodeWebSafe(json, Utilities.Charset.UTF_8);
      var chunks = [];
      for (var offset = 0; offset < encoded.length; offset += CACHE_CHUNK_SIZE) {
        chunks.push(encoded.slice(offset, offset + CACHE_CHUNK_SIZE));
      }
      if (!chunks.length || chunks.length > MAX_CACHE_CHUNKS) {
        console.warn('Value for ' + baseKey + ' is too large for the chunked cache.');
        cacheDrop(baseKey);
        return false;
      }

      var generation = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
      var values = {};
      chunks.forEach(function (chunk, index) {
        values[cacheChunkKey(baseKey, index)] = generation + ':' + chunk;
      });
      var manifest = {
        generation: generation,
        chunks: chunks.length,
        encodedLength: encoded.length,
        checksum: cacheChecksum(json)
      };

      var cache = CacheService.getScriptCache();
      var ttl = seconds || PMS.CONFIG.CACHE_SECONDS;
      cacheDrop(baseKey);
      cache.putAll(values, ttl);
      cache.put(cacheManifestKey(baseKey), JSON.stringify(manifest), ttl);
      return true;
    } catch (error) {
      console.warn('Value for ' + baseKey + ' could not be cached: ' + error.message);
      cacheDrop(baseKey);
      return false;
    }
  }

  /* ------------------------------------------------------ cache generations

     A stamp shared by every reader of one dataset, bumped by anything that
     writes to it. Readers fold it into their cache key, so a single write
     invalidates every cached slice of that data for every viewer at once.

     The alternative was dropping keys by name on write, which works only while
     the writer can enumerate whose caches it just invalidated. A legacy import
     writes records belonging to many technicians and sections, and could not,
     so it would have left other people reading a stale archive until the entry
     expired on its own.
  */
  var generationMemo = {};

  function generation(propertyKey) {
    if (generationMemo[propertyKey] !== undefined) return generationMemo[propertyKey];
    var stamp = '0';
    try {
      stamp = PropertiesService.getScriptProperties().getProperty(propertyKey) || '0';
    } catch (error) {
      console.warn('Generation ' + propertyKey + ' could not be read: ' + error.message);
    }
    generationMemo[propertyKey] = stamp;
    return stamp;
  }

  /**
   * Marks a dataset as changed. Never throws: the write that prompted it has
   * already succeeded, and failing here must not undo it. The cost of a missed
   * bump is bounded by the cache's own expiry.
   */
  function bumpGeneration(propertyKey) {
    /*
      A timestamp alone is not enough. Two writes inside the same millisecond
      produce the same stamp, which leaves the key unchanged and the previous
      write's cache entry still reachable — a stale read for as long as the entry
      lives. The random suffix makes every bump a distinct key; ordering is
      irrelevant, because this is only ever compared for equality.
    */
    var stamp = String(Date.now()) + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    try {
      PropertiesService.getScriptProperties().setProperty(propertyKey, stamp);
      generationMemo[propertyKey] = stamp;
    } catch (error) {
      console.warn('Generation ' + propertyKey + ' could not be bumped: ' + error.message);
      delete generationMemo[propertyKey];
    }
    return stamp;
  }

  function publicError(error) {
    console.error(error && error.stack ? error.stack : error);
    var message = error && error.message ? error.message : 'An unexpected error occurred.';
    return { ok: false, message: message, code: error && error.name ? error.name : 'PMS_ERROR' };
  }

  function daysBetween(dateA, dateB) {
    var milliseconds = dateB.getTime() - dateA.getTime();
    return Math.ceil(milliseconds / 86400000);
  }

  return {
    fail: fail,
    cleanText: cleanText,
    safeCellText: safeCellText,
    normalizeEmail: normalizeEmail,
    normalizeAssetTag: normalizeAssetTag,
    nowIso: nowIso,
    todayString: todayString,
    parseDateInput: parseDateInput,
    deriveCycle: deriveCycle,
    currentCycle: currentCycle,
    makeRecordId: makeRecordId,
    makeIdempotencyKey: makeIdempotencyKey,
    hashText: hashText,
    section: section,
    sectionKeyFromLabel: sectionKeyFromLabel,
    allChecklistItems: allChecklistItems,
    progressText: progressText,
    completionState: completionState,
    parseChecklistValue: parseChecklistValue,
    formatChecklistValue: formatChecklistValue,
    trackerStatusValues: trackerStatusValues,
    isTrackerComplete: isTrackerComplete,
    isTrackerAwaitingRepair: isTrackerAwaitingRepair,
    serializeTags: serializeTags,
    cacheGet: cacheGet,
    cachePut: cachePut,
    cacheDrop: cacheDrop,
    generation: generation,
    bumpGeneration: bumpGeneration,
    publicError: publicError,
    daysBetween: daysBetween
  };
})();
