var PMS = PMS || {};

PMS.Auth = (function () {
  function liveEmail() {
    var email = '';
    try {
      email = PMS.Util.normalizeEmail(Session.getActiveUser().getEmail());
    } catch (error) {
      console.warn('The active Google account email is unavailable: ' + error.message);
    }
    if (!email) return '';
    var domain = '@' + PMS.CONFIG.ALLOWED_DOMAIN.toLowerCase();
    if (email.slice(-domain.length) !== domain) {
      PMS.Util.fail('Access is restricted to ' + PMS.CONFIG.ALLOWED_DOMAIN + ' accounts.', 'ACCESS_DENIED');
    }
    return email;
  }

  function temporaryIdentityHash() {
    var key = '';
    try {
      key = String(Session.getTemporaryActiveUserKey() || '');
    } catch (error) {
      console.warn('The temporary active-user key is unavailable: ' + error.message);
    }
    return key ? PMS.Util.hashText(key) : '';
  }

  function failIdentityUnavailable(requireLive) {
    PMS.Util.fail(
      requireLive
        ? 'Google could not verify your live account email. Sign in again with your YDC account before registering or performing an administrator action.'
        : 'Your Google account could not be identified. Open the domain-restricted production deployment and sign in with your YDC account.',
      'IDENTITY_UNAVAILABLE'
    );
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

  function readProfile(email) {
    return PMS.Users.findByEmail(email);
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

  function resolveIdentity(requireLive) {
    var email = liveEmail();
    var keyHash = temporaryIdentityHash();
    if (email) {
      return {
        email: email,
        keyHash: keyHash,
        source: 'GOOGLE_ACCOUNT',
        profile: null
      };
    }
    if (requireLive) failIdentityUnavailable(true);
    var profile = keyHash ? PMS.Users.findByIdentityKey(keyHash) : null;
    if (!profile) failIdentityUnavailable(false);
    return {
      email: profile.email,
      keyHash: keyHash,
      source: profile.identitySource === 'EMAIL_OTP' ? 'EMAIL_OTP' : 'TEMPORARY_KEY',
      profile: profile
    };
  }

  function currentEmail() {
    return resolveIdentity(true).email;
  }

  function getContext(requireLiveIdentity) {
    var identity = resolveIdentity(Boolean(requireLiveIdentity));
    var email = identity.email;
    var profile = identity.profile || readProfile(email);
    if (profile && profile.active !== false) {
      var mustBindIdentity = identity.source === 'GOOGLE_ACCOUNT' && identity.keyHash &&
        profile.identityKeyHash !== identity.keyHash;
      var touchCache = CacheService.getScriptCache();
      var touchCacheKey = 'PMS_USER_TOUCH_' + PMS.Util.hashText(email).slice(0, 24) + '_' + identity.source;
      var recentlyTouched = false;
      try {
        recentlyTouched = !mustBindIdentity && Boolean(touchCache.get(touchCacheKey));
      } catch (cacheError) {
        console.warn('Unable to read the PMS user-login cache: ' + cacheError.message);
      }
      if (!recentlyTouched) {
        profile = PMS.Users.touchLogin(email, {
          identityKeyHash: identity.source === 'GOOGLE_ACCOUNT' ? identity.keyHash : '',
          identitySource: identity.source
        }) || profile;
        try {
          touchCache.put(touchCacheKey, '1', 900);
        } catch (cacheWriteError) {
          console.warn('Unable to update the PMS user-login cache: ' + cacheWriteError.message);
        }
      }
    }
    var name = profile && profile.name ? profile.name : displayNameFromEmail(email);
    // A key-only continuity session may use the technician workflow, but it
    // never inherits administrator privileges. requireAdmin() independently
    // demands a live Google identity.
    var liveAdministrator = identity.source === 'GOOGLE_ACCOUNT' && isAdmin(email);
    return {
      email: email,
      name: name,
      registered: Boolean(profile && profile.active !== false && profile.section),
      active: profile ? profile.active !== false : true,
      section: profile && profile.active !== false ? profile.section : '',
      sectionLabel: profile && profile.section && PMS.CONFIG.SECTIONS[profile.section]
        ? PMS.CONFIG.SECTIONS[profile.section].label
        : '',
      isAdmin: liveAdministrator,
      role: liveAdministrator ? 'ADMIN' : 'TECHNICIAN',
      identitySource: identity.source,
      registeredAt: profile ? profile.registeredAt : '',
      updatedAt: profile ? profile.updatedAt : '',
      lastLoginAt: profile ? profile.lastLoginAt : ''
    };
  }

  function register(registration) {
    var request = registration && typeof registration === 'object'
      ? registration
      : { section: registration };
    // Registration is also available after an email code has securely bound
    // this browser's temporary Google identity to a PMS Users row.
    var identity = resolveIdentity(false);
    var email = identity.email;
    var section = PMS.Util.section(request.section);
    var requestedName = PMS.Util.cleanText(request.displayName, 250);
    PMS.Users.update(email, function (existing) {
      if (existing && existing.active === false) {
        PMS.Util.fail('Your PMS account is inactive. Ask a PMS administrator for access.', 'ACCOUNT_DISABLED');
      }
      if (existing && existing.active !== false && existing.section && existing.section !== section.key) {
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
        identityKeyHash: identity.keyHash || (existing && existing.identityKeyHash) || '',
        identityBoundAt: identity.keyHash && (!existing || existing.identityKeyHash !== identity.keyHash)
          ? timestamp
          : (existing && existing.identityBoundAt) || '',
        identitySource: identity.source
      };
    });
    return getContext(false);
  }

  function requireProfile() {
    var context = getContext();
    if (!context.active) {
      PMS.Util.fail('Your PMS account is inactive. Ask a PMS administrator for access.', 'ACCOUNT_DISABLED');
    }
    if (!context.registered) {
      PMS.Util.fail('Complete IT section registration before using the PMS form.', 'REGISTRATION_REQUIRED');
    }
    PMS.Util.section(context.section);
    return context;
  }

  function requireAdmin() {
    var context = getContext(true);
    if (!context.active) {
      PMS.Util.fail('Your PMS account is inactive. Ask a PMS administrator for access.', 'ACCOUNT_DISABLED');
    }
    if (!context.registered) {
      PMS.Util.fail('Complete IT section registration before using administrator tools.', 'REGISTRATION_REQUIRED');
    }
    if (!context.isAdmin) {
      PMS.Util.fail('Administrator access is required.', 'ACCESS_DENIED');
    }
    return context;
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
        active: true,
        registeredAt: existing.registeredAt || timestamp,
        updatedAt: timestamp,
        updatedBy: admin.email,
        identityKeyHash: existing.identityKeyHash || '',
        identityBoundAt: existing.identityBoundAt || '',
        identitySource: 'ADMIN_UPDATE',
        lastLoginAt: existing.lastLoginAt || ''
      };
    });
    return { ok: true, email: email, section: section.key, sectionLabel: section.label };
  }

  return {
    currentEmail: currentEmail,
    getContext: getContext,
    register: register,
    requireProfile: requireProfile,
    requireAdmin: requireAdmin,
    isAdmin: isAdmin,
    configuredAdminEmails: configuredAdminEmails,
    adminSetUserSection: adminSetUserSection
  };
})();
