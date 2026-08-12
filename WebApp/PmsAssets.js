var PMS = PMS || {};

PMS.Assets = (function () {
  // Bumped when the cached asset shape changes so stale entries are rejected.
  var CACHE_VERSION = 3;
  var CACHE_CHUNK_SIZE = 80000;
  var MAX_CACHE_CHUNKS = 100;

  function spreadsheet() {
    return SpreadsheetApp.openById(PMS.CONFIG.SPREADSHEET_ID);
  }

  function cacheBaseKey(sectionKey) {
    return 'PMS_ASSETS_' + PMS.Util.section(sectionKey).key;
  }

  function cacheManifestKey(baseKey) {
    return baseKey + '_MANIFEST';
  }

  function cacheChunkKey(baseKey, index) {
    return baseKey + '_CHUNK_' + index;
  }

  function allCacheKeys(baseKey) {
    var keys = [baseKey, cacheManifestKey(baseKey)];
    for (var index = 0; index < MAX_CACHE_CHUNKS; index += 1) {
      keys.push(cacheChunkKey(baseKey, index));
    }
    return keys;
  }

  function clearCache(cache, baseKey) {
    cache.removeAll(allCacheKeys(baseKey));
  }

  function parseManifest(value) {
    if (!value) return null;
    try {
      var manifest = JSON.parse(value);
      var validChunkCount = Number.isInteger(manifest.chunks) &&
        manifest.chunks > 0 && manifest.chunks <= MAX_CACHE_CHUNKS;
      var validLength = Number.isInteger(manifest.encodedLength) && manifest.encodedLength > 0;
      var validGeneration = typeof manifest.generation === 'string' &&
        /^[A-Za-z0-9_-]{8,64}$/.test(manifest.generation);
      var validChecksum = typeof manifest.checksum === 'string' && manifest.checksum.length > 0;
      if (manifest.version !== CACHE_VERSION || !validChunkCount || !validLength ||
          !validGeneration || !validChecksum) {
        return null;
      }
      return manifest;
    } catch (error) {
      return null;
    }
  }

  function checksum(value) {
    var digest = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      value,
      Utilities.Charset.UTF_8
    );
    return Utilities.base64EncodeWebSafe(digest);
  }

  function encodeCacheValue(value) {
    return Utilities.base64EncodeWebSafe(value, Utilities.Charset.UTF_8);
  }

  function decodeCacheValue(value) {
    return Utilities.newBlob(Utilities.base64DecodeWebSafe(value))
      .getDataAsString('UTF-8');
  }

  function readCachedAssets(cache, baseKey) {
    var manifest = parseManifest(cache.get(cacheManifestKey(baseKey)));
    if (!manifest) return null;

    var keys = [];
    for (var index = 0; index < manifest.chunks; index += 1) {
      keys.push(cacheChunkKey(baseKey, index));
    }
    var cachedChunks = cache.getAll(keys);
    var prefix = manifest.generation + ':';
    var encoded = '';
    for (var chunkIndex = 0; chunkIndex < keys.length; chunkIndex += 1) {
      var chunk = cachedChunks[keys[chunkIndex]];
      if (typeof chunk !== 'string' || chunk.indexOf(prefix) !== 0) return null;
      encoded += chunk.slice(prefix.length);
    }
    if (encoded.length !== manifest.encodedLength) return null;

    try {
      var json = decodeCacheValue(encoded);
      if (checksum(json) !== manifest.checksum) return null;
      var assets = JSON.parse(json);
      return Array.isArray(assets) ? assets : null;
    } catch (error) {
      console.warn('Ignoring invalid chunked asset cache: ' + error.message);
      return null;
    }
  }

  function writeCachedAssets(cache, baseKey, assets) {
    var json = JSON.stringify(assets);
    var encoded = encodeCacheValue(json);
    var chunks = [];
    for (var offset = 0; offset < encoded.length; offset += CACHE_CHUNK_SIZE) {
      chunks.push(encoded.slice(offset, offset + CACHE_CHUNK_SIZE));
    }
    if (!chunks.length || chunks.length > MAX_CACHE_CHUNKS) {
      console.warn('Asset list is too large for the chunked cache.');
      clearCache(cache, baseKey);
      return;
    }

    var generation = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    var values = {};
    chunks.forEach(function (chunk, index) {
      values[cacheChunkKey(baseKey, index)] = generation + ':' + chunk;
    });
    var manifest = {
      version: CACHE_VERSION,
      generation: generation,
      chunks: chunks.length,
      encodedLength: encoded.length,
      checksum: checksum(json)
    };

    // Remove both legacy single-value entries and every possible prior chunk.
    // The manifest is written last so readers never accept a partial write.
    clearCache(cache, baseKey);
    try {
      cache.putAll(values, PMS.CONFIG.CACHE_SECONDS);
      cache.put(cacheManifestKey(baseKey), JSON.stringify(manifest), PMS.CONFIG.CACHE_SECONDS);
    } catch (error) {
      clearCache(cache, baseKey);
      throw error;
    }
  }

  function sheetForSection(sectionKey) {
    var section = PMS.Util.section(sectionKey);
    var sheet = spreadsheet().getSheetByName(section.sheetName);
    if (!sheet) {
      PMS.Util.fail('Asset sheet not found: ' + section.sheetName, 'CONFIGURATION_ERROR');
    }
    return sheet;
  }

  /*
    Resolved on call, never at load time. Apps Script evaluates project files in
    alphabetical order, so PmsAssets runs before PmsConfig and PMS.CONFIG does
    not exist yet while this file is being evaluated.
  */
  function cycleKeys() {
    return Object.keys(PMS.CONFIG.CYCLES);
  }

  /** Column span covering every cycle checkbox, read as one range. */
  function cycleCheckboxSpan() {
    var columns = cycleKeys().map(function (key) {
      return PMS.CONFIG.CYCLES[key].checkboxColumn;
    });
    return {
      first: Math.min.apply(null, columns),
      last: Math.max.apply(null, columns)
    };
  }

  function readAll(sectionKey) {
    var section = PMS.Util.section(sectionKey);
    var sheet = sheetForSection(sectionKey);
    var lastRow = sheet.getLastRow();
    if (lastRow < PMS.CONFIG.ASSET_DATA_START_ROW) return [];
    var rowCount = lastRow - PMS.CONFIG.ASSET_DATA_START_ROW + 1;
    var values = sheet
      .getRange(PMS.CONFIG.ASSET_DATA_START_ROW, 1, rowCount, 3)
      .getDisplayValues();
    // Checkboxes must be read with getValues(); a display value renders the
    // boolean as the text "TRUE"/"FALSE" and would compare incorrectly.
    var span = cycleCheckboxSpan();
    var cycleValues = sheet
      .getRange(PMS.CONFIG.ASSET_DATA_START_ROW, span.first, rowCount, span.last - span.first + 1)
      .getValues();

    return values.map(function (row, index) {
      var cycles = {};
      var completedCycles = [];
      cycleKeys().forEach(function (key) {
        var offset = PMS.CONFIG.CYCLES[key].checkboxColumn - span.first;
        var done = cycleValues[index][offset] === true;
        cycles[key] = done;
        if (done) completedCycles.push(key);
      });
      return {
        tag: PMS.Util.normalizeAssetTag(row[0]),
        status: PMS.Util.cleanText(row[1], 100).toUpperCase(),
        location: PMS.Util.cleanText(row[2], 500),
        row: PMS.CONFIG.ASSET_DATA_START_ROW + index,
        section: section.key,
        sectionLabel: section.label,
        sheetName: section.sheetName,
        cycles: cycles,
        completedCycles: completedCycles
      };
    }).filter(function (asset) {
      return Boolean(asset.tag);
    });
  }

  /*
    Per-execution memo. A single bootstrap asks for the eligible list twice,
    once for the asset picker and once for the metrics denominator. Without this
    the second call still pays a CacheService round trip plus a base64 decode and
    checksum of the whole list.
  */
  var eligibleMemo = {};

  function listEligible(sectionKey, forceRefresh) {
    var section = PMS.Util.section(sectionKey);
    var cache = CacheService.getScriptCache();
    var cacheKey = cacheBaseKey(section.key);
    if (!forceRefresh && eligibleMemo[section.key]) return eligibleMemo[section.key];
    if (!forceRefresh) {
      var cached = readCachedAssets(cache, cacheKey);
      if (cached !== null) {
        eligibleMemo[section.key] = cached;
        return cached;
      }
    }
    var seen = {};
    var assets = readAll(sectionKey).filter(function (asset) {
      if (asset.status !== 'INPROD' || seen[asset.tag]) return false;
      seen[asset.tag] = true;
      return true;
    });
    try {
      writeCachedAssets(cache, cacheKey, assets);
    } catch (error) {
      console.warn('Asset list could not be cached: ' + error.message);
    }
    eligibleMemo[section.key] = assets;
    return assets;
  }

  /**
   * True when the tracker already records this asset as maintained, according
   * to PMS.CONFIG.ASSET_PICKER_COMPLETION_SCOPE.
   */
  function isAlreadyCompleted(asset, cycleKey) {
    var completed = asset.completedCycles || [];
    if (PMS.CONFIG.ASSET_PICKER_COMPLETION_SCOPE === 'CURRENT_CYCLE') {
      return completed.indexOf(cycleKey) >= 0;
    }
    return completed.length > 0;
  }

  /**
   * Assets offered in the questionnaire's asset picker: INPROD and not yet
   * checked off in the section tracker.
   *
   * Deliberately separate from listEligible(), which PMS.Metrics uses as the
   * eligibility denominator. Filtering there would make completed assets vanish
   * from the eligible count and break the compliance percentage.
   *
   * The cycle fields are dropped from the result so the client payload stays
   * the same size as before.
   */
  function listSelectable(sectionKey, forceRefresh) {
    var cycleKey = PMS.Util.currentCycle().cycle;
    return listEligible(sectionKey, forceRefresh)
      .filter(function (asset) {
        return !isAlreadyCompleted(asset, cycleKey);
      })
      .map(function (asset) {
        return {
          tag: asset.tag,
          status: asset.status,
          location: asset.location,
          row: asset.row,
          section: asset.section,
          sectionLabel: asset.sectionLabel,
          sheetName: asset.sheetName
        };
      });
  }

  function requireEligible(sectionKey, assetTag) {
    var tag = PMS.Util.normalizeAssetTag(assetTag);
    if (!tag) PMS.Util.fail('Select an asset tag.', 'VALIDATION_ERROR');
    var matches = readAll(sectionKey).filter(function (asset) {
      return asset.tag === tag;
    });
    if (matches.length !== 1) {
      PMS.Util.fail(
        matches.length ? 'Asset tag is duplicated in the authorized section.' : 'Asset tag was not found in the authorized section.',
        'ASSET_NOT_ELIGIBLE'
      );
    }
    if (matches[0].status !== 'INPROD') {
      PMS.Util.fail('The selected asset is no longer INPROD. Refresh and choose another asset.', 'ASSET_NOT_ELIGIBLE');
    }
    return matches[0];
  }

  function invalidate(sectionKey) {
    delete eligibleMemo[PMS.Util.section(sectionKey).key];
    clearCache(CacheService.getScriptCache(), cacheBaseKey(sectionKey));
  }

  return {
    spreadsheet: spreadsheet,
    sheetForSection: sheetForSection,
    readAll: readAll,
    listEligible: listEligible,
    listSelectable: listSelectable,
    requireEligible: requireEligible,
    invalidate: invalidate
  };
})();
