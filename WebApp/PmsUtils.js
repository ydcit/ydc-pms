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
          allowsNa: item.allowsNa,
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
    serializeTags: serializeTags,
    publicError: publicError,
    daysBetween: daysBetween
  };
})();
