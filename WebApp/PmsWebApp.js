var PMS = PMS || {};

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle(PMS.CONFIG.APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function PMS_include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function PMS_publicConfig_() {
  var current = PMS.Util.currentCycle();
  var evidence = {};
  Object.keys(PMS.CONFIG.EVIDENCE).forEach(function (key) {
    evidence[key] = {
      key: key,
      label: PMS.CONFIG.EVIDENCE[key].label,
      maxBytes: PMS.CONFIG.MAX_EVIDENCE_BYTES,
      accept: '.png,.jpg,.jpeg,.gif,.webp,.bmp,.tif,.tiff,.pdf,.txt,.log,.md,.csv,.json,.xml,.yaml,.yml,.zip,.cfg,.conf,.config,.ini,.bak,.backup'
    };
  });
  return {
    appName: PMS.CONFIG.APP_NAME,
    allowedDomain: PMS.CONFIG.ALLOWED_DOMAIN,
    timeZone: PMS.CONFIG.TIME_ZONE,
    sections: Object.keys(PMS.CONFIG.SECTIONS).map(function (key) {
      return { key: key, label: PMS.CONFIG.SECTIONS[key].label };
    }),
    cycles: Object.keys(PMS.CONFIG.CYCLES).map(function (key) {
      return {
        key: key,
        startMonth: PMS.CONFIG.CYCLES[key].startMonth,
        endMonth: PMS.CONFIG.CYCLES[key].endMonth,
        endDay: PMS.CONFIG.CYCLES[key].endDay
      };
    }),
    currentCycle: current,
    peripherals: PMS.CONFIG.PERIPHERALS,
    checklist: PMS.CONFIG.CHECKLIST,
    infraAssetTypes: PMS.CONFIG.INFRA_ASSET_TYPES,
    infraChecklist: PMS.CONFIG.INFRA_CHECKLIST,
    evidence: evidence,
    questionnaires: {
      SERVICE_DESK: {
        key: 'SERVICE_DESK',
        peripherals: PMS.CONFIG.PERIPHERALS,
        checklist: PMS.CONFIG.CHECKLIST,
        assetTypes: [],
        evidence: []
      },
      INFRA_SECURITY: {
        key: 'INFRA_SECURITY',
        peripherals: [],
        checklist: PMS.CONFIG.INFRA_CHECKLIST,
        assetTypes: PMS.CONFIG.INFRA_ASSET_TYPES,
        evidence: evidence
      }
    },
    assessmentResults: PMS.CONFIG.ASSESSMENT_RESULTS
  };
}

/**
 * Serializes an API response as a JSON string.
 *
 * google.script.run's structured serializer silently delivers null to the
 * success handler when a response is large enough to defeat it, which the
 * client then reads as an empty object. A live section can expose over a
 * thousand assets plus metrics and config, which crosses that threshold.
 *
 * Returning a string bypasses the structured serializer; the client already
 * JSON-parses string responses in parseServerValue(). JSON.stringify also
 * throws on a circular structure instead of failing silently, so a real error
 * surfaces through publicError() rather than an empty payload.
 */
function PMS_jsonResponse_(payload) {
  return JSON.stringify(payload);
}

function PMS_apiBootstrap() {
  try {
    return PMS_jsonResponse_(PMS_buildBootstrap_());
  } catch (error) {
    return PMS_jsonResponse_(PMS.Util.publicError(error));
  }
}

function PMS_buildBootstrap_() {
  var context = PMS.Auth.getContext();
  var response = {
    ok: true,
    registered: context.registered,
    user: {
      email: context.email,
      name: context.name,
      isAdmin: context.isAdmin,
      role: context.role,
      active: context.active,
      identitySource: context.identitySource
    },
    profile: {
      section: context.section,
      sectionLabel: context.sectionLabel,
      registeredAt: context.registeredAt,
      lastLoginAt: context.lastLoginAt
    },
    config: PMS_publicConfig_(),
    assets: [],
    metrics: null,
    recentRecords: [],
    rollover: null
  };
  if (context.registered) {
    PMS.Records.ensureTrackerBaseline();
    response.assets = PMS.Assets.listSelectable(context.section);
    var records = PMS.Records.dashboardRecords();
    response.metrics = PMS.Metrics.dashboard({ section: context.isAdmin ? 'ALL' : context.section }, records);
    response.recentRecords = PMS.Records.recent(context, 10, records);
  }
  // Rollover status is deliberately not built here. It reads both tracker
  // sheets in full and inspects every sheet in the workbook, which is the
  // single most expensive thing an administrator's load used to wait on. The
  // client requests it after the dashboard has painted.
  response.rolloverDeferred = Boolean(context.isAdmin);
  return response;
}

/** Administrator rollover status, fetched after the dashboard renders. */
function PMS_apiRolloverStatus() {
  try {
    PMS.Auth.requireAdmin();
    return PMS_jsonResponse_({ ok: true, rollover: PMS.Rollover.status() });
  } catch (error) {
    return PMS_jsonResponse_(PMS.Util.publicError(error));
  }
}

function PMS_apiRegister(registration) {
  try {
    var context = PMS.Auth.register(registration);
    return PMS_jsonResponse_({
      ok: true,
      registered: true,
      user: {
        email: context.email,
        name: context.name,
        isAdmin: context.isAdmin,
        role: context.role,
        active: context.active,
        identitySource: context.identitySource
      },
      profile: {
        section: context.section,
        sectionLabel: context.sectionLabel,
        registeredAt: context.registeredAt,
        lastLoginAt: context.lastLoginAt
      }
    });
  } catch (error) {
    return PMS_jsonResponse_(PMS.Util.publicError(error));
  }
}

function PMS_apiRefreshAssets() {
  var context = PMS.Auth.requireProfile();
  return PMS_jsonResponse_({ ok: true, assets: PMS.Assets.listSelectable(context.section, true) });
}

function PMS_apiDashboard(filters) {
  PMS.Auth.requireProfile();
  PMS.Records.ensureTrackerBaseline();
  return PMS_jsonResponse_({
    ok: true,
    metrics: PMS.Metrics.dashboard(filters || {}, PMS.Records.dashboardRecords())
  });
}

/**
 * Completed-maintenance archive. Scope is derived from the server-resolved
 * profile: an administrator sees every section, a technician sees only their own
 * completed records. The browser can influence paging and filters, never scope.
 */
function PMS_apiCompletedRecords(options) {
  try {
    var context = PMS.Auth.requireProfile();
    return PMS_jsonResponse_(PMS.Records.completedList(context, options));
  } catch (error) {
    return PMS_jsonResponse_(PMS.Util.publicError(error));
  }
}

/* ---------------------------------------------------------------- tickets */

/**
 * Findings tickets. Every entry point requires a registered profile, and any
 * rostered user may file a ticket or move one along; the append-only log is what
 * provides accountability.
 */
function PMS_apiTickets(options) {
  try {
    var context = PMS.Auth.requireProfile();
    return PMS_jsonResponse_(PMS.Tickets.list(context, options));
  } catch (error) {
    return PMS_jsonResponse_(PMS.Util.publicError(error));
  }
}

function PMS_apiTicketDetail(ticketId) {
  try {
    var context = PMS.Auth.requireProfile();
    return PMS_jsonResponse_(PMS.Tickets.detail(context, ticketId));
  } catch (error) {
    return PMS_jsonResponse_(PMS.Util.publicError(error));
  }
}

/*
  Both write endpoints take the browser's current list request as a second
  argument and return the changed ticket, its history and the refreshed list in
  one response. Filing or moving a ticket used to cost three sequential
  google.script.run calls, which is most of what made it feel slow.
*/
function PMS_apiCreateTicket(payload, listOptions) {
  try {
    var context = PMS.Auth.requireProfile();
    return PMS_jsonResponse_(
      PMS.Tickets.withRefresh(context, PMS.Tickets.create(context, payload), listOptions)
    );
  } catch (error) {
    return PMS_jsonResponse_(PMS.Util.publicError(error));
  }
}

/**
 * Saves a draft PMS record and files a findings ticket against it in one
 * round trip.
 *
 * Filing mid-questionnaire used to be PMS_apiSaveRecord followed by
 * PMS_apiCreateTicket as two sequential google.script.run calls. Each Apps
 * Script round trip costs roughly half a second before any work even starts,
 * so two of them made filing feel slow on top of the sheet reads and the
 * email both writes already do. Collapsing them into one call removes
 * exactly one of those round trips; the two writes underneath (and their two
 * separate script locks) are unchanged.
 */
function PMS_apiFileTicketForRecord(recordPayload, ticketPayload, listOptions) {
  try {
    var saveResult = PMS.Records.save(recordPayload, 'SAVE');
    var context = PMS.Auth.requireProfile();
    var ticketRequest = Object.assign({}, ticketPayload || {}, { sourceRecordId: saveResult.recordId });
    var ticketOutcome = PMS.Tickets.withRefresh(context, PMS.Tickets.create(context, ticketRequest), listOptions);
    return PMS_jsonResponse_(Object.assign({}, ticketOutcome, {
      recordId: saveResult.recordId,
      pmsCompletion: saveResult.pmsCompletion,
      syncStatus: saveResult.syncStatus
    }));
  } catch (error) {
    return PMS_jsonResponse_(PMS.Util.publicError(error));
  }
}

function PMS_apiUpdateTicket(payload, listOptions) {
  try {
    var context = PMS.Auth.requireProfile();
    return PMS_jsonResponse_(
      PMS.Tickets.withRefresh(context, PMS.Tickets.updateStatus(context, payload), listOptions)
    );
  } catch (error) {
    return PMS_jsonResponse_(PMS.Util.publicError(error));
  }
}

/**
 * Asset tags for the ticket form's picker.
 *
 * Kept out of the bootstrap on purpose. Tickets may be filed against either
 * section, so this can return both sections' assets at once, and the bootstrap
 * payload is already the largest response the app produces.
 */
function PMS_apiAssetOptions(sectionKey) {
  try {
    PMS.Auth.requireProfile();
    return PMS_jsonResponse_({ ok: true, assets: PMS.Assets.listOptions(sectionKey) });
  } catch (error) {
    return PMS_jsonResponse_(PMS.Util.publicError(error));
  }
}

/**
 * Active ticket count for the dashboard badge. Fetched after the dashboard
 * paints rather than inside the bootstrap, so it cannot slow first load.
 */
function PMS_apiTicketSummary() {
  try {
    var context = PMS.Auth.requireProfile();
    return PMS_jsonResponse_(PMS.Tickets.summary(context));
  } catch (error) {
    return PMS_jsonResponse_(PMS.Util.publicError(error));
  }
}

function PMS_apiSaveRecord(payload, mode) {
  return PMS_jsonResponse_(PMS.Records.save(payload, mode));
}

/**
 * Receives a form element as the sole google.script.run argument. Its `file`
 * field arrives as an Apps Script Blob; all destination and identity values are
 * resolved and verified again on the server.
 */
function PMS_apiUploadInfraEvidence(uploadForm) {
  return PMS_jsonResponse_(PMS.Evidence.upload(uploadForm));
}

function PMS_apiGetRecord(recordId) {
  return PMS_jsonResponse_(PMS.Records.clientRecord(recordId));
}

function PMS_apiRolloverDryRun(nextYear) {
  return PMS_jsonResponse_(PMS.Rollover.dryRun(nextYear));
}

function PMS_apiExecuteRollover(nextYear, confirmationToken) {
  return PMS_jsonResponse_(PMS.Rollover.execute(nextYear, confirmationToken));
}

function PMS_apiRetryReconciliation(year) {
  return PMS_jsonResponse_(PMS.Rollover.retryReconciliation(year));
}

/**
 * What a data reset would clear. Read-only, and it hands back the token the
 * execute call has to return, so the browser cannot reset without having first
 * been shown the numbers.
 */
function PMS_apiResetPreview() {
  try {
    return PMS_jsonResponse_(PMS.Reset.preview());
  } catch (error) {
    return PMS_jsonResponse_(PMS.Util.publicError(error));
  }
}

/** Clears the test data. Administrator only, token and typed phrase required. */
function PMS_apiExecuteReset(confirmationToken, phrase) {
  try {
    return PMS_jsonResponse_(PMS.Reset.execute(confirmationToken, phrase));
  } catch (error) {
    return PMS_jsonResponse_(PMS.Util.publicError(error));
  }
}

function PMS_apiAdminSetUserSection(userEmail, sectionKey) {
  return PMS_jsonResponse_(PMS.Auth.adminSetUserSection(userEmail, sectionKey));
}

/** Administrator-only, read-only workbook preview plus short-lived cache token. */
function PMS_apiPreviewLegacyImport(request) {
  try {
    return PMS_jsonResponse_(PMS.LegacyImport.preview(request));
  } catch (error) {
    return PMS_jsonResponse_(PMS.Util.publicError(error));
  }
}

/** Executes at most one bounded legacy-import chunk and returns its continuation token. */
function PMS_apiExecuteLegacyImport(request, confirmationToken) {
  try {
    return PMS_jsonResponse_(PMS.LegacyImport.execute(request, confirmationToken));
  } catch (error) {
    return PMS_jsonResponse_(PMS.Util.publicError(error));
  }
}

function PMS_adminSetup() {
  PMS.Auth.requireAdmin();
  var users = PMS.Users.ensureSheet();
  var serviceDeskSheet = PMS.Records.responseSheet(true, 'SERVICE_DESK');
  var infraSheet = PMS.Records.responseSheet(true, 'INFRA_SECURITY');
  var baseline = PMS.Records.ensureTrackerBaseline();
  var tickets = PMS.Tickets.ensureSheets();
  var recipients = PMS.Notify.ensureSheet();
  return {
    ok: true,
    userSheetName: users.getName(),
    recordSheets: [
      { name: serviceDeskSheet.getName(), columns: PMS.CONFIG.RECORD_COLUMNS.length },
      { name: infraSheet.getName(), columns: PMS.CONFIG.INFRA_RECORD_COLUMNS.length }
    ],
    ticketSheets: tickets,
    recipientSheetName: recipients.getName(),
    baseline: baseline,
    evidence: PMS.Evidence.readiness(),
    notifications: PMS.Notify.readiness(),
    message: 'PMS Users, both section record sheets, ticket sheets, the notification recipients sheet, ' +
      'and evidence folders are ready. Add recipients to the ' + PMS.Notify.sheetName() +
      ' sheet, then run PMS_notifyTest to confirm email delivery.'
  };
}

/**
 * Sends a sample notification to the live recipient list.
 *
 * Run from the Apps Script editor after adding recipients. The result is logged
 * because the editor does not render return values.
 */
function PMS_notifyTest() {
  var admin = PMS.Auth.requireAdmin();
  var result = PMS.Notify.sendTest(admin);
  result.readiness = PMS.Notify.readiness();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Removes obsolete tracker range protections left behind by the reverted
 * cycle-lock release. This touches only protections whose description begins
 * exactly "PMS cycle checkbox lock" and preserves all other protections.
 * Normal synchronization also performs this cleanup automatically; this
 * editor-visible helper is available for an administrator to migrate both
 * tracker sheets immediately.
 */
function PMS_removeLegacyTrackerProtections() {
  var admin = PMS.Auth.requireAdmin();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    PMS.Util.fail('Another maintenance operation is running. Try the cleanup again shortly.', 'BUSY');
  }
  var result;
  try {
    result = PMS.Tracker.removeLegacyCycleProtections();
  } finally {
    lock.releaseLock();
  }
  result.ok = true;
  result.removedBy = admin.email;
  result.removedAt = PMS.Util.nowIso();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * One-time, idempotent migration from tracker checkboxes to the non-interactive
 * COMPLETED status used by the web app. Legacy TRUE values are preserved as
 * completed; FALSE becomes blank. Remarks and all other columns are untouched.
 */
function PMS_migrateTrackerStatusCells() {
  var admin = PMS.Auth.requireAdmin();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    PMS.Util.fail('Another maintenance operation is running. Try the status migration again shortly.', 'BUSY');
  }
  var result;
  try {
    result = PMS.Tracker.migrateStatusColumns();
  } finally {
    lock.releaseLock();
  }
  result.ok = true;
  result.migratedBy = admin.email;
  result.migratedAt = PMS.Util.nowIso();
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Visible editor entry point for initial deployment setup. The static
 * administrator allowlist prevents another domain user from bootstrapping
 * themselves through google.script.run.
 */
function PMS_setupDeployment() {
  var email = PMS.Auth.currentEmail();
  var bootstrapAdmins = PMS.CONFIG.ADMIN_EMAILS.map(PMS.Util.normalizeEmail);
  if (bootstrapAdmins.indexOf(email) < 0) {
    PMS.Util.fail('Only a configured deployment administrator can run initial setup.', 'ACCESS_DENIED');
  }
  return PMS_setupDeployment_();
}

/** Private implementation; callable only through the guarded entry point. */
function PMS_setupDeployment_() {
  var email = PMS.Auth.currentEmail();
  var admins = PMS.Auth.configuredAdminEmails();
  if (admins.indexOf(email) < 0) admins.push(email);
  PropertiesService.getScriptProperties().setProperty(PMS.CONFIG.ADMIN_EMAILS_PROPERTY, admins.join(','));
  var userMigration = PMS.Users.migrateLegacyProfiles();
  var evidence = PMS.Evidence.readiness();
  return {
    ok: true,
    administrator: email,
    administrators: admins,
    identity: PMS.Auth.diagnostics(),
    userDirectory: userMigration,
    evidence: evidence,
    message: 'Deployment administrator and evidence storage configured. Deploy the web app to execute as the owner and restrict access to ydc.com.ph.'
  };
}

/**
 * Read-only sign-in troubleshooting helper. Run from the Apps Script editor to
 * confirm that Google exposes the account email and that the email is on the
 * PMS Users roster. Changes no data.
 */
function PMS_diagnoseSignIn() {
  PMS.Auth.requireAdmin();
  return PMS.Auth.diagnostics();
}

/**
 * Editor-only probe that writes the sign-in diagnostics and the real bootstrap
 * shape to the execution log, because the editor does not display a returned
 * object. Use this when the browser reports BOOTSTRAP_INCOMPLETE: it shows
 * whether the server actually produced user.email and, if the registered branch
 * fails, the underlying error and stack.
 */
function PMS_logSignInReport() {
  PMS.Auth.requireAdmin();
  var report = {};
  try {
    report.diagnostics = PMS.Auth.diagnostics();
  } catch (error) {
    report.diagnostics = { failed: (error.name || 'Error') + ': ' + error.message };
  }
  try {
    var bootstrap = PMS_buildBootstrap_();
    report.bootstrap = {
      ok: bootstrap.ok,
      registered: bootstrap.registered,
      topLevelFields: Object.keys(bootstrap),
      userFields: Object.keys(bootstrap.user || {}),
      userEmail: (bootstrap.user || {}).email || '(EMPTY)',
      userName: (bootstrap.user || {}).name || '(EMPTY)',
      profile: bootstrap.profile,
      assetCount: (bootstrap.assets || []).length,
      recentRecordCount: (bootstrap.recentRecords || []).length,
      hasConfig: Boolean(bootstrap.config),
      hasMetrics: Boolean(bootstrap.metrics),
      serializedBytes: JSON.stringify(bootstrap).length,
      assetBytes: JSON.stringify(bootstrap.assets || []).length,
      metricsBytes: JSON.stringify(bootstrap.metrics || null).length,
      configBytes: JSON.stringify(bootstrap.config || null).length
    };
  } catch (error) {
    report.bootstrap = {
      failed: (error.name || 'Error') + ': ' + error.message,
      stack: error.stack || '(no stack)'
    };
  }
  console.log(JSON.stringify(report, null, 2));
  return report;
}

function PMS_continueReconciliation_() {
  return PMS.Rollover.continueReconciliation();
}
