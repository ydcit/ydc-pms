var PMS = PMS || {};

/**
 * Email-code fallback for deployments where Apps Script does not expose the
 * active user's email. The code binds the current temporary Google identity
 * to a private PMS Users row; it never grants administrator privileges.
 */
PMS.Identity = (function () {
  var SECRET_PROPERTY = 'PMS_IDENTITY_OTP_SECRET_V1';
  var CHALLENGE_PREFIX = 'PMS_IDENTITY_OTP_CHALLENGE_';
  var IDENTITY_RATE_PREFIX = 'PMS_IDENTITY_OTP_RATE_ID_';
  var EMAIL_RATE_PREFIX = 'PMS_IDENTITY_OTP_RATE_EMAIL_';
  var DAILY_RATE_PROPERTY = 'PMS_IDENTITY_OTP_RATE_DAILY';
  var CLEANUP_PROPERTY = 'PMS_IDENTITY_OTP_LAST_CLEANUP';
  var LOCK_TIMEOUT_MS = 10000;
  var CODE_LENGTH = 6;
  var GENERIC_MESSAGE = 'If that address is an eligible YDC account, a verification code has been sent.';

  function genericRequestResponse() {
    return {
      ok: true,
      message: GENERIC_MESSAGE,
      expiresInSeconds: PMS.CONFIG.IDENTITY_CODE_TTL_SECONDS,
      cooldownSeconds: PMS.CONFIG.IDENTITY_CODE_COOLDOWN_SECONDS
    };
  }

  function unavailable() {
    PMS.Util.fail(
      'Email verification is temporarily unavailable. Please try again later or contact the PMS administrator.',
      'OTP_UNAVAILABLE'
    );
  }

  function withScriptLock(callback) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
      PMS.Util.fail('Identity verification is busy. Please try again.', 'BUSY');
    }
    try {
      return callback();
    } finally {
      lock.releaseLock();
    }
  }

  function temporaryIdentity() {
    var key = '';
    try {
      key = String(Session.getTemporaryActiveUserKey() || '').trim();
    } catch (error) {
      console.warn('The temporary active-user key is unavailable: ' + error.message);
    }
    if (!key) {
      PMS.Util.fail(
        'Google could not establish a secure browser identity for this session. Reload the domain-restricted web app and try again.',
        'IDENTITY_UNAVAILABLE'
      );
    }
    return { hash: PMS.Util.hashText(key) };
  }

  function eligibleEmail(value) {
    var email = '';
    try {
      email = PMS.Util.normalizeEmail(value);
    } catch (error) {
      return '';
    }
    if (!email || email.length > 254 || /\s/.test(email)) return '';
    var parts = email.split('@');
    if (parts.length !== 2 || !parts[0] || parts[1] !== PMS.CONFIG.ALLOWED_DOMAIN.toLowerCase()) return '';
    if (parts[0].charAt(0) === '.' || parts[0].slice(-1) === '.' || parts[0].indexOf('..') >= 0) return '';
    if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(parts[0])) return '';
    return email;
  }

  function bytesToHex(bytes) {
    return bytes.map(function (value) {
      var normalized = value < 0 ? value + 256 : value;
      return ('0' + normalized.toString(16)).slice(-2);
    }).join('');
  }

  function hmacBytes(secret, value) {
    return Utilities.computeHmacSha256Signature(String(value), String(secret));
  }

  function hmacHex(secret, value) {
    return bytesToHex(hmacBytes(secret, value));
  }

  function secret(properties) {
    var value = properties.getProperty(SECRET_PROPERTY);
    if (value) return value;
    var seed = [Utilities.getUuid(), Utilities.getUuid(), Date.now(), ScriptApp.getScriptId()].join('|');
    value = Utilities.base64EncodeWebSafe(
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed, Utilities.Charset.UTF_8)
    ).replace(/=+$/g, '');
    properties.setProperty(SECRET_PROPERTY, value);
    return value;
  }

  function randomSixDigitCode(secretValue, identityHash, now) {
    // Rejection sampling avoids modulo bias while retaining leading zeroes.
    var upperBound = Math.floor(4294967296 / 1000000) * 1000000;
    for (var round = 0; round < 8; round += 1) {
      var bytes = hmacBytes(
        secretValue,
        [Utilities.getUuid(), Utilities.getUuid(), identityHash, now, round].join('|')
      );
      for (var index = 0; index + 3 < bytes.length; index += 4) {
        var first = bytes[index] < 0 ? bytes[index] + 256 : bytes[index];
        var second = bytes[index + 1] < 0 ? bytes[index + 1] + 256 : bytes[index + 1];
        var third = bytes[index + 2] < 0 ? bytes[index + 2] + 256 : bytes[index + 2];
        var fourth = bytes[index + 3] < 0 ? bytes[index + 3] + 256 : bytes[index + 3];
        var number = first * 16777216 + second * 65536 + third * 256 + fourth;
        if (number < upperBound) return String(number % 1000000).padStart(CODE_LENGTH, '0');
      }
    }
    PMS.Util.fail('Unable to create a verification code. Please try again.', 'OTP_UNAVAILABLE');
  }

  function codeHash(secretValue, state, code) {
    return hmacHex(secretValue, [
      state.purpose,
      state.salt,
      state.identityHash,
      state.emailHash,
      code
    ].join('|'));
  }

  function constantTimeEquals(left, right) {
    var first = String(left || '');
    var second = String(right || '');
    var difference = first.length ^ second.length;
    var length = Math.max(first.length, second.length);
    for (var index = 0; index < length; index += 1) {
      difference |= (first.charCodeAt(index) || 0) ^ (second.charCodeAt(index) || 0);
    }
    return difference === 0;
  }

  function parseProperty(properties, key) {
    var raw = properties.getProperty(key);
    if (!raw) return null;
    try {
      var value = JSON.parse(raw);
      return value && typeof value === 'object' ? value : null;
    } catch (error) {
      properties.deleteProperty(key);
      return null;
    }
  }

  function rateState(properties, key, now) {
    var state = parseProperty(properties, key);
    var windowMs = PMS.CONFIG.IDENTITY_CODE_REQUEST_WINDOW_SECONDS * 1000;
    if (!state || !Number.isFinite(Number(state.windowStartedAt)) ||
        now - Number(state.windowStartedAt) >= windowMs || now < Number(state.windowStartedAt)) {
      return { windowStartedAt: now, count: 0, lastSentAt: 0 };
    }
    return {
      windowStartedAt: Number(state.windowStartedAt),
      count: Math.max(0, Number(state.count) || 0),
      lastSentAt: Math.max(0, Number(state.lastSentAt) || 0)
    };
  }

  function canIssueCode(identityRate, emailRate, now) {
    var cooldownMs = PMS.CONFIG.IDENTITY_CODE_COOLDOWN_SECONDS * 1000;
    var maximum = PMS.CONFIG.IDENTITY_CODE_MAX_REQUESTS_PER_WINDOW;
    return identityRate.count < maximum && emailRate.count < maximum &&
      now - identityRate.lastSentAt >= cooldownMs && now - emailRate.lastSentAt >= cooldownMs;
  }

  function recordCodeIssue(properties, key, state, now) {
    state.count += 1;
    state.lastSentAt = now;
    properties.setProperty(key, JSON.stringify(state));
  }

  function dailyRateState(properties, now) {
    var day = Utilities.formatDate(new Date(now), PMS.CONFIG.TIME_ZONE, 'yyyy-MM-dd');
    var state = parseProperty(properties, DAILY_RATE_PROPERTY);
    if (!state || state.day !== day) return { day: day, count: 0 };
    return { day: day, count: Math.max(0, Number(state.count) || 0) };
  }

  function cleanupExpiredState(properties, now) {
    var lastCleanup = Number(properties.getProperty(CLEANUP_PROPERTY) || 0);
    if (lastCleanup && now - lastCleanup < 60 * 60 * 1000) return;
    var values = properties.getProperties();
    var staleRateAge = PMS.CONFIG.IDENTITY_CODE_REQUEST_WINDOW_SECONDS * 2 * 1000;
    Object.keys(values).forEach(function (key) {
      if (key.indexOf(CHALLENGE_PREFIX) === 0) {
        var challenge = parseProperty(properties, key);
        if (!challenge || Number(challenge.expiresAt || 0) < now) properties.deleteProperty(key);
      } else if (key.indexOf(IDENTITY_RATE_PREFIX) === 0 || key.indexOf(EMAIL_RATE_PREFIX) === 0) {
        var rate = parseProperty(properties, key);
        if (!rate || now - Number(rate.windowStartedAt || 0) > staleRateAge) properties.deleteProperty(key);
      }
    });
    properties.setProperty(CLEANUP_PROPERTY, String(now));
  }

  function sendCode(email, code) {
    if (MailApp.getRemainingDailyQuota() < 1) {
      throw new Error('The deployment mail quota is exhausted.');
    }
    var minutes = Math.round(PMS.CONFIG.IDENTITY_CODE_TTL_SECONDS / 60);
    MailApp.sendEmail({
      to: email,
      subject: 'Your YDC PMS verification code',
      name: PMS.CONFIG.APP_NAME,
      body: [
        'Your YDC PMS verification code is: ' + code,
        '',
        'This code expires in ' + minutes + ' minutes and can be used only once.',
        'Never share this code. YDC IT will not ask you for it.',
        'If you did not request this code, you can ignore this message.'
      ].join('\n'),
      htmlBody: '<p>Your YDC PMS verification code is:</p>' +
        '<p style="font-size:28px;font-weight:700;letter-spacing:6px">' + code + '</p>' +
        '<p>This code expires in ' + minutes + ' minutes and can be used only once.</p>' +
        '<p><strong>Never share this code.</strong> YDC IT will not ask you for it.</p>' +
        '<p>If you did not request this code, you can ignore this message.</p>'
    });
  }

  function removeUnsentChallenge(challengeKey, salt) {
    try {
      withScriptLock(function () {
        var properties = PropertiesService.getScriptProperties();
        var current = parseProperty(properties, challengeKey);
        if (current && current.salt === salt) properties.deleteProperty(challengeKey);
      });
    } catch (error) {
      console.warn('Unable to clear an unsent identity challenge: ' + error.message);
    }
  }

  function requestCode(payload) {
    var request = payload && typeof payload === 'object' ? payload : { email: payload };
    var identity = temporaryIdentity();
    var email = eligibleEmail(request.email);
    var response = genericRequestResponse();
    // Always use the same public response, including for an ineligible address.
    if (!email) return response;

    // A temporary identity already owned by another active user can never be
    // rebound through email verification. Keep the public response generic.
    try {
      var existingBinding = PMS.Users.findAnyByIdentityKey(identity.hash);
      if (existingBinding && existingBinding.email !== email) return response;
    } catch (bindingReadError) {
      console.warn('Unable to inspect the current PMS identity binding: ' + bindingReadError.message);
      return response;
    }

    var remainingMailQuota;
    try {
      remainingMailQuota = MailApp.getRemainingDailyQuota();
    } catch (quotaError) {
      console.warn('Unable to read the PMS identity mail quota: ' + quotaError.message);
      unavailable();
    }
    if (remainingMailQuota < 1) unavailable();

    var prepared = withScriptLock(function () {
      var now = Date.now();
      var properties = PropertiesService.getScriptProperties();
      cleanupExpiredState(properties, now);
      var emailHash = PMS.Util.hashText(email);
      var identityRateKey = IDENTITY_RATE_PREFIX + identity.hash;
      var emailRateKey = EMAIL_RATE_PREFIX + emailHash;
      var identityRate = rateState(properties, identityRateKey, now);
      var emailRate = rateState(properties, emailRateKey, now);
      var dailyRate = dailyRateState(properties, now);
      if (!canIssueCode(identityRate, emailRate, now) ||
          dailyRate.count >= PMS.CONFIG.IDENTITY_CODE_MAX_SENDS_PER_DAY) return null;

      var secretValue = secret(properties);
      var code = randomSixDigitCode(secretValue, identity.hash, now);
      var state = {
        version: 1,
        purpose: 'PMS-EMAIL-OTP-V1',
        identityHash: identity.hash,
        emailHash: emailHash,
        salt: Utilities.getUuid().replace(/-/g, ''),
        createdAt: now,
        expiresAt: now + PMS.CONFIG.IDENTITY_CODE_TTL_SECONDS * 1000,
        attempts: 0
      };
      state.codeHash = codeHash(secretValue, state, code);
      var challengeKey = CHALLENGE_PREFIX + identity.hash;
      properties.setProperty(challengeKey, JSON.stringify(state));
      recordCodeIssue(properties, identityRateKey, identityRate, now);
      recordCodeIssue(properties, emailRateKey, emailRate, now);
      dailyRate.count += 1;
      properties.setProperty(DAILY_RATE_PROPERTY, JSON.stringify(dailyRate));
      return { email: email, code: code, challengeKey: challengeKey, salt: state.salt };
    });

    if (!prepared) return response;
    try {
      sendCode(prepared.email, prepared.code);
    } catch (error) {
      // Do not expose delivery, quota, or account-existence details publicly.
      console.warn('Unable to send a PMS identity verification message: ' + error.message);
      removeUnsentChallenge(prepared.challengeKey, prepared.salt);
      unavailable();
    }
    return response;
  }

  function invalidCode() {
    PMS.Util.fail(
      'The verification code is invalid or expired. Request a new code and try again.',
      'OTP_INVALID'
    );
  }

  function displayNameFromEmail(email) {
    var local = String(email || '').split('@')[0];
    return local.replace(/[._-]+/g, ' ').split(' ').filter(Boolean).map(function (word) {
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }).join(' ') || email;
  }

  function bindVerifiedIdentity(email, identityHash) {
    var timestamp = PMS.Util.nowIso();
    var currentBinding = PMS.Users.findAnyByIdentityKey(identityHash);
    if (currentBinding && currentBinding.email !== email) {
      invalidCode();
    }
    try {
      return PMS.Users.update(email, function (existing) {
        if (existing && existing.active === false) {
          PMS.Util.fail('Your PMS account is inactive. Ask a PMS administrator for access.', 'ACCOUNT_DISABLED');
        }
        return Object.assign({}, existing || {}, {
          email: email,
          name: existing && existing.name ? existing.name : displayNameFromEmail(email),
          section: existing && existing.section ? existing.section : '',
          active: true,
          registeredAt: existing ? existing.registeredAt : '',
          lastLoginAt: timestamp,
          updatedBy: email,
          identityKeyHash: identityHash,
          identityBoundAt: timestamp,
          identitySource: 'EMAIL_OTP'
        });
      });
    } catch (error) {
      if (error && error.name === 'IDENTITY_CONFLICT') invalidCode();
      throw error;
    }
  }

  function verifyCode(payload) {
    var request = payload && typeof payload === 'object' ? payload : {};
    var identity = temporaryIdentity();
    var email = eligibleEmail(request.email);
    var code = '';
    try {
      code = PMS.Util.cleanText(request.code, 32);
    } catch (error) {
      code = '';
    }

    var verifiedEmail = withScriptLock(function () {
      var now = Date.now();
      var properties = PropertiesService.getScriptProperties();
      var challengeKey = CHALLENGE_PREFIX + identity.hash;
      var state = parseProperty(properties, challengeKey);
      if (!state || Number(state.version) !== 1 || state.purpose !== 'PMS-EMAIL-OTP-V1' ||
          state.identityHash !== identity.hash ||
          !Number.isFinite(Number(state.expiresAt)) || now > Number(state.expiresAt)) {
        properties.deleteProperty(challengeKey);
        invalidCode();
      }

      var attempts = Math.max(0, Number(state.attempts) || 0) + 1;
      var emailHash = email ? PMS.Util.hashText(email) : '';
      var emailMatches = constantTimeEquals(state.emailHash, emailHash);
      var formatMatches = /^\d{6}$/.test(code);
      var expectedHash = codeHash(secret(properties), state, code);
      var codeMatches = formatMatches && constantTimeEquals(state.codeHash, expectedHash);
      if (!emailMatches || !codeMatches) {
        state.attempts = attempts;
        if (attempts >= PMS.CONFIG.IDENTITY_CODE_MAX_VERIFY_ATTEMPTS) {
          properties.deleteProperty(challengeKey);
        } else {
          properties.setProperty(challengeKey, JSON.stringify(state));
        }
        invalidCode();
      }

      // Delete before touching the user directory so the code is single-use,
      // even if a later Sheets write fails and the user must request another.
      properties.deleteProperty(challengeKey);
      return email;
    });

    bindVerifiedIdentity(verifiedEmail, identity.hash);
    return PMS.Auth.getContext(false);
  }

  function readiness() {
    var result = withScriptLock(function () {
      var properties = PropertiesService.getScriptProperties();
      secret(properties);
      return true;
    });
    return {
      configured: result,
      remainingDailyMailQuota: MailApp.getRemainingDailyQuota()
    };
  }

  return {
    requestCode: requestCode,
    verifyCode: verifyCode,
    readiness: readiness
  };
})();
