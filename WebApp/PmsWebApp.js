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
      identitySource: 'GOOGLE_ACCOUNT'
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
    if (context.isAdmin) response.rollover = PMS.Rollover.status();
  }
  return response;
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

function PMS_apiSaveRecord(payload, mode) {
  return PMS_jsonResponse_(PMS.Records.save(payload, mode));
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

function PMS_apiAdminSetUserSection(userEmail, sectionKey) {
  return PMS_jsonResponse_(PMS.Auth.adminSetUserSection(userEmail, sectionKey));
}

function PMS_adminSetup() {
  PMS.Auth.requireAdmin();
  var users = PMS.Users.ensureSheet();
  var sheet = PMS.Records.responseSheet(true);
  var baseline = PMS.Records.ensureTrackerBaseline();
  return {
    ok: true,
    userSheetName: users.getName(),
    sheetName: sheet.getName(),
    columns: PMS.CONFIG.RECORD_COLUMNS.length,
    baseline: baseline,
    message: 'PMS Users and PMS Records are ready.'
  };
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
  return {
    ok: true,
    administrator: email,
    administrators: admins,
    identity: PMS.Auth.diagnostics(),
    userDirectory: userMigration,
    message: 'Deployment administrator configured. Deploy the web app to execute as the owner and restrict access to ydc.com.ph.'
  };
}

/**
 * Read-only sign-in troubleshooting helper. Run from the Apps Script editor to
 * confirm that Google exposes the account email and that the email is on the
 * PMS Users roster. Changes no data.
 */
function PMS_diagnoseSignIn() {
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
