var PMS = PMS || {};

/**
 * Identity and authorization for the PMS web app.
 *
 * Authentication model (v2 — simplified):
 *   1. The signed-in Google account email is read from the Apps Script Session.
 *   2. The email must belong to the configured Workspace domain.
 *   3. The email must exist in the `PMS Users` sheet and must not be disabled.
 *
 * If Google temporarily withholds a returning visitor's email, a previously
 * bound, script-specific temporary user key may resolve that existing profile.
 * It cannot register a new user or grant administrator privileges. The browser
 * is never trusted for email, section, or role.
 */
PMS.Auth = (function () {
  function sessionEmail() {
    // Only ActiveUser identifies the visitor. In an execute-as-owner web app,
    // EffectiveUser is the deployment owner for every request and must never be
    // used as an identity fallback; doing so would attribute every technician's
    // work (and administrator privileges) to that owner.
    try {
      return PMS.Util.normalizeEmail(Session.getActiveUser().getEmail());
    } catch (error) {
      console.warn('The signed-in Google account email is unavailable: ' + error.message);
    }
    return '';
  }

  function failIdentityUnavailable() {
    PMS.Util.fail(
      'Google did not share your signed-in account with PMS. Open the domain-restricted PMS web app directly, ' +
        'make sure you are signed in with your @' + PMS.CONFIG.ALLOWED_DOMAIN + ' account, and approve access when prompted.',
      'IDENTITY_UNAVAILABLE'
    );
  }

  function requireDomain(email) {
    var domain = '@' + PMS.CONFIG.ALLOWED_DOMAIN.toLowerCase();
    if (email.slice(-domain.length) !== domain) {
      PMS.Util.fail('Access is restricted to ' + PMS.CONFIG.ALLOWED_DOMAIN + ' accounts.', 'ACCESS_DENIED');
    }
    return email;
  }

  /** The authoritative signed-in email, or a thrown identity error. */
  function currentEmail() {
    var email = sessionEmail();
    if (!email) failIdentityUnavailable();
    return requireDomain(email);
  }

  function resolveIdentity() {
    var liveEmail = sessionEmail();
    if (liveEmail) {
      return { email: requireDomain(liveEmail), source: 'GOOGLE_ACCOUNT', profile: null };
    }
    var identityHash = temporaryIdentityHash();
    var profile = identityHash ? PMS.Users.findByIdentityKey(identityHash) : null;
    if (profile && profile.email && profile.active !== false) {
      return { email: requireDomain(profile.email), source: 'TEMPORARY_KEY', profile: profile };
    }
    failIdentityUnavailable();
  }

  /**
   * Hash of Google's temporary user key. It is bound only after a live email
   * has identified the user, and can later restore that existing technician
   * profile when Google withholds the email. It never grants admin privileges.
   */
  function temporaryIdentityHash() {
    var key = '';
    try {
      key = String(Session.getTemporaryActiveUserKey() || '');
    } catch (error) {
      console.warn('The temporary active-user key is unavailable: ' + error.message);
    }
    return key ? PMS.Util.hashText(key) : '';
  }

  function displayNameFromEmail(email) {
    var local = String(email || '').split('@')[0];
    return local
      .replace(/[._-]+/g, ' ')
      .split(' ')
      .filter(Boolean)
      .map(function (word) {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ') || email;
  }

  function configuredAdminEmails() {
    var configured = PMS.CONFIG.ADMIN_EMAILS.slice();
    var propertyValue = PropertiesService.getScriptProperties().getProperty(PMS.CONFIG.ADMIN_EMAILS_PROPERTY) || '';
    propertyValue.split(/[;,\s]+/).forEach(function (email) {
      if (email) configured.push(email);
    });
    var seen = {};
    return configured.map(PMS.Util.normalizeEmail).filter(function (email) {
      if (!email || seen[email]) return false;
      seen[email] = true;
      return true;
    });
  }

  function isAdmin(email) {
    var normalized = PMS.Util.normalizeEmail(email);
    return Boolean(normalized && configuredAdminEmails().indexOf(normalized) >= 0);
  }

  function failNotProvisioned(email) {
    PMS.Util.fail(
      'Your account (' + email + ') is not on the PMS access list. Ask a PMS administrator to add your email ' +
        'to the "' + PMS.Users.sheetName() + '" sheet, then reload this page.',
      'ACCESS_NOT_PROVISIONED'
    );
  }

  function failDisabled() {
    PMS.Util.fail('Your PMS account is inactive. Ask a PMS administrator for access.', 'ACCOUNT_DISABLED');
  }

  /**
   * Resolves the signed-in user and their `PMS Users` row.
   *
   * A configured administrator is always permitted so the deployment owner can
   * never be locked out of an empty or damaged roster.
   */
  function resolveProfile(email) {
    var profile = PMS.Users.findByEmail(email);
    if (profile && profile.active === false) failDisabled();
    if (profile) return profile;
    if (isAdmin(email)) return null;
    if (PMS.CONFIG.REQUIRE_DIRECTORY_ENTRY) failNotProvisioned(email);
    return null;
  }

  function recordLogin(email, profile, identitySource) {
    if (!profile) return profile;
    var touchCache = CacheService.getScriptCache();
    var touchCacheKey = 'PMS_USER_TOUCH_' + PMS.Util.hashText(email).slice(0, 24);
    try {
      if (touchCache.get(touchCacheKey)) return profile;
    } catch (cacheError) {
      console.warn('Unable to read the PMS user-login cache: ' + cacheError.message);
    }
    var updated = PMS.Users.touchLogin(email, {
      identityKeyHash: temporaryIdentityHash(),
      identitySource: identitySource || 'GOOGLE_ACCOUNT'
    }) || profile;
    try {
      touchCache.put(touchCacheKey, '1', 900);
    } catch (cacheWriteError) {
      console.warn('Unable to update the PMS user-login cache: ' + cacheWriteError.message);
    }
    return updated;
  }

  /*
    Resolving the context reads the PMS Users sheet and can take a lock to stamp
    the login. A single bootstrap used to do it three times, once directly and
    again via Metrics and Rollover. The memo lives only for the current script
    execution, which is one request by one user, so there is nothing to stale.
  */
  var contextMemo = null;

  function invalidateContext() {
    contextMemo = null;
  }

  function getContext() {
    if (contextMemo) return contextMemo;
    contextMemo = buildContext();
    return contextMemo;
  }

  function buildContext() {
    var identity = resolveIdentity();
    var email = identity.email;
    var profile = recordLogin(email, identity.profile || resolveProfile(email), identity.source);
    var name = profile && profile.name ? profile.name : displayNameFromEmail(email);
    var administrator = identity.source === 'GOOGLE_ACCOUNT' && isAdmin(email);
    // An administrator can already do everything asset management allows, so
    // this is never a separate grant for them — only a technician's own
    // roster row can turn it on.
    var assetManager = administrator || Boolean(profile && profile.canManageAssets);
    return {
      email: email,
      name: name,
      registered: Boolean(profile && profile.section),
      active: true,
      section: profile ? profile.section : '',
      sectionLabel: profile && profile.section && PMS.CONFIG.SECTIONS[profile.section]
        ? PMS.CONFIG.SECTIONS[profile.section].label
        : '',
      isAdmin: administrator,
      canManageAssets: assetManager,
      role: administrator ? 'ADMIN' : (assetManager ? 'ASSET_MANAGER' : 'TECHNICIAN'),
      identitySource: identity.source,
      registeredAt: profile ? profile.registeredAt : '',
      updatedAt: profile ? profile.updatedAt : '',
      lastLoginAt: profile ? profile.lastLoginAt : ''
    };
  }

  /**
   * First-use registration. The email is never taken from the browser, and an
   * already-registered section can only be changed by an administrator.
   */
  function register(registration) {
    var request = registration && typeof registration === 'object'
      ? registration
      : { section: registration };
    var email = currentEmail();
    resolveProfile(email);
    var section = PMS.Util.section(request.section);
    var requestedName = PMS.Util.cleanText(request.displayName, 250);
    var identityKeyHash = temporaryIdentityHash();
    PMS.Users.update(email, function (existing) {
      if (existing && existing.active === false) failDisabled();
      if (existing && existing.section && existing.section !== section.key) {
        PMS.Util.fail('Your IT section is already registered. Ask a PMS administrator to change it.', 'SECTION_LOCKED');
      }
      var timestamp = PMS.Util.nowIso();
      return {
        email: email,
        name: requestedName || (existing && existing.name) || displayNameFromEmail(email),
        section: section.key,
        role: isAdmin(email) ? 'ADMIN' : 'TECHNICIAN',
        active: true,
        registeredAt: existing && existing.registeredAt ? existing.registeredAt : timestamp,
        updatedAt: timestamp,
        lastLoginAt: timestamp,
        updatedBy: email,
        identityKeyHash: identityKeyHash || (existing && existing.identityKeyHash) || '',
        identityBoundAt: identityKeyHash && (!existing || existing.identityKeyHash !== identityKeyHash)
          ? timestamp
          : (existing && existing.identityBoundAt) || '',
        identitySource: 'GOOGLE_ACCOUNT'
      };
    });
    // The profile just changed, so the memo from before the write is stale.
    invalidateContext();
    return getContext();
  }

  function requireProfile() {
    var context = getContext();
    if (!context.registered) {
      PMS.Util.fail('Complete IT section registration before using the PMS form.', 'REGISTRATION_REQUIRED');
    }
    PMS.Util.section(context.section);
    return context;
  }

  function requireAdmin() {
    var context = getContext();
    if (!context.registered) {
      PMS.Util.fail('Complete IT section registration before using administrator tools.', 'REGISTRATION_REQUIRED');
    }
    if (context.identitySource !== 'GOOGLE_ACCOUNT') {
      PMS.Util.fail('Google must expose your live Workspace email for administrator actions. Reload and sign in again.', 'IDENTITY_UNAVAILABLE');
    }
    if (!context.isAdmin) {
      PMS.Util.fail('Administrator access is required.', 'ACCESS_DENIED');
    }
    return context;
  }

  /**
   * Guards the asset-management screen: an administrator, or a technician
   * whose roster row has the Asset Manager checkbox on. Lower-privilege than
   * requireAdmin on purpose — this is the permission meant to be handed to
   * whoever actually owns the asset list, without also handing them
   * rollover, the danger zone, or year deletion.
   */
  function requireAssetManager() {
    var context = getContext();
    if (!context.registered) {
      PMS.Util.fail('Complete IT section registration before managing assets.', 'REGISTRATION_REQUIRED');
    }
    if (!context.isAdmin && !context.canManageAssets) {
      PMS.Util.fail('Asset management access is required.', 'ACCESS_DENIED');
    }
    return context;
  }

  /** Grants or revokes the Asset Manager permission on another user's roster row. */
  function adminSetAssetManager(userEmail, granted) {
    var admin = requireAdmin();
    var email = PMS.Util.normalizeEmail(userEmail);
    var domain = '@' + PMS.CONFIG.ALLOWED_DOMAIN.toLowerCase();
    if (!email || email.slice(-domain.length) !== domain) {
      PMS.Util.fail('A valid YDC email is required.', 'VALIDATION_ERROR');
    }
    var updated = PMS.Users.update(email, function (existing) {
      if (!existing) {
        PMS.Util.fail('That user is not on the PMS roster yet. Ask them to sign in and register first.', 'NOT_FOUND');
      }
      existing.canManageAssets = Boolean(granted);
      existing.updatedBy = admin.email;
      return existing;
    });
    invalidateContext();
    return { ok: true, email: email, canManageAssets: Boolean(updated && updated.canManageAssets) };
  }

  function adminSetUserSection(userEmail, sectionKey) {
    var admin = requireAdmin();
    var email = PMS.Util.normalizeEmail(userEmail);
    var domain = '@' + PMS.CONFIG.ALLOWED_DOMAIN.toLowerCase();
    if (!email || email.slice(-domain.length) !== domain) {
      PMS.Util.fail('A valid YDC email is required.', 'VALIDATION_ERROR');
    }
    var section = PMS.Util.section(sectionKey);
    PMS.Users.update(email, function (existing) {
      existing = existing || {};
      var timestamp = PMS.Util.nowIso();
      return {
        email: email,
        name: existing.name || displayNameFromEmail(email),
        section: section.key,
        role: isAdmin(email) ? 'ADMIN' : 'TECHNICIAN',
        // Not existing.active === true: an unset value on a brand-new row
        // must still default active, so only an explicit false carries over.
        active: existing.active !== false,
        registeredAt: existing.registeredAt || timestamp,
        updatedAt: timestamp,
        updatedBy: admin.email,
        identityKeyHash: existing.identityKeyHash || '',
        identityBoundAt: existing.identityBoundAt || '',
        identitySource: 'ADMIN_UPDATE',
        lastLoginAt: existing.lastLoginAt || ''
      };
    });
    invalidateContext();
    return { ok: true, email: email, section: section.key, sectionLabel: section.label };
  }

  /** Safe subset of a roster row for the admin user-management screen. */
  function summarizeUser(profile) {
    if (!profile) return null;
    var section = profile.section && PMS.CONFIG.SECTIONS[profile.section] ? PMS.CONFIG.SECTIONS[profile.section] : null;
    return {
      email: profile.email,
      name: profile.name,
      section: profile.section || '',
      sectionLabel: section ? section.label : '',
      role: profile.role,
      isAdmin: Boolean(profile.isAdmin),
      canManageAssets: Boolean(profile.canManageAssets),
      active: profile.active !== false,
      registeredAt: profile.registeredAt || '',
      lastLoginAt: profile.lastLoginAt || ''
    };
  }

  /** Administrator-only: the full roster for the user-management screen. */
  function adminListUsers() {
    requireAdmin();
    var users = PMS.Users.listProfiles().map(summarizeUser).sort(function (a, b) {
      return a.email.localeCompare(b.email);
    });
    return { ok: true, users: users };
  }

  /** Administrator-only: bare-provisions a new roster row so that email can self-register at next sign-in. */
  function adminAddUser(userEmail) {
    var admin = requireAdmin();
    var email = PMS.Util.normalizeEmail(userEmail);
    var domain = '@' + PMS.CONFIG.ALLOWED_DOMAIN.toLowerCase();
    if (!email || email.slice(-domain.length) !== domain) {
      PMS.Util.fail('A valid YDC email is required.', 'VALIDATION_ERROR');
    }
    var updated = PMS.Users.update(email, function (existing) {
      if (existing) {
        PMS.Util.fail('That user is already on the PMS roster.', 'ALREADY_EXISTS');
      }
      return { email: email, updatedBy: admin.email };
    });
    invalidateContext();
    return Object.assign({ ok: true }, summarizeUser(updated));
  }

  /**
   * Administrator-only: applies IT section, Asset Manager permission and/or
   * active status to an existing roster row in one write. Only the fields
   * present in `changes` are touched — everything else is left exactly as it
   * was, so editing one field can never silently reset another (a prior bug
   * in adminSetUserSection reactivated disabled accounts this way). This
   * never accepts isAdmin: administrator status is always recomputed from
   * the configured admin allowlist, never a per-user editable field.
   */
  function adminUpdateUser(userEmail, changes) {
    var admin = requireAdmin();
    var email = PMS.Util.normalizeEmail(userEmail);
    var domain = '@' + PMS.CONFIG.ALLOWED_DOMAIN.toLowerCase();
    if (!email || email.slice(-domain.length) !== domain) {
      PMS.Util.fail('A valid YDC email is required.', 'VALIDATION_ERROR');
    }
    var request = changes || {};
    var section = request.section !== undefined ? PMS.Util.section(request.section) : null;
    if (request.active === false && email === admin.email) {
      PMS.Util.fail('You cannot deactivate your own account.', 'VALIDATION_ERROR');
    }
    var updated = PMS.Users.update(email, function (existing) {
      if (!existing) {
        PMS.Util.fail('That user is not on the PMS roster yet. Add them first.', 'NOT_FOUND');
      }
      var patch = { email: email, updatedBy: admin.email };
      if (section) patch.section = section.key;
      if (request.canManageAssets !== undefined) patch.canManageAssets = Boolean(request.canManageAssets);
      if (request.active !== undefined) patch.active = Boolean(request.active);
      return patch;
    });
    invalidateContext();
    return Object.assign({ ok: true }, summarizeUser(updated));
  }

  /**
   * Read-only troubleshooting helper. Reports whether Google exposed an email
   * and whether that email is on the roster, without changing any data.
   */
  function diagnostics() {
    var active = '';
    var effective = '';
    try {
      active = PMS.Util.normalizeEmail(Session.getActiveUser().getEmail());
    } catch (error) {
      active = 'ERROR: ' + error.message;
    }
    try {
      effective = PMS.Util.normalizeEmail(Session.getEffectiveUser().getEmail());
    } catch (error) {
      effective = 'ERROR: ' + error.message;
    }
    var resolved = sessionEmail();
    var profile = null;
    if (resolved) {
      try {
        profile = PMS.Users.findByEmail(resolved);
      } catch (error) {
        profile = { lookupError: error.message };
      }
    }
    var directory;
    try {
      directory = PMS.Users.directoryDiagnostics();
    } catch (error) {
      directory = { error: error.message };
    }
    var administrators = configuredAdminEmails();
    var canRunSetup = resolved
      ? PMS.CONFIG.ADMIN_EMAILS.map(PMS.Util.normalizeEmail).indexOf(resolved) >= 0
      : false;
    return {
      activeUserEmail: active,
      effectiveUserEmail: effective,
      resolvedEmail: resolved,
      allowedDomain: PMS.CONFIG.ALLOWED_DOMAIN,
      requireDirectoryEntry: PMS.CONFIG.REQUIRE_DIRECTORY_ENTRY,
      onRoster: Boolean(profile && profile.email),
      rosterSection: profile && profile.section ? profile.section : '',
      rosterActive: profile ? profile.active !== false : null,
      isConfiguredAdmin: resolved ? isAdmin(resolved) : false,
      canRunSetupDeployment: canRunSetup,
      staticBootstrapAdmins: PMS.CONFIG.ADMIN_EMAILS.slice(),
      administrators: administrators,
      directory: directory
    };
  }

  return {
    currentEmail: currentEmail,
    getContext: getContext,
    invalidateContext: invalidateContext,
    register: register,
    requireProfile: requireProfile,
    requireAdmin: requireAdmin,
    requireAssetManager: requireAssetManager,
    isAdmin: isAdmin,
    configuredAdminEmails: configuredAdminEmails,
    adminSetUserSection: adminSetUserSection,
    adminSetAssetManager: adminSetAssetManager,
    adminListUsers: adminListUsers,
    adminAddUser: adminAddUser,
    adminUpdateUser: adminUpdateUser,
    diagnostics: diagnostics
  };
})();
