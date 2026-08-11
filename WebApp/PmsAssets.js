var PMS = PMS || {};

PMS.Assets = (function () {
  var CACHE_VERSION = 2;
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

  function readAll(sectionKey) {
    var section = PMS.Util.section(sectionKey);
    var sheet = sheetForSection(sectionKey);
    var lastRow = sheet.getLastRow();
    if (lastRow < PMS.CONFIG.ASSET_DATA_START_ROW) return [];
    var values = sheet
      .getRange(PMS.CONFIG.ASSET_DATA_START_ROW, 1, lastRow - PMS.CONFIG.ASSET_DATA_START_ROW + 1, 3)
      .getDisplayValues();
    return values.map(function (row, index) {
      return {
        tag: PMS.Util.normalizeAssetTag(row[0]),
        status: PMS.Util.cleanText(row[1], 100).toUpperCase(),
        location: PMS.Util.cleanText(row[2], 500),
        row: PMS.CONFIG.ASSET_DATA_START_ROW + index,
        section: section.key,
        sectionLabel: section.label,
        sheetName: section.sheetName
      };
    }).filter(function (asset) {
      return Boolean(asset.tag);
    });
  }

  function listEligible(sectionKey, forceRefresh) {
    var section = PMS.Util.section(sectionKey);
    var cache = CacheService.getScriptCache();
    var cacheKey = cacheBaseKey(section.key);
    if (!forceRefresh) {
      var cached = readCachedAssets(cache, cacheKey);
      if (cached !== null) return cached;
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
    return assets;
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
    clearCache(CacheService.getScriptCache(), cacheBaseKey(sectionKey));
  }

  return {
    spreadsheet: spreadsheet,
    sheetForSection: sheetForSection,
    readAll: readAll,
    listEligible: listEligible,
    requireEligible: requireEligible,
    invalidate: invalidate
  };
})();
