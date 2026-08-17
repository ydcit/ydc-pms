var PMS = PMS || {};

/**
 * Findings tickets.
 *
 * A maintenance record records what was found at a point in time. A ticket
 * tracks whether that finding was actually fixed, which is a different
 * lifecycle: it outlives the cycle, it is worked on by whoever is available,
 * and it needs a defensible history of who changed what and why.
 *
 * Two sheets back this:
 *   PMS Tickets     one row per ticket, always the current state
 *   PMS Ticket Log  append-only, one row per change, never rewritten
 *
 * The log is the record of truth for history. Ticket rows carry a denormalised
 * copy of the latest actor and remark so the list view does not have to read the
 * log for every row.
 *
 * Nothing in this file may touch PMS.CONFIG or PMS.Util at load time. Apps
 * Script evaluates project files alphabetically, so this module is evaluated
 * before PmsUtils and PmsValidation exist.
 */
PMS.Tickets = (function () {
  var TICKET_PRESENTATION_PROPERTY = 'PMS_TICKETS_PRESENTATION_V1';
  var LOG_PRESENTATION_PROPERTY = 'PMS_TICKET_LOG_PRESENTATION_V1';
  var LOCK_TIMEOUT_MS = 30000;
  var REMARKS_MIN_LENGTH = 3;
  var REMARKS_MAX_LENGTH = 2000;
  var TEXT_MAX_LENGTH = 4000;

  // "All" still needs a ceiling. google.script.run fails silently on an
  // oversized response, so the row count is capped and the caller is told.
  var LIST_ALL_CAP = 1000;

  var STATUSES = Object.freeze(['OPEN', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CANCELLED']);
  // Statuses that still need someone's attention. Used for the dashboard count
  // and the default filter, so "for fixing" is answerable at a glance.
  var ACTIVE_STATUSES = Object.freeze(['OPEN', 'IN_PROGRESS', 'ON_HOLD']);
  var CLOSED_STATUSES = Object.freeze(['RESOLVED', 'CANCELLED']);
  var PRIORITIES = Object.freeze(['LOW', 'MEDIUM', 'HIGH']);
  var ACTIONS = Object.freeze(['CREATED', 'STATUS_CHANGED', 'COMMENT']);

  var TICKET_COLUMNS = Object.freeze([
    Object.freeze({ key: 'ticketId', label: 'Ticket ID' }),
    Object.freeze({ key: 'status', label: 'Status' }),
    Object.freeze({ key: 'priority', label: 'Priority' }),
    Object.freeze({ key: 'section', label: 'IT Section' }),
    Object.freeze({ key: 'assetTag', label: 'Asset Tag' }),
    Object.freeze({ key: 'location', label: 'Location' }),
    Object.freeze({ key: 'summary', label: 'Summary' }),
    Object.freeze({ key: 'findings', label: 'Findings' }),
    Object.freeze({ key: 'actionRequired', label: 'Action Required' }),
    Object.freeze({ key: 'sourceRecordId', label: 'Source Record ID' }),
    Object.freeze({ key: 'cycleId', label: 'Cycle ID' }),
    Object.freeze({ key: 'maintenanceYear', label: 'Maintenance Year' }),
    Object.freeze({ key: 'createdAt', label: 'Created At' }),
    Object.freeze({ key: 'createdBy', label: 'Created By' }),
    Object.freeze({ key: 'createdByName', label: 'Created By Name' }),
    Object.freeze({ key: 'updatedAt', label: 'Updated At' }),
    Object.freeze({ key: 'updatedBy', label: 'Updated By' }),
    Object.freeze({ key: 'updatedByName', label: 'Updated By Name' }),
    Object.freeze({ key: 'lastAction', label: 'Last Action' }),
    Object.freeze({ key: 'lastRemarks', label: 'Last Remarks' }),
    Object.freeze({ key: 'resolvedAt', label: 'Resolved At' }),
    Object.freeze({ key: 'resolvedBy', label: 'Resolved By' }),
    Object.freeze({ key: 'changeCount', label: 'Change Count' })
  ]);

  var LOG_COLUMNS = Object.freeze([
    Object.freeze({ key: 'logId', label: 'Log ID' }),
    Object.freeze({ key: 'ticketId', label: 'Ticket ID' }),
    Object.freeze({ key: 'changedAt', label: 'Changed At' }),
    Object.freeze({ key: 'changedBy', label: 'Changed By' }),
    Object.freeze({ key: 'changedByName', label: 'Changed By Name' }),
    Object.freeze({ key: 'action', label: 'Action' }),
    Object.freeze({ key: 'fromStatus', label: 'From Status' }),
    Object.freeze({ key: 'toStatus', label: 'To Status' }),
    Object.freeze({ key: 'remarks', label: 'Remarks' })
  ]);

  /* ---------------------------------------------------------------- sheets */

  function spreadsheet() {
    return SpreadsheetApp.openById(PMS.CONFIG.SPREADSHEET_ID);
  }

  function columnNumber(columns, key) {
    for (var index = 0; index < columns.length; index += 1) {
      if (columns[index].key === key) return index + 1;
    }
    PMS.Util.fail('Unknown ticket column: ' + key, 'CONFIGURATION_ERROR');
  }

  function labelsOf(columns) {
    return columns.map(function (column) { return column.label; });
  }

  function initializeSheet(sheet, columns, presentationProperty) {
    if (sheet.getMaxColumns() < columns.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), columns.length - sheet.getMaxColumns());
    }
    sheet.getRange(1, 1, 1, columns.length).setValues([labelsOf(columns)]);
    sheet.setFrozenRows(1);
    sheet.setFrozenColumns(1);
    sheet.getRange(1, 1, 1, columns.length)
      .setBackground('#f1f3f4')
      .setFontColor('#202124')
      .setFontWeight('bold')
      .setVerticalAlignment('middle')
      .setWrap(true);
    sheet.setRowHeight(1, 42);
    sheet.setColumnWidths(1, columns.length, 150);
    sheet.setTabColor('#b45309');
    applyPresentation(sheet, columns, presentationProperty);
  }

  /**
   * Presentation is gated on a property so the formatting calls, which are the
   * expensive part, run once rather than on every read.
   */
  function applyPresentation(sheet, columns, presentationProperty) {
    var propertyStore = PropertiesService.getScriptProperties();
    var signature = String(sheet.getSheetId()) + ':' + columns.length;
    if (propertyStore.getProperty(presentationProperty) === signature) return;

    var rowCount = Math.max(1, sheet.getMaxRows() - 1);
    if (columns === TICKET_COLUMNS) {
      sheet.setColumnWidth(columnNumber(columns, 'ticketId'), 140);
      sheet.setColumnWidth(columnNumber(columns, 'summary'), 320);
      sheet.setColumnWidth(columnNumber(columns, 'findings'), 380);
      sheet.setColumnWidth(columnNumber(columns, 'actionRequired'), 320);
      sheet.setColumnWidth(columnNumber(columns, 'lastRemarks'), 320);
      sheet.getRange(2, columnNumber(columns, 'status'), rowCount, 1).setDataValidation(
        SpreadsheetApp.newDataValidation().requireValueInList(STATUSES.slice(), true)
          .setAllowInvalid(false).build()
      );
      sheet.getRange(2, columnNumber(columns, 'priority'), rowCount, 1).setDataValidation(
        SpreadsheetApp.newDataValidation().requireValueInList(PRIORITIES.slice(), true)
          .setAllowInvalid(false).build()
      );
    } else {
      sheet.setColumnWidth(columnNumber(columns, 'remarks'), 420);
    }
    // Text format everywhere: ticket ids, ISO timestamps and asset tags must not
    // be reinterpreted as numbers or dates by Sheets.
    columns.forEach(function (column, index) {
      sheet.getRange(2, index + 1, rowCount, 1).setNumberFormat('@');
    });
    if (!sheet.getFilter()) {
      sheet.getRange(1, 1, sheet.getMaxRows(), columns.length).createFilter();
    }
    propertyStore.setProperty(presentationProperty, signature);
  }

  function verifyHeaders(sheet, columns) {
    if (sheet.getMaxColumns() < columns.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), columns.length - sheet.getMaxColumns());
    }
    var expected = labelsOf(columns);
    var current = sheet.getRange(1, 1, 1, columns.length).getDisplayValues()[0];
    if (current.every(function (value) { return !value; })) {
      initializeSheet(sheet, columns, sheet.getName() === ticketSheetName()
        ? TICKET_PRESENTATION_PROPERTY
        : LOG_PRESENTATION_PROPERTY);
      return;
    }
    var mismatches = [];
    expected.forEach(function (label, index) {
      if (current[index] !== label) mismatches.push((index + 1) + ': ' + current[index] + ' != ' + label);
    });
    if (mismatches.length) {
      PMS.Util.fail(
        sheet.getName() + ' header mismatch. Refusing to use the sheet: ' + mismatches.slice(0, 5).join('; '),
        'SCHEMA_MISMATCH'
      );
    }
  }

  function ticketSheetName() {
    return PMS.CONFIG.TICKET_SHEET;
  }

  function logSheetName() {
    return PMS.CONFIG.TICKET_LOG_SHEET;
  }

  function sheetFor(name, columns, presentationProperty, createIfMissing) {
    var book = spreadsheet();
    var sheet = book.getSheetByName(name);
    if (!sheet && createIfMissing) {
      sheet = book.insertSheet(name);
      initializeSheet(sheet, columns, presentationProperty);
      return sheet;
    }
    if (sheet) verifyHeaders(sheet, columns);
    return sheet;
  }

  function ticketSheet(createIfMissing) {
    return sheetFor(ticketSheetName(), TICKET_COLUMNS, TICKET_PRESENTATION_PROPERTY, createIfMissing);
  }

  function logSheet(createIfMissing) {
    return sheetFor(logSheetName(), LOG_COLUMNS, LOG_PRESENTATION_PROPERTY, createIfMissing);
  }

  function ensureSheets() {
    return {
      tickets: ticketSheet(true).getName(),
      log: logSheet(true).getName()
    };
  }

  function withScriptLock(callback) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
      PMS.Util.fail('Tickets are busy. Please try again.', 'BUSY');
    }
    try {
      return callback();
    } finally {
      lock.releaseLock();
    }
  }

  /* ------------------------------------------------------------ normalising */

  function cellText(value) {
    if (value === undefined || value === null) return '';
    if (Object.prototype.toString.call(value) === '[object Date]') {
      return Utilities.formatDate(value, PMS.CONFIG.TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
    }
    return String(value).trim();
  }

  function normalizeStatus(value, fallback) {
    var text = PMS.Util.cleanText(value, 30).toUpperCase().replace(/[\s-]+/g, '_');
    return STATUSES.indexOf(text) >= 0 ? text : (fallback || '');
  }

  function normalizePriority(value, fallback) {
    var text = PMS.Util.cleanText(value, 20).toUpperCase();
    return PRIORITIES.indexOf(text) >= 0 ? text : (fallback || 'MEDIUM');
  }

  /**
   * Findings and the required action are mandatory when filing. A ticket exists
   * to get something fixed, so a row that states neither what is wrong nor what
   * has to happen cannot be worked or closed by anyone else.
   *
   * Opening remarks are deliberately NOT covered by this: the first history
   * entry can stand on the findings alone. Remarks only become mandatory once a
   * ticket starts moving, which is what requireRemarks below enforces.
   */
  function requireTicketText(value, label, fallback) {
    var text = PMS.Util.cleanText(value, TEXT_MAX_LENGTH) || PMS.Util.cleanText(fallback, TEXT_MAX_LENGTH);
    if (!text) {
      PMS.Util.fail(label + ' is required to file a ticket.', 'VALIDATION_ERROR');
    }
    return text;
  }

  /**
   * Remarks are mandatory on every change. This is the whole point of the audit
   * trail: a status that moved with no stated reason is not auditable.
   */
  function requireRemarks(value) {
    var text = PMS.Util.cleanText(value, REMARKS_MAX_LENGTH);
    if (text.length < REMARKS_MIN_LENGTH) {
      PMS.Util.fail(
        'Remarks are required when updating a ticket. Describe what changed in at least ' +
          REMARKS_MIN_LENGTH + ' characters.',
        'VALIDATION_ERROR'
      );
    }
    return text;
  }

  function rowToTicket(row, rowNumber) {
    var ticket = { _rowNumber: rowNumber };
    TICKET_COLUMNS.forEach(function (column, index) {
      ticket[column.key] = cellText(row[index]);
    });
    ticket.status = normalizeStatus(ticket.status, 'OPEN');
    ticket.priority = normalizePriority(ticket.priority, 'MEDIUM');
    ticket.changeCount = Number(ticket.changeCount) || 0;
    ticket.isActive = ACTIVE_STATUSES.indexOf(ticket.status) >= 0;
    return ticket;
  }

  function ticketToRow(ticket) {
    return TICKET_COLUMNS.map(function (column) {
      var value = ticket[column.key];
      if (value === undefined || value === null) return '';
      return PMS.Util.safeCellText(value, TEXT_MAX_LENGTH);
    });
  }

  function logToRow(entry) {
    return LOG_COLUMNS.map(function (column) {
      var value = entry[column.key];
      if (value === undefined || value === null) return '';
      return PMS.Util.safeCellText(value, TEXT_MAX_LENGTH);
    });
  }

  /*
    Per-execution memo for the two sheet reads.

    A write request now builds its own response: the changed ticket, its history,
    and the refreshed list. Without this memo that would re-read the ticket sheet
    for the detail and again for the list, on top of the read the write itself
    needed. Every write invalidates it, so a read after a write is never stale.
  */
  var readMemo = { tickets: null, log: null };

  function invalidateReadMemo() {
    readMemo.tickets = null;
    readMemo.log = null;
  }

  function readTickets() {
    if (readMemo.tickets) return readMemo.tickets;
    var sheet = ticketSheet(false);
    if (!sheet || sheet.getLastRow() < 2) {
      readMemo.tickets = [];
      return readMemo.tickets;
    }
    var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, TICKET_COLUMNS.length).getValues();
    var tickets = [];
    values.forEach(function (row, index) {
      if (!cellText(row[0])) return;
      tickets.push(rowToTicket(row, index + 2));
    });
    readMemo.tickets = tickets;
    return tickets;
  }

  function readLog() {
    if (readMemo.log) return readMemo.log;
    var sheet = logSheet(false);
    if (!sheet || sheet.getLastRow() < 2) {
      readMemo.log = [];
      return readMemo.log;
    }
    var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, LOG_COLUMNS.length).getValues();
    var entries = [];
    values.forEach(function (row, index) {
      if (!cellText(row[1])) return;
      var entry = { _rowNumber: index + 2 };
      LOG_COLUMNS.forEach(function (column, position) {
        entry[column.key] = cellText(row[position]);
      });
      entries.push(entry);
    });
    readMemo.log = entries;
    return entries;
  }

  /* ------------------------------------------------------------------ write */

  function nextTicketId(sheet, year) {
    var prefix = 'TKT-' + year + '-';
    var highest = 0;
    if (sheet.getLastRow() >= 2) {
      var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues();
      ids.forEach(function (row) {
        var id = String(row[0] || '').trim();
        if (id.indexOf(prefix) !== 0) return;
        var sequence = Number(id.slice(prefix.length));
        if (Number.isFinite(sequence) && sequence > highest) highest = sequence;
      });
    }
    return prefix + String(highest + 1).padStart(4, '0');
  }

  /**
   * Appends one history entry and stamps its id.
   *
   * The id is a per-ticket sequence rather than a hash of the change. A hash of
   * (ticket, timestamp, actor) collides when the same person makes two changes
   * to the same ticket inside one second, and timestamps only carry second
   * resolution. Counting existing entries under the caller's lock cannot
   * collide, and the result reads in order: TKT-2026-0001-003.
   */
  function appendLog(sheet, entry) {
    var sequence = 1;
    if (sheet.getLastRow() >= 2) {
      var existing = sheet
        .getRange(2, columnNumber(LOG_COLUMNS, 'ticketId'), sheet.getLastRow() - 1, 1)
        .getDisplayValues();
      existing.forEach(function (row) {
        if (String(row[0] || '').trim() === entry.ticketId) sequence += 1;
      });
    }
    entry.logId = entry.ticketId + '-' + String(sequence).padStart(3, '0');
    var targetRow = Math.max(sheet.getLastRow() + 1, 2);
    sheet.getRange(targetRow, 1, 1, LOG_COLUMNS.length).setValues([logToRow(entry)]);
    return targetRow;
  }

  /**
   * Derives the ticket subject from a maintenance record so the server, not the
   * browser, decides which asset and section a ticket belongs to.
   */
  function subjectFromRecord(recordId) {
    var record = PMS.Records.findByRecordId(recordId);
    if (!record) {
      PMS.Util.fail('The maintenance record for this ticket was not found.', 'NOT_FOUND');
    }
    var observed = cellText(record.observedLocation);
    var master = cellText(record.masterLocation);
    return {
      sourceRecordId: cellText(record.recordId),
      assetTag: PMS.Util.normalizeAssetTag(record.assetTag),
      section: cellText(record.itSection),
      location: observed || master,
      cycleId: cellText(record.cycleId),
      maintenanceYear: cellText(record.maintenanceYear),
      findings: cellText(record.assetFindings),
      actionRequired: cellText(record.recommendation)
    };
  }

  function create(context, payload) {
    var request = payload && typeof payload === 'object' ? payload : {};
    var actor = PMS.Util.normalizeEmail(context.email);
    var actorName = PMS.Util.cleanText(context.name, 250) || actor;
    var sourceRecordId = PMS.Util.cleanText(request.sourceRecordId, 100);

    var subject = sourceRecordId ? subjectFromRecord(sourceRecordId) : {
      sourceRecordId: '',
      assetTag: PMS.Util.normalizeAssetTag(request.assetTag),
      section: PMS.Util.section(request.section || context.section).key,
      location: PMS.Util.cleanText(request.location, 500),
      cycleId: '',
      maintenanceYear: '',
      findings: '',
      actionRequired: ''
    };
    if (!subject.assetTag) {
      PMS.Util.fail('An asset tag is required to open a ticket.', 'VALIDATION_ERROR');
    }
    // Validate the section even when it came from a record, so a malformed row
    // cannot introduce an unknown section through the back door.
    subject.section = PMS.Util.section(subject.section).key;

    // A linked record can supply both, so the fallback is applied before the
    // requirement is tested rather than after.
    var findings = requireTicketText(request.findings, 'Findings', subject.findings);
    var actionRequired = requireTicketText(request.actionRequired, 'The required action', subject.actionRequired);
    var summary = PMS.Util.cleanText(request.summary, 300) || findings.slice(0, 140);
    var priority = normalizePriority(request.priority, 'MEDIUM');
    // The filer chooses the starting status: work is sometimes already under way
    // by the time anyone writes the ticket down.
    var status = normalizeStatus(request.status, 'OPEN');
    var openingRemarks = PMS.Util.cleanText(request.remarks, REMARKS_MAX_LENGTH) ||
      ('Ticket filed from ' + (subject.sourceRecordId || 'a manual report') + '.');

    var outcome = withScriptLock(function () {
      var tickets = ticketSheet(true);
      var log = logSheet(true);
      var timestamp = PMS.Util.nowIso();
      var year = PMS.Util.currentCycle().year;
      var ticketId = nextTicketId(tickets, year);

      var closedOnArrival = CLOSED_STATUSES.indexOf(status) >= 0;
      var ticket = {
        ticketId: ticketId,
        status: status,
        priority: priority,
        section: subject.section,
        assetTag: subject.assetTag,
        location: subject.location,
        summary: summary,
        findings: findings,
        actionRequired: actionRequired,
        sourceRecordId: subject.sourceRecordId,
        cycleId: subject.cycleId,
        maintenanceYear: subject.maintenanceYear,
        createdAt: timestamp,
        createdBy: actor,
        createdByName: actorName,
        updatedAt: timestamp,
        updatedBy: actor,
        updatedByName: actorName,
        lastAction: 'CREATED',
        lastRemarks: openingRemarks,
        // Filing straight into Resolved or Cancelled is a legitimate case: the
        // fix happened during maintenance and the ticket is the paper trail.
        resolvedAt: closedOnArrival ? timestamp : '',
        resolvedBy: closedOnArrival ? actor : '',
        changeCount: 1
      };
      var targetRow = Math.max(tickets.getLastRow() + 1, 2);
      tickets.getRange(targetRow, 1, 1, TICKET_COLUMNS.length).setValues([ticketToRow(ticket)]);

      appendLog(log, {
        ticketId: ticketId,
        changedAt: timestamp,
        changedBy: actor,
        changedByName: actorName,
        action: 'CREATED',
        fromStatus: '',
        toStatus: status,
        remarks: openingRemarks
      });

      invalidateReadMemo();
      ticket._rowNumber = targetRow;
      ticket.isActive = ACTIVE_STATUSES.indexOf(status) >= 0;
      // A ticket against an already-completed record flips its tracker cell from
      // COMPLETED to the repair state. Filing from a draft is a no-op here; the
      // completion write picks the value up instead.
      var tracker = syncTrackerForRecord(ticket.sourceRecordId);
      return { ok: true, ticket: ticket, tracker: tracker };
    });

    outcome.notification = announce(outcome, {
      action: 'CREATED',
      remarks: openingRemarks,
      actorName: actorName
    });
    return outcome;
  }

  function findTicketRow(sheet, ticketId) {
    if (!sheet || sheet.getLastRow() < 2) return 0;
    var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues();
    var matches = [];
    ids.forEach(function (row, index) {
      if (String(row[0] || '').trim() === ticketId) matches.push(index + 2);
    });
    if (matches.length > 1) {
      PMS.Util.fail('Duplicate rows exist for ticket ' + ticketId + '.', 'DATA_INTEGRITY_ERROR');
    }
    return matches.length ? matches[0] : 0;
  }

  /**
   * Records a change against a ticket.
   *
   * Any rostered user may do this by design: fixing an asset is cross-team work
   * and whoever picks it up must be able to move it along. Accountability comes
   * from the log, not from restricting the action.
   *
   * A submission that repeats the current status is kept as a COMMENT rather
   * than rejected, so progress notes are possible without inventing a status.
   */
  function updateStatus(context, payload) {
    var request = payload && typeof payload === 'object' ? payload : {};
    var ticketId = PMS.Util.cleanText(request.ticketId, 100);
    if (!ticketId) PMS.Util.fail('A ticket is required.', 'VALIDATION_ERROR');
    var remarks = requireRemarks(request.remarks);
    var actor = PMS.Util.normalizeEmail(context.email);
    var actorName = PMS.Util.cleanText(context.name, 250) || actor;

    var outcome = withScriptLock(function () {
      var tickets = ticketSheet(true);
      var log = logSheet(true);
      var rowNumber = findTicketRow(tickets, ticketId);
      if (!rowNumber) PMS.Util.fail('Ticket ' + ticketId + ' was not found.', 'NOT_FOUND');

      var existing = rowToTicket(
        tickets.getRange(rowNumber, 1, 1, TICKET_COLUMNS.length).getValues()[0],
        rowNumber
      );
      var nextStatus = normalizeStatus(request.status, existing.status);
      var nextPriority = request.priority === undefined
        ? existing.priority
        : normalizePriority(request.priority, existing.priority);
      var statusChanged = nextStatus !== existing.status;
      var action = statusChanged ? 'STATUS_CHANGED' : 'COMMENT';
      var timestamp = PMS.Util.nowIso();

      var updated = {};
      TICKET_COLUMNS.forEach(function (column) { updated[column.key] = existing[column.key]; });
      updated.status = nextStatus;
      updated.priority = nextPriority;
      updated.updatedAt = timestamp;
      updated.updatedBy = actor;
      updated.updatedByName = actorName;
      updated.lastAction = action;
      updated.lastRemarks = remarks;
      updated.changeCount = (Number(existing.changeCount) || 0) + 1;
      if (CLOSED_STATUSES.indexOf(nextStatus) >= 0) {
        // Stamp only on the transition, so reopening and closing again does not
        // lose the original closure time until it actually changes.
        updated.resolvedAt = statusChanged || !existing.resolvedAt ? timestamp : existing.resolvedAt;
        updated.resolvedBy = statusChanged || !existing.resolvedBy ? actor : existing.resolvedBy;
      } else {
        updated.resolvedAt = '';
        updated.resolvedBy = '';
      }
      tickets.getRange(rowNumber, 1, 1, TICKET_COLUMNS.length).setValues([ticketToRow(updated)]);

      appendLog(log, {
        ticketId: ticketId,
        changedAt: timestamp,
        changedBy: actor,
        changedByName: actorName,
        action: action,
        fromStatus: existing.status,
        toStatus: nextStatus,
        remarks: remarks
      });

      invalidateReadMemo();
      updated._rowNumber = rowNumber;
      updated.isActive = ACTIVE_STATUSES.indexOf(nextStatus) >= 0;
      /*
        Keeps the section tracker sheet showing the live repair state, but only
        when the cell could actually differ. A closed-to-closed move such as
        RESOLVED to CANCELLED maps to COMPLETED either way, and a closed ticket
        contributes nothing to the aggregate, so the cell cannot change and the
        record lookup plus tracker read are skipped entirely.
      */
      var cellCouldChange = statusChanged &&
        trackerValueForStatus(existing.status) !== trackerValueForStatus(nextStatus);
      var tracker = cellCouldChange ? syncTrackerForRecord(updated.sourceRecordId) : null;
      return {
        ok: true,
        ticket: updated,
        action: action,
        statusChanged: statusChanged,
        fromStatus: existing.status,
        tracker: tracker
      };
    });

    outcome.notification = announce(outcome, {
      action: outcome.action,
      fromStatus: outcome.fromStatus,
      remarks: remarks,
      actorName: actorName
    });
    return outcome;
  }

  /* ------------------------------------------------------------------- read */

  function boundedInteger(value, fallback, minimum, maximum) {
    var number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(minimum, Math.min(maximum, Math.floor(number)));
  }

  var SORTS = Object.freeze({
    updatedAt: ['updatedAt', 'ticketId'],
    createdAt: ['createdAt', 'ticketId'],
    ticketId: ['ticketId', 'createdAt'],
    status: ['status', 'updatedAt'],
    priority: ['priorityRank', 'updatedAt'],
    assetTag: ['assetTag', 'updatedAt'],
    section: ['section', 'updatedAt']
  });

  function comparator(sortKey, ascending) {
    var keys = SORTS[sortKey] || SORTS.updatedAt;
    var factor = ascending ? 1 : -1;
    return function (a, b) {
      for (var index = 0; index < keys.length; index += 1) {
        var key = keys[index];
        var left = a[key] === undefined ? '' : a[key];
        var right = b[key] === undefined ? '' : b[key];
        if (typeof left === 'number' || typeof right === 'number') {
          if (Number(left) !== Number(right)) return factor * (Number(left) - Number(right));
        } else if (String(left) !== String(right)) {
          return factor * String(left).localeCompare(String(right), undefined, {
            numeric: true, sensitivity: 'base'
          });
        }
      }
      return factor * (a._rowNumber - b._rowNumber);
    };
  }

  /** Visible tickets for the caller, before any user filter is applied. */
  function scopedTickets(context) {
    var restrictToSection = PMS.CONFIG.TICKET_VISIBILITY === 'OWN_SECTION' && !context.isAdmin;
    return readTickets().filter(function (ticket) {
      return restrictToSection ? ticket.section === context.section : true;
    });
  }

  function countByStatus(tickets) {
    var counts = {};
    STATUSES.forEach(function (status) { counts[status] = 0; });
    tickets.forEach(function (ticket) {
      if (counts[ticket.status] === undefined) counts[ticket.status] = 0;
      counts[ticket.status] += 1;
    });
    counts.ACTIVE = ACTIVE_STATUSES.reduce(function (total, status) {
      return total + (counts[status] || 0);
    }, 0);
    counts.TOTAL = tickets.length;
    return counts;
  }

  function list(context, options) {
    var request = options && typeof options === 'object' ? options : {};
    var scoped = scopedTickets(context);
    var counts = countByStatus(scoped);

    var sectionSet = {};
    scoped.forEach(function (ticket) {
      if (ticket.section) sectionSet[ticket.section] = true;
    });

    var status = PMS.Util.cleanText(request.status, 30).toUpperCase().replace(/[\s-]+/g, '_');
    var priority = PMS.Util.cleanText(request.priority, 20).toUpperCase();
    var section = PMS.Util.cleanText(request.section, 40).toUpperCase();
    var search = PMS.Util.cleanText(request.search, 120).toUpperCase();

    var filtered = scoped.filter(function (ticket) {
      // ACTIVE is a convenience bucket meaning "still needs attention".
      if (status === 'ACTIVE') {
        if (!ticket.isActive) return false;
      } else if (status && STATUSES.indexOf(status) >= 0) {
        if (ticket.status !== status) return false;
      }
      if (priority && ticket.priority !== priority) return false;
      if (section && ticket.section !== section) return false;
      if (!search) return true;
      return [
        ticket.ticketId, ticket.assetTag, ticket.location, ticket.summary,
        ticket.findings, ticket.createdByName, ticket.updatedByName, ticket.sourceRecordId
      ].join(' ').toUpperCase().indexOf(search) >= 0;
    });

    // Priority sorts by severity, not alphabetically: HIGH must lead.
    filtered.forEach(function (ticket) {
      ticket.priorityRank = PRIORITIES.indexOf(ticket.priority);
    });

    var sortKey = SORTS[PMS.Util.cleanText(request.sort, 40)] ? PMS.Util.cleanText(request.sort, 40) : 'updatedAt';
    var ascending = PMS.Util.cleanText(request.direction, 4).toUpperCase() === 'ASC';
    filtered.sort(comparator(sortKey, ascending));

    var showAll = PMS.Util.cleanText(request.pageSize, 8).toUpperCase() === 'ALL';
    var truncated = false;
    var pageSize;
    var page;
    var start;
    if (showAll) {
      truncated = filtered.length > LIST_ALL_CAP;
      pageSize = Math.max(1, Math.min(filtered.length || 1, LIST_ALL_CAP));
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
      scope: PMS.CONFIG.TICKET_VISIBILITY === 'OWN_SECTION' && !context.isAdmin
        ? 'OWN_SECTION'
        : 'ALL_SECTIONS',
      rows: filtered.slice(start, start + pageSize).map(function (ticket) {
        return {
          ticketId: ticket.ticketId,
          status: ticket.status,
          priority: ticket.priority,
          section: ticket.section,
          assetTag: ticket.assetTag,
          location: ticket.location,
          summary: ticket.summary,
          sourceRecordId: ticket.sourceRecordId,
          cycleId: ticket.cycleId,
          createdAt: ticket.createdAt,
          createdByName: ticket.createdByName,
          updatedAt: ticket.updatedAt,
          updatedByName: ticket.updatedByName,
          lastAction: ticket.lastAction,
          lastRemarks: ticket.lastRemarks,
          changeCount: ticket.changeCount,
          isActive: ticket.isActive
        };
      }),
      page: page,
      pageSize: pageSize,
      pageSizeMode: showAll ? 'ALL' : String(pageSize),
      totalPages: totalPages,
      total: filtered.length,
      totalInScope: scoped.length,
      rangeStart: filtered.length ? start + 1 : 0,
      rangeEnd: Math.min(start + pageSize, filtered.length),
      sort: sortKey,
      direction: ascending ? 'ASC' : 'DESC',
      truncated: truncated,
      cap: LIST_ALL_CAP,
      counts: counts,
      filters: {
        statuses: STATUSES.slice(),
        priorities: PRIORITIES.slice(),
        sections: Object.keys(sectionSet).sort()
      }
    };
  }

  /** A single ticket with its full change history, newest entry first. */
  function detail(context, ticketId) {
    var id = PMS.Util.cleanText(ticketId, 100);
    if (!id) PMS.Util.fail('A ticket is required.', 'VALIDATION_ERROR');
    var match = null;
    scopedTickets(context).forEach(function (ticket) {
      if (ticket.ticketId === id) match = ticket;
    });
    if (!match) PMS.Util.fail('Ticket ' + id + ' was not found.', 'NOT_FOUND');

    var history = readLog().filter(function (entry) {
      return entry.ticketId === id;
    }).sort(function (a, b) {
      if (a.changedAt !== b.changedAt) return b.changedAt.localeCompare(a.changedAt);
      return b._rowNumber - a._rowNumber;
    }).map(function (entry) {
      return {
        changedAt: entry.changedAt,
        changedBy: entry.changedBy,
        changedByName: entry.changedByName || entry.changedBy,
        action: entry.action,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        remarks: entry.remarks
      };
    });

    return { ok: true, ticket: match, history: history, statuses: STATUSES.slice(), priorities: PRIORITIES.slice() };
  }

  /** Cheap counts for the dashboard badge. */
  function summary(context) {
    return { ok: true, counts: countByStatus(scopedTickets(context)) };
  }

  /**
   * Attaches the changed ticket's history and the refreshed list to a write
   * result, so the browser needs one round trip per status change instead of
   * three. Both reads come out of the per-execution memo.
   *
   * A refresh failure is reported rather than thrown: the write already
   * succeeded, and the browser can fall back to fetching separately.
   */
  function withRefresh(context, result, listOptions) {
    var payload = result || {};
    try {
      var ticketId = payload.ticket ? payload.ticket.ticketId : '';
      if (ticketId) {
        var full = detail(context, ticketId);
        payload.ticket = full.ticket;
        payload.history = full.history;
        payload.statuses = full.statuses;
        payload.priorities = full.priorities;
      }
      payload.list = list(context, listOptions || {});
    } catch (error) {
      console.warn('The ticket refresh payload could not be built: ' + error.message);
      payload.refreshFailed = true;
    }
    return payload;
  }

  /* --------------------------------------------------- record interconnection */

  /**
   * Pushes the record's current repair state onto its tracker cycle cell.
   *
   * Best effort by design. The ticket and its log entry are already written and
   * are the audit record; a protected or unavailable tracker cell must not undo
   * them. The cell is recomputed from stored ticket state on every change, so a
   * failure here self-heals on the next one.
   *
   * PMS.Tracker also reads back into this module for the same value. Both
   * directions are runtime-only calls inside function bodies, which is required
   * because Apps Script evaluates PmsTickets before PmsTracker.
   */
  /**
   * Announces a ticket movement by email.
   *
   * Called after the script lock is released: sending mail takes long enough
   * that holding the lock across it would make concurrent updates queue behind
   * each other. Best effort, and tolerant of the module being absent, so neither
   * a mail failure nor a partial deployment can undo a committed ticket write.
   */
  function announce(outcome, event) {
    if (!PMS.Notify || !outcome || !outcome.ticket) return null;
    try {
      return PMS.Notify.ticketEvent({
        ticket: outcome.ticket,
        action: event.action,
        fromStatus: event.fromStatus || '',
        remarks: event.remarks || '',
        actorName: event.actorName || '',
        trackerStatus: outcome.tracker && outcome.tracker.status ? outcome.tracker.status : ''
      });
    } catch (error) {
      console.warn('Ticket notification failed for ' + outcome.ticket.ticketId + ': ' + error.message);
      return null;
    }
  }

  function syncTrackerForRecord(recordId) {
    var id = PMS.Util.cleanText(recordId, 100);
    if (!id) return null;
    try {
      var record = PMS.Records.findByRecordId(id);
      if (!record) return { ok: false, reason: 'RECORD_NOT_FOUND' };
      return PMS.Tracker.syncRepairStatus(record);
    } catch (error) {
      console.warn('Tracker repair status was not updated for ' + id + ': ' + error.message);
      return { ok: false, reason: 'WRITE_FAILED', error: error.message };
    }
  }

  /**
   * Tickets raised from one maintenance record.
   *
   * Deliberately unscoped by section: this answers "does this record have its
   * repair tracked", which the record's own owner and the tracker sheet both
   * need regardless of who filed the ticket.
   */
  function forRecord(recordId) {
    var id = PMS.Util.cleanText(recordId, 100);
    if (!id) return [];
    return readTickets().filter(function (ticket) {
      return ticket.sourceRecordId === id;
    }).map(function (ticket) {
      return {
        ticketId: ticket.ticketId,
        status: ticket.status,
        priority: ticket.priority,
        summary: ticket.summary,
        isActive: ticket.isActive,
        updatedAt: ticket.updatedAt
      };
    });
  }

  function hasForRecord(recordId) {
    return forRecord(recordId).length > 0;
  }

  /*
    Precedence when a record has several tickets: report the one needing the
    most attention. OPEN outranks IN_PROGRESS because nobody has picked it up
    yet, and ON_HOLD ranks last of the active states because it is waiting on
    something external.
  */
  var TRACKER_STATUS_PRECEDENCE = Object.freeze(['OPEN', 'IN_PROGRESS', 'ON_HOLD']);

  /** The cell text one ticket status maps to, ignoring any siblings. */
  function trackerValueForStatus(status) {
    return PMS.CONFIG.TRACKER_REPAIR_VALUES[status] || PMS.CONFIG.TRACKER_COMPLETED_VALUE;
  }

  /**
   * The text the tracker cycle cell should carry for a record.
   *
   * A pure function of what is stored, so the completion write, a later ticket
   * change, and a reconciliation retry days later all produce the same value.
   * No outstanding repair means the ordinary COMPLETED value.
   */
  function trackerStatusForRecord(recordId) {
    var tickets = forRecord(recordId);
    for (var index = 0; index < TRACKER_STATUS_PRECEDENCE.length; index += 1) {
      var status = TRACKER_STATUS_PRECEDENCE[index];
      var match = tickets.some(function (ticket) { return ticket.status === status; });
      if (match) return PMS.CONFIG.TRACKER_REPAIR_VALUES[status];
    }
    return PMS.CONFIG.TRACKER_COMPLETED_VALUE;
  }

  return {
    ensureSheets: ensureSheets,
    statuses: function () { return STATUSES.slice(); },
    activeStatuses: function () { return ACTIVE_STATUSES.slice(); },
    priorities: function () { return PRIORITIES.slice(); },
    actions: function () { return ACTIONS.slice(); },
    ticketColumns: function () { return TICKET_COLUMNS.slice(); },
    logColumns: function () { return LOG_COLUMNS.slice(); },
    create: create,
    updateStatus: updateStatus,
    list: list,
    detail: detail,
    summary: summary,
    withRefresh: withRefresh,
    forRecord: forRecord,
    hasForRecord: hasForRecord,
    trackerStatusForRecord: trackerStatusForRecord
  };
})();
