var PMS = PMS || {};

PMS.Assets = (function () {
  /*
    Bumped when the browser-visible asset shape or eligibility behaviour changes,
    so a deployment never reads picker results built by an older version. It is
    part of the cache key rather than of the stored value, which is what lets the
    generic cache helper stay ignorant of what it holds.
  */
  var CACHE_VERSION = 6;

  function spreadsheet() {
    return SpreadsheetApp.openById(PMS.CONFIG.SPREADSHEET_ID);
  }

  function cacheBaseKey(sectionKey) {
    return 'PMS_ASSETS_V' + CACHE_VERSION + '_' + PMS.Util.section(sectionKey).key;
  }

  /** Cached eligible assets, or null when there is nothing trustworthy stored. */
  function readCachedAssets(baseKey) {
    var assets = PMS.Util.cacheGet(baseKey);
    return Array.isArray(assets) ? assets : null;
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

  /** Column span covering every cycle status, read as one range. */
  function cycleStatusSpan() {
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
    var trackerYear = Number(
      sheet.getRange(PMS.CONFIG.TRACKER_YEAR_ROW, PMS.CONFIG.TRACKER_YEAR_COLUMN).getValue()
    ) || 0;
    var values = sheet
      .getRange(PMS.CONFIG.ASSET_DATA_START_ROW, 1, rowCount, 3)
      .getDisplayValues();
    // Read native values so the migration remains compatible with both legacy
    // checkbox booleans and the current COMPLETED text status.
    var span = cycleStatusSpan();
    var cycleValues = sheet
      .getRange(PMS.CONFIG.ASSET_DATA_START_ROW, span.first, rowCount, span.last - span.first + 1)
      .getValues();

    return values.map(function (row, index) {
      var cycles = {};
      var completedCycles = [];
      cycleKeys().forEach(function (key) {
        var offset = PMS.CONFIG.CYCLES[key].checkboxColumn - span.first;
        var done = PMS.Util.isTrackerComplete(cycleValues[index][offset]);
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
        trackerYear: trackerYear,
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
    var cacheKey = cacheBaseKey(section.key);
    if (!forceRefresh && eligibleMemo[section.key]) return eligibleMemo[section.key];
    if (!forceRefresh) {
      var cached = readCachedAssets(cacheKey);
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
    PMS.Util.cachePut(cacheKey, assets);
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
   * Assets offered to the questionnaire.
   *
   * Eligibility depends on the maintenance date the technician selects, not on
   * today's date. The browser therefore receives every INPROD asset together
   * with its completed-cycle flags and filters the picker after a date is
   * selected. The server still re-reads the authoritative tracker row before a
   * save, so these flags are presentation data rather than an authorization
   * boundary.
   */
  function listSelectable(sectionKey, forceRefresh) {
    var selectable = listEligible(sectionKey, forceRefresh)
      .map(function (asset) {
        return {
          tag: asset.tag,
          status: asset.status,
          location: asset.location,
          row: asset.row,
          section: asset.section,
          sectionLabel: asset.sectionLabel,
          sheetName: asset.sheetName,
          trackerYear: asset.trackerYear,
          cycles: asset.cycles,
          completedCycles: asset.completedCycles
        };
      });

    /*
      Outstanding repairs ride along so that picking an asset can warn about them
      without a round trip; one memoised ticket read covers the whole list, where
      asking per selection would put a server call behind a keystroke.

      The key is only set where there is something to say. This list is the
      largest thing in the bootstrap and is measured in bytes, so paying
      "openTickets":[] on a thousand healthy assets to carry nothing is not worth
      the wire.
    */
    var openTickets = PMS.Tickets.openByAsset(selectable.map(function (asset) {
      return asset.tag;
    }));
    selectable.forEach(function (asset) {
      if (openTickets[asset.tag]) asset.openTickets = openTickets[asset.tag];
    });
    return selectable;
  }

  /**
   * Asset tags offered to a picker that is not tied to a maintenance cycle,
   * currently the findings-ticket form.
   *
   * Deliberately leaner than listSelectable: a ticket only needs the tag and
   * where the asset is, not tracker flags or row numbers. 'ALL' is accepted and
   * fanned out across the configured sections, because a ticket may be filed
   * against either section while PMS.Util.section rejects 'ALL' outright.
   *
   * Reads through the existing per-section cache rather than forcing a refresh,
   * so opening the ticket form does not re-read the asset sheets.
   */
  function listOptions(sectionKey) {
    var requested = PMS.Util.cleanText(sectionKey, 30).toUpperCase();
    var keys = requested === 'ALL' || !requested
      ? Object.keys(PMS.CONFIG.SECTIONS)
      : [PMS.Util.section(requested).key];
    var options = [];
    keys.forEach(function (key) {
      listEligible(key).forEach(function (asset) {
        options.push({
          tag: asset.tag,
          location: asset.location,
          section: asset.section,
          sectionLabel: asset.sectionLabel
        });
      });
    });
    return options;
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
    PMS.Util.cacheDrop(cacheBaseKey(sectionKey));
  }

  return {
    spreadsheet: spreadsheet,
    sheetForSection: sheetForSection,
    readAll: readAll,
    listEligible: listEligible,
    listSelectable: listSelectable,
    listOptions: listOptions,
    requireEligible: requireEligible,
    invalidate: invalidate
  };
})();
