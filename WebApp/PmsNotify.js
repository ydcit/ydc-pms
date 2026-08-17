var PMS = PMS || {};

/**
 * Email notifications for completed maintenance and ticket movement.
 *
 * Recipients live in a managed sheet so the distribution list can change without
 * a deployment, with per-recipient switches for the two event families and an
 * optional section filter.
 *
 * Two rules shape everything here:
 *
 *   1. A notification must never break the operation that triggered it. Every
 *      entry point is best effort: failures are caught, warned about, and
 *      returned as a result object rather than thrown. Somebody's maintenance
 *      record is more important than an email.
 *   2. Mail is sent outside the script lock. Sending takes noticeable time and
 *      holding the lock across it would make concurrent ticket updates queue
 *      behind each other.
 *
 * Mail is sent by the account that deployed the web app, because the manifest
 * uses executeAs USER_DEPLOYING, and it counts against that account's daily
 * quota. Nothing in this file may touch PMS.CONFIG or PMS.Util at load time:
 * Apps Script evaluates project files alphabetically, so this module is
 * evaluated before PmsRecords, PmsTickets, PmsUsers and PmsUtils.
 */
PMS.Notify = (function () {
  var PRESENTATION_PROPERTY = 'PMS_NOTIFY_PRESENTATION_V1';
  var LOCK_TIMEOUT_MS = 30000;
  var MAX_BODY_FIELD_LENGTH = 4000;
  // How many empty rows past the last recipient get ready-made checkboxes.
  var CHECKBOX_BUFFER_ROWS = 25;

  // Event keys are also the recipient sheet's opt-in column keys.
  var EVENT_PMS_COMPLETED = 'pmsCompleted';
  var EVENT_TICKET = 'ticketEvents';

  var COLUMNS = Object.freeze([
    Object.freeze({ key: 'email', label: 'Email' }),
    Object.freeze({ key: 'name', label: 'Name' }),
    Object.freeze({ key: 'sections', label: 'Sections' }),
    Object.freeze({ key: 'pmsCompleted', label: 'PMS Completed Email' }),
    Object.freeze({ key: 'ticketEvents', label: 'Ticket Update Email' }),
    Object.freeze({ key: 'active', label: 'Active' }),
    Object.freeze({ key: 'notes', label: 'Notes' })
  ]);

  /* ---------------------------------------------------------------- sheet */

  function sheetName() {
    return PMS.CONFIG.NOTIFY_SHEET;
  }

  function columnNumber(key) {
    for (var index = 0; index < COLUMNS.length; index += 1) {
      if (COLUMNS[index].key === key) return index + 1;
    }
    PMS.Util.fail('Unknown notification recipient column: ' + key, 'CONFIGURATION_ERROR');
  }

  function spreadsheet() {
    return SpreadsheetApp.openById(PMS.CONFIG.SPREADSHEET_ID);
  }

  function notifySheet(createIfMissing) {
    var book = spreadsheet();
    var sheet = book.getSheetByName(sheetName());
    if (!sheet && createIfMissing) {
      sheet = book.insertSheet(sheetName());
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
    applyPresentation(sheet);
    PropertiesService.getScriptProperties().setProperty(PRESENTATION_PROPERTY, presentationSignature(sheet));
  }

  function presentationSignature(sheet) {
    return String(sheet.getSheetId()) + ':' + COLUMNS.length;
  }

  function applyPresentation(sheet) {
    sheet.setFrozenRows(1);
    sheet.setTabColor('#1a73e8');
    sheet.getRange(1, 1, 1, COLUMNS.length)
      .setBackground('#f1f3f4')
      .setFontColor('#202124')
      .setFontWeight('bold')
      .setVerticalAlignment('middle')
      .setWrap(true);
    sheet.setColumnWidths(1, COLUMNS.length, 150);
    sheet.setColumnWidth(columnNumber('email'), 245);
    sheet.setColumnWidth(columnNumber('notes'), 260);
    if (!sheet.getFilter()) {
      sheet.getRange(1, 1, sheet.getMaxRows(), COLUMNS.length).createFilter();
    }
    applyDataRules(sheet, 2, Math.max(1, sheet.getMaxRows() - 1));
  }

  /**
   * Checkboxes for the opt-ins and a section dropdown, so the sheet can be
   * maintained without knowing the accepted spellings.
   *
   * Validation and number formats cover the whole block because they write no
   * values. Checkboxes are different: inserting one sets the cell to FALSE, so
   * covering a thousand empty rows would make getLastRow() report the entire
   * sheet as used. They therefore reach only as far as the recipients already
   * listed, plus a buffer for the next few additions. A row typed in beyond that
   * still works, because the reader accepts TRUE and YES as well as a checkbox.
   */
  function applyDataRules(sheet, startRow, rowCount) {
    if (rowCount < 1) return;
    var sectionValues = ['ALL'].concat(Object.keys(PMS.CONFIG.SECTIONS));
    sheet.getRange(startRow, columnNumber('sections'), rowCount, 1).setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList(sectionValues, true)
        .setAllowInvalid(false)
        .setHelpText('ALL, or a single IT section.')
        .build()
    );
    sheet.getRange(startRow, columnNumber('email'), rowCount, 1).setNumberFormat('@');

    var used = Math.max(recipientRowExtent(sheet) - startRow + 1, 0);
    var covered = Math.max(1, Math.min(rowCount, used + CHECKBOX_BUFFER_ROWS));
    [EVENT_PMS_COMPLETED, EVENT_TICKET, 'active'].forEach(function (key) {
      sheet.getRange(startRow, columnNumber(key), covered, 1).insertCheckboxes();
    });
  }

  /**
   * Last row that actually names a recipient.
   *
   * getLastRow() cannot be trusted here: unchecked checkboxes and native Sheets
   * Tables both leave FALSE in body rows, which counts as used. The email column
   * is the only reliable marker of a real row.
   */
  function recipientRowExtent(sheet) {
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return 1;
    var emails = sheet.getRange(2, columnNumber('email'), lastRow - 1, 1).getDisplayValues();
    for (var index = emails.length - 1; index >= 0; index -= 1) {
      if (String(emails[index][0] || '').trim()) return index + 2;
    }
    return 1;
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
        sheetName() + ' header mismatch. Refusing to use the sheet: ' + mismatches.slice(0, 5).join('; '),
        'SCHEMA_MISMATCH'
      );
    }
    ensurePresentation(sheet);
  }

  function ensurePresentation(sheet) {
    var propertyStore = PropertiesService.getScriptProperties();
    var signature = presentationSignature(sheet);
    if (propertyStore.getProperty(PRESENTATION_PROPERTY) === signature) return;
    applyPresentation(sheet);
    propertyStore.setProperty(PRESENTATION_PROPERTY, signature);
  }

  function withScriptLock(callback) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
      PMS.Util.fail('The notification recipients sheet is busy. Please try again.', 'BUSY');
    }
    try {
      return callback();
    } finally {
      lock.releaseLock();
    }
  }

  function ensureSheet() {
    return withScriptLock(function () { return notifySheet(true); });
  }

  /* ------------------------------------------------------------ recipients */

  function truthy(value) {
    if (value === true) return true;
    var text = String(value === null || value === undefined ? '' : value).trim().toUpperCase();
    return text === 'TRUE' || text === 'YES' || text === 'Y' || text === '1';
  }

  /**
   * Every usable recipient row.
   *
   * Lenient on purpose: one malformed row must not stop the whole team being
   * notified, so unreadable rows are skipped with a warning.
   */
  function listRecipients() {
    var sheet = notifySheet(false);
    if (!sheet) return [];
    // Bounded by the email column rather than getLastRow, so stray FALSE cells
    // from checkboxes do not turn this into a whole-sheet read.
    var lastRow = recipientRowExtent(sheet);
    if (lastRow < 2) return [];
    var values = sheet.getRange(2, 1, lastRow - 1, COLUMNS.length).getValues();
    var recipients = [];
    var seen = {};
    values.forEach(function (row, index) {
      var rowNumber = index + 2;
      var raw = {};
      COLUMNS.forEach(function (column, position) { raw[column.key] = row[position]; });
      var email;
      try {
        email = PMS.Util.normalizeEmail(raw.email);
      } catch (error) {
        console.warn('Skipping ' + sheetName() + ' row ' + rowNumber + ' with an unreadable email: ' + error.message);
        return;
      }
      if (!email) return;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        console.warn('Skipping ' + sheetName() + ' row ' + rowNumber + ': ' + email + ' is not a valid address.');
        return;
      }
      if (seen[email]) {
        console.warn('Skipping duplicate ' + sheetName() + ' row ' + rowNumber + ' for ' + email + '.');
        return;
      }
      seen[email] = true;
      var sections = PMS.Util.cleanText(raw.sections, 60).toUpperCase() || 'ALL';
      recipients.push({
        email: email,
        name: PMS.Util.cleanText(raw.name, 250),
        sections: sections,
        pmsCompleted: truthy(raw.pmsCompleted),
        ticketEvents: truthy(raw.ticketEvents),
        active: truthy(raw.active),
        notes: PMS.Util.cleanText(raw.notes, 500),
        _rowNumber: rowNumber
      });
    });
    return recipients;
  }

  /**
   * Addresses subscribed to one event family, optionally narrowed to a section.
   * A blank or ALL section subscription receives everything.
   */
  function recipientsFor(eventKey, sectionKey) {
    var section = PMS.Util.cleanText(sectionKey, 40).toUpperCase();
    return listRecipients().filter(function (recipient) {
      if (!recipient.active) return false;
      if (!recipient[eventKey]) return false;
      if (!section || recipient.sections === 'ALL') return true;
      return recipient.sections === section;
    });
  }

  /* ------------------------------------------------------------------ mail */

  function enabled() {
    return PMS.CONFIG.NOTIFY_ENABLED !== false;
  }

  function webAppUrl() {
    try {
      return ScriptApp.getService().getUrl() || '';
    } catch (error) {
      return '';
    }
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fieldText(value, fallback) {
    var text = PMS.Util.cleanText(value, MAX_BODY_FIELD_LENGTH);
    return text || (fallback === undefined ? '—' : fallback);
  }

  /**
   * Renders a stored token the way the app does, so a reader sees
   * "In progress" rather than IN_PROGRESS. Tracker values are deliberately not
   * passed through this: those are quoted verbatim because they are the literal
   * text sitting in the tracker cell.
   */
  function humanize(value, fallback) {
    var text = PMS.Util.cleanText(value, 60).replace(/_/g, ' ').toLowerCase();
    if (!text) return fallback === undefined ? '—' : fallback;
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  /** Rows are [label, value] pairs; long values wrap in their own block. */
  function detailTable(rows) {
    var html = ['<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:640px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#202124;">'];
    rows.forEach(function (row) {
      if (!row) return;
      html.push(
        '<tr>' +
          '<td style="padding:7px 12px 7px 0;vertical-align:top;white-space:nowrap;color:#5f6368;border-bottom:1px solid #e8eaed;font-weight:bold;">' +
            escapeHtml(row[0]) +
          '</td>' +
          '<td style="padding:7px 0;vertical-align:top;border-bottom:1px solid #e8eaed;white-space:pre-wrap;">' +
            escapeHtml(row[1]) +
          '</td>' +
        '</tr>'
      );
    });
    html.push('</table>');
    return html.join('');
  }

  function plainTable(rows) {
    return rows.filter(Boolean).map(function (row) {
      return row[0] + ': ' + row[1];
    }).join('\n');
  }

  function wrapBody(title, subtitle, tableHtml, footerNote) {
    var url = webAppUrl();
    return [
      '<div style="font-family:Arial,Helvetica,sans-serif;color:#202124;">',
      '<h2 style="margin:0 0 4px;font-size:17px;">' + escapeHtml(title) + '</h2>',
      subtitle ? '<p style="margin:0 0 16px;color:#5f6368;font-size:13px;">' + escapeHtml(subtitle) + '</p>' : '',
      tableHtml,
      url ? '<p style="margin:18px 0 0;font-size:13px;"><a href="' + escapeHtml(url) + '">Open YDC PMS</a></p>' : '',
      footerNote ? '<p style="margin:14px 0 0;color:#80868b;font-size:11px;">' + escapeHtml(footerNote) + '</p>' : '',
      '</div>'
    ].join('');
  }

  /**
   * Sends one message addressed to every recipient at once.
   *
   * One call keeps this well inside the daily quota and means a reply reaches
   * the whole group. The quota is checked first so a depleted allowance is a
   * warning rather than a thrown error mid-operation.
   */
  function send(subject, htmlBody, plainBody, recipients) {
    var addresses = (recipients || []).map(function (recipient) { return recipient.email; });
    if (!addresses.length) return { ok: true, sent: false, reason: 'NO_RECIPIENTS', recipients: 0 };
    try {
      var remaining = MailApp.getRemainingDailyQuota();
      if (remaining < 1) {
        console.warn('Notification skipped: the daily email quota is exhausted.');
        return { ok: false, sent: false, reason: 'QUOTA_EXHAUSTED', recipients: addresses.length };
      }
      MailApp.sendEmail({
        to: addresses.join(','),
        subject: PMS.CONFIG.NOTIFY_SUBJECT_PREFIX + ' ' + subject,
        htmlBody: htmlBody,
        body: plainBody,
        name: PMS.CONFIG.NOTIFY_SENDER_NAME
      });
      return { ok: true, sent: true, recipients: addresses.length, quotaRemaining: remaining - 1 };
    } catch (error) {
      console.warn('Notification email could not be sent: ' + error.message);
      return { ok: false, sent: false, reason: 'SEND_FAILED', error: error.message, recipients: addresses.length };
    }
  }

  function skipped(reason) {
    return { ok: true, sent: false, reason: reason, recipients: 0 };
  }

  /* ------------------------------------------------------- PMS completion */

  function ticketSummaryLines(recordId) {
    try {
      var tickets = PMS.Tickets.forRecord(recordId);
      if (!tickets.length) return '';
      return tickets.map(function (ticket) {
        return ticket.ticketId + ' — ' + ticket.status + ' (' + ticket.priority + ')';
      }).join('\n');
    } catch (error) {
      console.warn('Linked tickets could not be read for the notification: ' + error.message);
      return '';
    }
  }

  /**
   * Sent when maintenance is completed. The assessment is the point of the
   * message, so the result, findings, action taken and recommendation are all
   * carried in full rather than summarized.
   */
  function pmsCompleted(record, extras) {
    if (!enabled()) return skipped('DISABLED');
    try {
      var source = record || {};
      var options = extras || {};
      var section = PMS.Util.cleanText(source.itSection, 40).toUpperCase();
      var recipients = recipientsFor(EVENT_PMS_COMPLETED, section);
      if (!recipients.length) return skipped('NO_RECIPIENTS');

      var sectionLabel = PMS.CONFIG.SECTIONS[section] ? PMS.CONFIG.SECTIONS[section].label : section;
      var assetTag = fieldText(source.assetTag);
      var linkedTickets = ticketSummaryLines(source.recordId);
      var trackerStatus = PMS.Util.cleanText(options.trackerStatus, 60) || PMS.CONFIG.TRACKER_COMPLETED_VALUE;
      var progress = PMS.Util.cleanText(source.completedItems, 20) !== ''
        ? source.completedItems + ' of ' + source.applicableItems + ' checks complete'
        : '';

      var rows = [
        ['Asset', assetTag],
        ['IT Section', fieldText(sectionLabel)],
        ['Cycle', fieldText(source.cycleId)],
        ['Maintenance date', fieldText(maintenanceDateText(source.maintenanceDate))],
        ['Technician', fieldText(source.technicianName) + ' <' + fieldText(source.technicianEmail, '') + '>'],
        progress ? ['Checklist', progress] : null,
        ['Assessment result', fieldText(source.assessmentResult)],
        ['Asset findings', fieldText(source.assetFindings)],
        ['Action taken', fieldText(source.actionTaken)],
        ['Recommendation', fieldText(source.recommendation)],
        ['Tracker status', trackerStatus],
        linkedTickets ? ['Findings tickets', linkedTickets] : null,
        ['Record ID', fieldText(source.recordId)]
      ];

      var subject = 'PMS completed · ' + assetTag + ' · ' + fieldText(source.cycleId, '');
      var subtitle = sectionLabel + ' · completed by ' + fieldText(source.technicianName);
      return send(
        subject,
        wrapBody('Preventive maintenance completed', subtitle, detailTable(rows),
          'Sent automatically by YDC PMS. Manage recipients in the ' + sheetName() + ' sheet.'),
        'Preventive maintenance completed\n\n' + plainTable(rows),
        recipients
      );
    } catch (error) {
      console.warn('PMS completion notification failed: ' + error.message);
      return { ok: false, sent: false, reason: 'BUILD_FAILED', error: error.message };
    }
  }

  function maintenanceDateText(value) {
    if (Object.prototype.toString.call(value) === '[object Date]') {
      return Utilities.formatDate(value, PMS.CONFIG.TIME_ZONE, 'yyyy-MM-dd');
    }
    return String(value || '').slice(0, 10);
  }

  /* --------------------------------------------------------- ticket events */

  var TICKET_ACTION_TITLES = Object.freeze({
    CREATED: 'Findings ticket filed',
    STATUS_CHANGED: 'Findings ticket status changed',
    COMMENT: 'Findings ticket updated'
  });

  /**
   * Sent for every ticket movement: filing, a status change, or a progress note.
   * Tickets are never deleted, because the log is append-only; cancelling is the
   * equivalent and arrives here as a status change.
   */
  function ticketEvent(event) {
    if (!enabled()) return skipped('DISABLED');
    try {
      var details = event || {};
      var ticket = details.ticket || {};
      var action = PMS.Util.cleanText(details.action, 40).toUpperCase() || 'COMMENT';
      var section = PMS.Util.cleanText(ticket.section, 40).toUpperCase();
      var recipients = recipientsFor(EVENT_TICKET, section);
      if (!recipients.length) return skipped('NO_RECIPIENTS');

      var sectionLabel = PMS.CONFIG.SECTIONS[section] ? PMS.CONFIG.SECTIONS[section].label : section;
      var ticketId = fieldText(ticket.ticketId);
      var actor = fieldText(details.actorName || ticket.updatedByName || ticket.updatedBy);
      var transition = action === 'CREATED'
        ? humanize(ticket.status)
        : humanize(details.fromStatus, 'Unknown') + ' → ' + humanize(ticket.status);

      var rows = [
        ['Ticket', ticketId],
        ['Asset', fieldText(ticket.assetTag)],
        ['IT Section', fieldText(sectionLabel)],
        ['Status', transition],
        ['Priority', humanize(ticket.priority)],
        ['Changed by', actor],
        ['Remarks', fieldText(details.remarks || ticket.lastRemarks)],
        ['Findings', fieldText(ticket.findings)],
        ['Action required', fieldText(ticket.actionRequired)],
        ['Location', fieldText(ticket.location)],
        ticket.sourceRecordId ? ['From PMS record', fieldText(ticket.sourceRecordId)] : null,
        details.trackerStatus ? ['Tracker now shows', PMS.Util.cleanText(details.trackerStatus, 60)] : null,
        ['Changes so far', fieldText(ticket.changeCount, '1')]
      ];

      var title = TICKET_ACTION_TITLES[action] || TICKET_ACTION_TITLES.COMMENT;
      var subject = title.replace('Findings ticket', ticketId) + ' · ' + fieldText(ticket.assetTag);
      return send(
        subject,
        wrapBody(title, sectionLabel + ' · ' + fieldText(ticket.summary), detailTable(rows),
          'Sent automatically by YDC PMS. Manage recipients in the ' + sheetName() + ' sheet.'),
        title + '\n\n' + plainTable(rows),
        recipients
      );
    } catch (error) {
      console.warn('Ticket notification failed: ' + error.message);
      return { ok: false, sent: false, reason: 'BUILD_FAILED', error: error.message };
    }
  }

  /* ------------------------------------------------------------ diagnostics */

  /**
   * Read-only snapshot for administrator setup. Never throws, so a broken
   * recipients sheet can still be diagnosed from the setup output.
   */
  function readiness() {
    try {
      var sheet = notifySheet(false);
      if (!sheet) {
        return { ok: false, sheetName: sheetName(), exists: false, message: 'Run PMS_adminSetup to create the sheet.' };
      }
      var recipients = listRecipients();
      return {
        ok: true,
        sheetName: sheetName(),
        exists: true,
        enabled: enabled(),
        total: recipients.length,
        active: recipients.filter(function (item) { return item.active; }).length,
        pmsCompleted: recipients.filter(function (item) { return item.active && item.pmsCompleted; }).length,
        ticketEvents: recipients.filter(function (item) { return item.active && item.ticketEvents; }).length,
        quotaRemaining: quotaRemaining()
      };
    } catch (error) {
      return { ok: false, sheetName: sheetName(), error: error.message };
    }
  }

  function quotaRemaining() {
    try {
      return MailApp.getRemainingDailyQuota();
    } catch (error) {
      return null;
    }
  }

  /** Sends a sample to the live list so the wiring can be checked. */
  function sendTest(context) {
    var actor = context && context.email ? context.email : 'an administrator';
    var recipients = recipientsFor(EVENT_TICKET, '').concat(recipientsFor(EVENT_PMS_COMPLETED, ''))
      .filter(function (recipient, index, all) {
        return all.findIndex(function (item) { return item.email === recipient.email; }) === index;
      });
    if (!recipients.length) {
      return { ok: false, sent: false, reason: 'NO_RECIPIENTS', message: 'Add at least one active recipient first.' };
    }
    var rows = [
      ['Test requested by', actor],
      ['Sent at', PMS.Util.nowIso()],
      ['Recipients', String(recipients.length)],
      ['Quota remaining', String(quotaRemaining())]
    ];
    var result = send(
      'Notification test',
      wrapBody('YDC PMS notification test', 'If you received this, notifications are configured correctly.',
        detailTable(rows), 'Sent automatically by YDC PMS.'),
      'YDC PMS notification test\n\n' + plainTable(rows),
      recipients
    );
    result.addresses = recipients.map(function (recipient) { return recipient.email; });
    return result;
  }

  return {
    ensureSheet: ensureSheet,
    sheetName: sheetName,
    columns: function () { return COLUMNS.slice(); },
    listRecipients: listRecipients,
    recipientsFor: recipientsFor,
    pmsCompleted: pmsCompleted,
    ticketEvent: ticketEvent,
    readiness: readiness,
    sendTest: sendTest
  };
})();
