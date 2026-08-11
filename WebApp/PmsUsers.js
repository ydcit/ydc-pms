var PMS = PMS || {};

/**
 * Persistent user profiles for the PMS web app.
 *
 * The sheet is the source of truth. Legacy PMS_USER_* Script Properties are
 * imported once and retained only as a rollback aid; they are never trusted
 * over an existing sheet row.
 */
PMS.Users = (function () {
  var SHEET_NAME = 'PMS Users';
  var MIGRATION_PROPERTY = 'PMS_USERS_MIGRATION_V1';
  var PRESENTATION_PROPERTY = 'PMS_USERS_PRESENTATION_V2';
  var LOCK_TIMEOUT_MS = 30000;
  var LAST_LOGIN_WRITE_INTERVAL_MS = 5 * 60 * 1000;
  // EMAIL_OTP and TEMPORARY_KEY are retired sign-in sources. They remain
  // accepted values so historical rows written before the email-only sign-in
  // change still parse instead of failing validation.
  var IDENTITY_SOURCES = ['GOOGLE_ACCOUNT', 'EMAIL_OTP', 'TEMPORARY_KEY', 'LEGACY_MIGRATION', 'ADMIN_UPDATE'];
  var COLUMNS = Object.freeze([
    Object.freeze({ key: 'email', label: 'Email' }),
    Object.freeze({ key: 'name', label: 'Name' }),
    Object.freeze({ key: 'section', label: 'IT Section' }),
    Object.freeze({ key: 'role', label: 'Role' }),
    Object.freeze({ key: 'isAdmin', label: 'Administrator' }),
    Object.freeze({ key: 'active', label: 'Active' }),
    Object.freeze({ key: 'registeredAt', label: 'Registered At' }),
    Object.freeze({ key: 'createdAt', label: 'Created At' }),
    Object.freeze({ key: 'updatedAt', label: 'Updated At' }),
    Object.freeze({ key: 'lastLoginAt', label: 'Last Login At' }),
    Object.freeze({ key: 'updatedBy', label: 'Updated By' }),
    Object.freeze({ key: 'identityKeyHash', label: 'Identity Key Hash' }),
    Object.freeze({ key: 'identityBoundAt', label: 'Identity Bound At' }),
    Object.freeze({ key: 'identitySource', label: 'Last Identity Source' })
  ]);

  function columnNumber(key) {
    for (var index = 0; index < COLUMNS.length; index += 1) {
      if (COLUMNS[index].key === key) return index + 1;
    }
    PMS.Util.fail('Unknown PMS Users column: ' + key, 'CONFIGURATION_ERROR');
  }

  function spreadsheet() {
    return SpreadsheetApp.openById(PMS.CONFIG.SPREADSHEET_ID);
  }

  function usersSheet(createIfMissing) {
    var sheet = spreadsheet().getSheetByName(SHEET_NAME);
    if (!sheet && createIfMissing) {
      sheet = spreadsheet().insertSheet(SHEET_NAME);
      initializeSheet(sheet);
    }
    if (sheet) verifyHeaders(sheet);
    return sheet;
  }

  function initializeSheet(sheet) {
    if (sheet.getMaxColumns() < COLUMNS.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), COLUMNS.length - sheet.getMaxColumns());
    }
    sheet.getRange(1, 1, 1, COLUMNS.length).setValues([
      COLUMNS.map(function (column) { return column.label; })
    ]);
    sheet.setFrozenRows(1);
    sheet.setFrozenColumns(1);
    sheet.setHiddenGridlines(false);
    sheet.setTabColor('#5f6368');
    sheet.getRange(1, 1, 1, COLUMNS.length)
      .setBackground('#f1f3f4')
      .setFontColor('#202124')
      .setFontWeight('bold')
      .setVerticalAlignment('middle')
      .setWrap(true);
    sheet.setRowHeight(1, 42);
    sheet.setColumnWidths(1, COLUMNS.length, 145);
    sheet.setColumnWidth(columnNumber('email'), 235);
    sheet.setColumnWidth(columnNumber('name'), 190);
    sheet.setColumnWidth(columnNumber('section'), 185);
    sheet.setColumnWidth(columnNumber('updatedBy'), 235);
    sheet.setColumnWidth(columnNumber('identityKeyHash'), 320);
    sheet.setColumnWidth(columnNumber('identitySource'), 175);
    sheet.hideColumns(columnNumber('identityKeyHash'));
    if (!sheet.getFilter()) {
      sheet.getRange(1, 1, sheet.getMaxRows(), COLUMNS.length).createFilter();
    }
    applyDataRules(sheet, 2, Math.max(1, sheet.getMaxRows() - 1));

    var dataRange = sheet.getRange(2, 1, Math.max(1, sheet.getMaxRows() - 1), COLUMNS.length);
    sheet.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=AND($A2<>"",$F2=FALSE)')
        .setBackground('#fce8e6')
        .setFontColor('#b3261e')
        .setRanges([dataRange])
        .build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=AND($A2<>"",$E2=TRUE)')
        .setBold(true)
        .setRanges([dataRange])
        .build()
    ]);
    PropertiesService.getScriptProperties().setProperty(
      PRESENTATION_PROPERTY,
      String(sheet.getSheetId()) + ':' + COLUMNS.length
    );
  }

  function verifyHeaders(sheet) {
    if (sheet.getMaxColumns() < COLUMNS.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), COLUMNS.length - sheet.getMaxColumns());
    }
    var expected = COLUMNS.map(function (column) { return column.label; });
    var current = sheet.getRange(1, 1, 1, COLUMNS.length).getDisplayValues()[0];
    if (current.every(function (value) { return !value; })) {
      initializeSheet(sheet);
      return;
    }
    var mismatches = [];
    expected.forEach(function (label, index) {
      if (current[index] !== label) mismatches.push((index + 1) + ': ' + current[index] + ' != ' + label);
    });
    if (mismatches.length) {
      PMS.Util.fail(
        'PMS Users header mismatch. Refusing to use the sheet: ' + mismatches.slice(0, 5).join('; '),
        'SCHEMA_MISMATCH'
      );
    }
    ensurePresentation(sheet);
  }

  function ensurePresentation(sheet) {
    var signature = String(sheet.getSheetId()) + ':' + COLUMNS.length;
    var propertyStore = PropertiesService.getScriptProperties();
    if (propertyStore.getProperty(PRESENTATION_PROPERTY) !== signature) {
      sheet.setFrozenRows(1);
      sheet.setFrozenColumns(1);
      sheet.setHiddenGridlines(false);
      sheet.setTabColor('#5f6368');
      sheet.getRange(1, 1, 1, COLUMNS.length)
        .setBackground('#f1f3f4')
        .setFontColor('#202124')
        .setFontWeight('bold')
        .setVerticalAlignment('middle')
        .setWrap(true);
      sheet.setRowHeight(1, 42);
      sheet.setColumnWidths(1, COLUMNS.length, 145);
      sheet.setColumnWidth(columnNumber('email'), 235);
      sheet.setColumnWidth(columnNumber('name'), 190);
      sheet.setColumnWidth(columnNumber('section'), 185);
      sheet.setColumnWidth(columnNumber('updatedBy'), 235);
      sheet.setColumnWidth(columnNumber('identityKeyHash'), 320);
      sheet.setColumnWidth(columnNumber('identitySource'), 175);
      if (!sheet.getFilter()) {
        sheet.getRange(1, 1, sheet.getMaxRows(), COLUMNS.length).createFilter();
      }
      applyDataRules(sheet, 2, Math.max(1, sheet.getMaxRows() - 1));
      var dataRange = sheet.getRange(2, 1, Math.max(1, sheet.getMaxRows() - 1), COLUMNS.length);
      sheet.setConditionalFormatRules([
        SpreadsheetApp.newConditionalFormatRule()
          .whenFormulaSatisfied('=AND($A2<>"",$F2=FALSE)')
          .setBackground('#fce8e6')
          .setFontColor('#b3261e')
          .setRanges([dataRange])
          .build(),
        SpreadsheetApp.newConditionalFormatRule()
          .whenFormulaSatisfied('=AND($A2<>"",$E2=TRUE)')
          .setBold(true)
          .setRanges([dataRange])
          .build()
      ]);
      propertyStore.setProperty(PRESENTATION_PROPERTY, signature);
    }
    if (!sheet.isColumnHiddenByUser(columnNumber('identityKeyHash'))) {
      sheet.hideColumns(columnNumber('identityKeyHash'));
    }
  }

  function applyDataRules(sheet, startRow, rowCount) {
    if (rowCount < 1) return;
    var sectionRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(Object.keys(PMS.CONFIG.SECTIONS), true)
      .setAllowInvalid(false)
      .build();
    var roleRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['ADMIN', 'TECHNICIAN'], true)
      .setAllowInvalid(false)
      .build();
    var checkboxRule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
    sheet.getRange(startRow, columnNumber('section'), rowCount, 1).setDataValidation(sectionRule);
    sheet.getRange(startRow, columnNumber('role'), rowCount, 1).setDataValidation(roleRule);
    sheet.getRange(startRow, columnNumber('isAdmin'), rowCount, 1).setDataValidation(checkboxRule);
    sheet.getRange(startRow, columnNumber('active'), rowCount, 1).setDataValidation(checkboxRule);
    sheet.getRange(startRow, columnNumber('email'), rowCount, 1).setNumberFormat('@');
    sheet.getRange(startRow, columnNumber('identityKeyHash'), rowCount, 1).setNumberFormat('@');
    [
      'registeredAt', 'createdAt', 'updatedAt', 'lastLoginAt', 'identityBoundAt'
    ].forEach(function (key) {
      sheet.getRange(startRow, columnNumber(key), rowCount, 1).setNumberFormat('@');
    });
  }

  function withScriptLock(callback) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
      PMS.Util.fail('User profiles are busy. Please try again.', 'BUSY');
    }
    try {
      return callback();
    } finally {
      lock.releaseLock();
    }
  }

  function normalizeAndValidateEmail(value) {
    var email = PMS.Util.normalizeEmail(value);
    var parts = email.split('@');
    var local = parts.length === 2 ? parts[0] : '';
    var validLocal = Boolean(local) && local.charAt(0) !== '.' && local.slice(-1) !== '.' &&
      local.indexOf('..') < 0 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local);
    if (!email || email.length > 254 || /\s/.test(email) || parts.length !== 2 || !validLocal ||
        parts[1] !== PMS.CONFIG.ALLOWED_DOMAIN.toLowerCase()) {
      PMS.Util.fail('A valid ' + PMS.CONFIG.ALLOWED_DOMAIN + ' email is required.', 'VALIDATION_ERROR');
    }
    return email;
  }

  function configuredAdminEmails() {
    var values = (PMS.CONFIG.ADMIN_EMAILS || []).slice();
    var configured = PropertiesService.getScriptProperties()
      .getProperty(PMS.CONFIG.ADMIN_EMAILS_PROPERTY) || '';
    configured.split(/[;,\s]+/).forEach(function (email) {
      if (email) values.push(email);
    });
    var seen = {};
    return values.map(PMS.Util.normalizeEmail).filter(function (email) {
      if (!email || seen[email]) return false;
      seen[email] = true;
      return true;
    });
  }

  function isConfiguredAdmin(email) {
    return configuredAdminEmails().indexOf(PMS.Util.normalizeEmail(email)) >= 0;
  }

  function displayNameFromEmail(email) {
    var local = String(email || '').split('@')[0];
    return local.replace(/[._-]+/g, ' ').split(' ').filter(Boolean).map(function (word) {
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }).join(' ') || email;
  }

  function cleanStoredText(value, maxLength) {
    var text = PMS.Util.cleanText(value, maxLength);
    return /^'[=+\-@]/.test(text) ? text.slice(1) : text;
  }

  function safeCellValue(value, maxLength) {
    return PMS.Util.safeCellText(value, maxLength);
  }

  function booleanValue(value, defaultValue) {
    if (value === true || String(value).toUpperCase() === 'TRUE') return true;
    if (value === false || String(value).toUpperCase() === 'FALSE') return false;
    return Boolean(defaultValue);
  }

  function normalizeSection(value, failOnInvalid) {
    var text = PMS.Util.cleanText(value, 100);
    if (!text) return '';
    var key = PMS.Util.sectionKeyFromLabel(text);
    if (!key && failOnInvalid) {
      PMS.Util.fail('Invalid IT section in PMS Users: ' + text, 'DATA_INTEGRITY_ERROR');
    }
    return key;
  }

  function normalizeIdentityHash(value, failOnInvalid) {
    var hash = PMS.Util.cleanText(value, 128).toLowerCase();
    if (hash && !/^[a-f0-9]{64}$/.test(hash)) {
      if (failOnInvalid) {
        PMS.Util.fail('Invalid identity key hash in PMS Users.', 'DATA_INTEGRITY_ERROR');
      }
      return '';
    }
    return hash;
  }

  function normalizeIdentitySource(value) {
    var source = PMS.Util.cleanText(value, 50).toUpperCase();
    return IDENTITY_SOURCES.indexOf(source) >= 0 ? source : '';
  }

  function rowToProfile(row, rowNumber, lenient) {
    var raw = {};
    COLUMNS.forEach(function (column, index) { raw[column.key] = row[index]; });
    var email = normalizeAndValidateEmail(raw.email);
    var admin = isConfiguredAdmin(email);
    return {
      _rowNumber: rowNumber,
      email: email,
      name: cleanStoredText(raw.name, 250) || displayNameFromEmail(email),
      section: normalizeSection(raw.section, !lenient),
      role: admin ? 'ADMIN' : 'TECHNICIAN',
      isAdmin: admin,
      // A row added by hand normally leaves Active blank. Only an explicit
      // FALSE disables access, so a manually provisioned user is not locked out.
      active: booleanValue(raw.active, true),
      registeredAt: cleanStoredText(raw.registeredAt, 100),
      createdAt: cleanStoredText(raw.createdAt, 100),
      updatedAt: cleanStoredText(raw.updatedAt, 100),
      lastLoginAt: cleanStoredText(raw.lastLoginAt, 100),
      updatedBy: cleanStoredText(raw.updatedBy, 320),
      identityKeyHash: normalizeIdentityHash(raw.identityKeyHash, false),
      identityBoundAt: cleanStoredText(raw.identityBoundAt, 100),
      identitySource: normalizeIdentitySource(raw.identitySource)
    };
  }

  function profileToRow(profile) {
    return COLUMNS.map(function (column) {
      var value = profile[column.key];
      if (value === undefined || value === null) return '';
      if (typeof value === 'boolean') return value;
      var limit = column.key === 'name' ? 250 : column.key === 'updatedBy' || column.key === 'email' ? 320 : 200;
      return safeCellValue(value, limit);
    });
  }

  function ensureRowCapacity(sheet, rowNumber) {
    if (rowNumber <= sheet.getMaxRows()) return;
    var firstNewRow = sheet.getMaxRows() + 1;
    var count = rowNumber - sheet.getMaxRows();
    sheet.insertRowsAfter(sheet.getMaxRows(), count);
    applyDataRules(sheet, firstNewRow, count);
  }

  function firstBlankEmailRow(sheet) {
    var maxRows = sheet.getMaxRows();
    if (maxRows < 2) {
      sheet.insertRowAfter(1);
      return 2;
    }
    var emails = sheet
      .getRange(2, columnNumber('email'), maxRows - 1, 1)
      .getDisplayValues();
    for (var index = 0; index < emails.length; index += 1) {
      if (!PMS.Util.cleanText(emails[index][0], 320)) return index + 2;
    }
    return maxRows + 1;
  }

  function rowsForEmail(sheet, email) {
    if (!sheet || sheet.getLastRow() < 2) return [];
    var values = sheet
      .getRange(2, columnNumber('email'), sheet.getLastRow() - 1, 1)
      .getDisplayValues();
    var rows = [];
    values.forEach(function (row, index) {
      var candidate = '';
      try {
        candidate = PMS.Util.normalizeEmail(row[0]);
      } catch (error) {
        return;
      }
      if (candidate === email) rows.push(index + 2);
    });
    return rows;
  }

  function profileAtRow(sheet, rowNumber) {
    if (!rowNumber) return null;
    return rowToProfile(
      sheet.getRange(rowNumber, 1, 1, COLUMNS.length).getValues()[0],
      rowNumber
    );
  }

  function findByEmailUnlocked(sheet, email) {
    var matches = rowsForEmail(sheet, email);
    if (matches.length > 1) {
      PMS.Util.fail('Duplicate PMS Users rows exist for ' + email + '.', 'DATA_INTEGRITY_ERROR');
    }
    return matches.length ? profileAtRow(sheet, matches[0]) : null;
  }

  /**
   * Reads every usable profile row.
   *
   * A single malformed row must never break sign-in for the whole directory, so
   * unreadable rows are skipped with a warning instead of throwing. A specific
   * lookup by email still validates strictly through findByEmailUnlocked().
   */
  function allProfilesUnlocked(sheet) {
    if (!sheet || sheet.getLastRow() < 2) return [];
    var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, COLUMNS.length).getValues();
    var profiles = [];
    var seen = {};
    values.forEach(function (row, index) {
      var rowNumber = index + 2;
      var hasEmail = false;
      try {
        hasEmail = Boolean(PMS.Util.cleanText(row[0], 320));
      } catch (error) {
        console.warn('Skipping PMS Users row ' + rowNumber + ' with an unreadable email: ' + error.message);
        return;
      }
      if (!hasEmail) return;
      var profile;
      try {
        profile = rowToProfile(row, rowNumber, true);
      } catch (error) {
        console.warn('Skipping malformed PMS Users row ' + rowNumber + ': ' + error.message);
        return;
      }
      if (seen[profile.email]) {
        console.warn('Skipping duplicate PMS Users row ' + rowNumber + ' for ' + profile.email + '.');
        return;
      }
      seen[profile.email] = true;
      profiles.push(profile);
    });
    return profiles;
  }

  function normalizeForWrite(input, existing) {
    var value = input || {};
    var prior = existing || {};
    var timestamp = PMS.Util.nowIso();
    var email = normalizeAndValidateEmail(value.email || prior.email);
    var sectionInput = value.section !== undefined ? value.section : prior.section;
    var section = normalizeSection(sectionInput, true);
    var admin = isConfiguredAdmin(email);
    var activeInput = value.active !== undefined ? value.active : prior.active;
    var active = booleanValue(activeInput, existing ? prior.active : true);
    var identityHashInput = value.identityKeyHash !== undefined
      ? value.identityKeyHash
      : prior.identityKeyHash;
    var identityHash = normalizeIdentityHash(identityHashInput, true);
    var registeredAt = cleanStoredText(
      value.registeredAt !== undefined ? value.registeredAt : prior.registeredAt,
      100
    );
    if (section && !registeredAt) registeredAt = timestamp;
    return {
      email: email,
      name: cleanStoredText(
        value.name !== undefined ? value.name : prior.name,
        250
      ) || displayNameFromEmail(email),
      section: section,
      role: admin ? 'ADMIN' : 'TECHNICIAN',
      isAdmin: admin,
      active: active,
      registeredAt: registeredAt,
      createdAt: cleanStoredText(prior.createdAt || value.createdAt, 100) || registeredAt || timestamp,
      updatedAt: timestamp,
      lastLoginAt: cleanStoredText(
        value.lastLoginAt !== undefined ? value.lastLoginAt : prior.lastLoginAt,
        100
      ),
      updatedBy: cleanStoredText(
        value.updatedBy !== undefined ? value.updatedBy : prior.updatedBy,
        320
      ),
      identityKeyHash: identityHash,
      identityBoundAt: cleanStoredText(
        value.identityBoundAt !== undefined ? value.identityBoundAt : prior.identityBoundAt,
        100
      ),
      identitySource: normalizeIdentitySource(
        value.identitySource !== undefined ? value.identitySource : prior.identitySource
      )
    };
  }

  function writeProfileUnlocked(sheet, profile, rowNumber) {
    // Native Sheets Tables populate BOOLEAN columns with FALSE in every body
    // row, so getLastRow() is not a reliable way to find the next user row.
    var targetRow = rowNumber || firstBlankEmailRow(sheet);
    ensureRowCapacity(sheet, targetRow);
    sheet.getRange(targetRow, 1, 1, COLUMNS.length).setValues([profileToRow(profile)]);
    profile._rowNumber = targetRow;
    return profile;
  }

  function legacyProfileKey(email) {
    return PMS.CONFIG.PROFILE_PROPERTY_PREFIX + PMS.Util.hashText(email).slice(0, 32);
  }

  function legacyProfiles() {
    var properties = PropertiesService.getScriptProperties().getProperties();
    var prefix = PMS.CONFIG.PROFILE_PROPERTY_PREFIX;
    var profiles = [];
    Object.keys(properties).forEach(function (key) {
      if (key.indexOf(prefix) !== 0) return;
      var parsed;
      try {
        parsed = JSON.parse(properties[key]);
      } catch (error) {
        console.warn('Skipping invalid legacy PMS profile ' + key + ': ' + error.message);
        return;
      }
      var email;
      try {
        email = normalizeAndValidateEmail(parsed.email);
      } catch (error) {
        console.warn('Skipping legacy PMS profile with an invalid email: ' + key);
        return;
      }
      if (key !== legacyProfileKey(email)) {
        console.warn('Skipping legacy PMS profile stored under an unexpected key: ' + key);
        return;
      }
      var section = normalizeSection(parsed.section, false);
      if (parsed.section && !section) {
        console.warn('Skipping legacy PMS profile with an invalid section: ' + email);
        return;
      }
      var timestamp = PMS.Util.nowIso();
      var admin = isConfiguredAdmin(email);
      profiles.push({
        email: email,
        name: cleanStoredText(parsed.name, 250) || displayNameFromEmail(email),
        section: section,
        role: admin ? 'ADMIN' : 'TECHNICIAN',
        isAdmin: admin,
        active: parsed.active !== false,
        registeredAt: cleanStoredText(parsed.registeredAt, 100),
        createdAt: cleanStoredText(parsed.createdAt || parsed.registeredAt, 100) || timestamp,
        updatedAt: cleanStoredText(parsed.updatedAt, 100) || timestamp,
        lastLoginAt: cleanStoredText(parsed.lastLoginAt, 100),
        updatedBy: cleanStoredText(parsed.updatedBy, 320),
        identityKeyHash: normalizeIdentityHash(parsed.identityKeyHash, false),
        identityBoundAt: cleanStoredText(parsed.identityBoundAt, 100),
        identitySource: 'LEGACY_MIGRATION'
      });
    });
    return profiles;
  }

  function migrateLegacyProfilesUnlocked() {
    var sheet = usersSheet(true);
    var existing = {};
    allProfilesUnlocked(sheet).forEach(function (profile) { existing[profile.email] = profile; });
    var profilesToMigrate = [];
    legacyProfiles().forEach(function (profile) {
      if (existing[profile.email]) return;
      existing[profile.email] = profile;
      profilesToMigrate.push(profile);
    });
    profilesToMigrate.forEach(function (profile) {
      writeProfileUnlocked(sheet, profile, 0);
    });
    return { migrated: profilesToMigrate.length, sheetName: SHEET_NAME };
  }

  function ensureLegacyMigration() {
    var propertyStore = PropertiesService.getScriptProperties();
    if (propertyStore.getProperty(MIGRATION_PROPERTY)) {
      if (!usersSheet(false)) {
        PMS.Util.fail(
          'The PMS Users sheet is missing after user migration. Ask an administrator to restore it.',
          'DATA_INTEGRITY_ERROR'
        );
      }
      return { migrated: 0, sheetName: SHEET_NAME, status: 'EXISTS' };
    }
    return withScriptLock(function () {
      if (propertyStore.getProperty(MIGRATION_PROPERTY)) {
        if (!usersSheet(false)) {
          PMS.Util.fail(
            'The PMS Users sheet is missing after user migration. Ask an administrator to restore it.',
            'DATA_INTEGRITY_ERROR'
          );
        }
        return { migrated: 0, sheetName: SHEET_NAME, status: 'EXISTS' };
      }
      var result = migrateLegacyProfilesUnlocked();
      propertyStore.setProperty(MIGRATION_PROPERTY, JSON.stringify({
        completedAt: PMS.Util.nowIso(),
        migrated: result.migrated
      }));
      result.status = 'CREATED';
      return result;
    });
  }

  function update(emailValue, mutator) {
    var email = normalizeAndValidateEmail(emailValue);
    ensureLegacyMigration();
    return withScriptLock(function () {
      var sheet = usersSheet(true);
      var existing = findByEmailUnlocked(sheet, email);
      var draft = existing ? Object.assign({}, existing) : null;
      var changed = mutator(draft);
      if (changed === undefined) return existing;
      if (!changed) return null;
      changed.email = email;
      var normalized = normalizeForWrite(changed, existing);
      return writeProfileUnlocked(sheet, normalized, existing ? existing._rowNumber : 0);
    });
  }

  function upsert(profile) {
    if (!profile || !profile.email) {
      PMS.Util.fail('A user email is required.', 'VALIDATION_ERROR');
    }
    return update(profile.email, function (existing) {
      return Object.assign({}, existing || {}, profile);
    });
  }

  function findByEmail(emailValue) {
    var email = normalizeAndValidateEmail(emailValue);
    ensureLegacyMigration();
    return findByEmailUnlocked(usersSheet(false), email);
  }

  function listProfiles() {
    ensureLegacyMigration();
    return allProfilesUnlocked(usersSheet(false));
  }

  function touchLogin(email, access) {
    var details = access || {};
    var timestamp = PMS.Util.nowIso();
    var identityHash = normalizeIdentityHash(details.identityKeyHash, false);
    var source = normalizeIdentitySource(details.identitySource);
    return update(email, function (existing) {
      if (!existing || !existing.active) return undefined;
      var sameHash = !identityHash || existing.identityKeyHash === identityHash;
      var sameSource = !source || existing.identitySource === source;
      var priorLogin = Date.parse(existing.lastLoginAt || '');
      var loginAge = Date.now() - priorLogin;
      if (sameHash && sameSource && Number.isFinite(priorLogin) &&
          loginAge >= 0 && loginAge < LAST_LOGIN_WRITE_INTERVAL_MS) {
        return undefined;
      }
      existing.lastLoginAt = timestamp;
      if (source) existing.identitySource = source;
      if (identityHash) {
        if (existing.identityKeyHash !== identityHash) existing.identityBoundAt = timestamp;
        existing.identityKeyHash = identityHash;
      }
      return existing;
    });
  }

  function migrateLegacyProfiles() {
    return ensureLegacyMigration();
  }

  return {
    ensureSheet: function () {
      ensureLegacyMigration();
      return usersSheet(true);
    },
    migrateLegacyProfiles: migrateLegacyProfiles,
    findByEmail: findByEmail,
    listProfiles: listProfiles,
    upsert: upsert,
    update: update,
    touchLogin: touchLogin,
    sheetName: function () { return SHEET_NAME; },
    columns: function () { return COLUMNS.slice(); }
  };
})();
