var PMS = PMS || {};

/**
 * Trusted evidence uploads for the Infrastructure & Security PMS form.
 *
 * The browser never chooses a destination folder and its file metadata is
 * never written to a record directly. The server creates the Drive file,
 * derives every metadata field, and signs the returned descriptor. A later
 * draft/completion save accepts only a descriptor whose signature and immutable
 * record context verify here.
 */
PMS.Evidence = (function () {
  var TOKEN_VERSION = '1';
  var CACHE_SECONDS = 21600;
  var DESCRIPTOR_FIELDS = [
    'tokenVersion', 'evidenceKind', 'folderId', 'fileId', 'fileName', 'url',
    'mimeType', 'sizeBytes', 'sha256', 'uploadedAt', 'uploadedBy', 'recordId',
    'idempotencyKey', 'assetType', 'assetTag', 'maintenanceDate', 'cycleId',
    'itSection'
  ];
  var METADATA_SUFFIXES = Object.freeze({
    fileId: 'FileId',
    fileName: 'FileName',
    url: 'Url',
    mimeType: 'MimeType',
    sizeBytes: 'SizeBytes',
    sha256: 'Sha256',
    uploadedAt: 'UploadedAt',
    uploadedBy: 'UploadedBy'
  });
  var SAFE_EXTENSIONS = Object.freeze({
    png: true, jpg: true, jpeg: true, gif: true, webp: true, bmp: true, tif: true, tiff: true,
    pdf: true,
    txt: true, log: true, md: true, csv: true,
    json: true, xml: true, yaml: true, yml: true,
    zip: true,
    cfg: true, conf: true, config: true, ini: true, bak: true, backup: true
  });
  var DENIED_EXTENSIONS = Object.freeze({
    html: true, htm: true, xhtml: true, svg: true,
    js: true, mjs: true, cjs: true, ts: true, jsx: true, tsx: true,
    vbs: true, vbe: true, ps1: true, bat: true, cmd: true, sh: true, bash: true, zsh: true,
    exe: true, dll: true, msi: true, com: true, scr: true, jar: true, apk: true, ipa: true,
    py: true, pyc: true, php: true, pl: true, rb: true, cgi: true, asp: true, aspx: true,
    wasm: true
  });

  function evidenceConfig(kind) {
    var key = PMS.Util.cleanText(kind, 20).toLowerCase();
    var config = PMS.CONFIG.EVIDENCE[key];
    if (!config) PMS.Util.fail('Select a valid evidence category.', 'VALIDATION_ERROR');
    return config;
  }

  function ensureSecret() {
    var properties = PropertiesService.getScriptProperties();
    var secret = properties.getProperty(PMS.CONFIG.EVIDENCE_SIGNING_SECRET_PROPERTY);
    if (secret) return secret;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) PMS.Util.fail('Evidence security setup is busy. Try again.', 'BUSY');
    try {
      secret = properties.getProperty(PMS.CONFIG.EVIDENCE_SIGNING_SECRET_PROPERTY);
      if (!secret) {
        secret = PMS.Util.hashText(Utilities.getUuid() + '|' + Utilities.getUuid() + '|' + new Date().getTime());
        properties.setProperty(PMS.CONFIG.EVIDENCE_SIGNING_SECRET_PROPERTY, secret);
      }
      return secret;
    } finally {
      lock.releaseLock();
    }
  }

  function canonical(descriptor) {
    return DESCRIPTOR_FIELDS.map(function (key) {
      var value = descriptor[key];
      return key + '=' + encodeURIComponent(value === undefined || value === null ? '' : String(value));
    }).join('&');
  }

  function signature(descriptor) {
    var bytes = Utilities.computeHmacSha256Signature(
      canonical(descriptor),
      ensureSecret(),
      Utilities.Charset.UTF_8
    );
    return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
  }

  function constantTimeEqual(left, right) {
    var a = String(left || '');
    var b = String(right || '');
    var difference = a.length ^ b.length;
    var length = Math.max(a.length, b.length);
    for (var index = 0; index < length; index += 1) {
      difference |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
    }
    return difference === 0;
  }

  function maintenanceDateText(value) {
    if (Object.prototype.toString.call(value) === '[object Date]') {
      return Utilities.formatDate(value, PMS.CONFIG.TIME_ZONE, 'yyyy-MM-dd');
    }
    var text = PMS.Util.cleanText(value, 50);
    var match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
    return match ? match[1] : text;
  }

  function timestampText(value) {
    if (Object.prototype.toString.call(value) === '[object Date]') {
      return Utilities.formatDate(value, PMS.CONFIG.TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
    }
    return PMS.Util.cleanText(value, 100);
  }

  function cleanDescriptor(raw) {
    var source = raw && typeof raw === 'object' ? raw : {};
    var descriptor = {
      tokenVersion: PMS.Util.cleanText(source.tokenVersion, 10),
      evidenceKind: PMS.Util.cleanText(source.evidenceKind, 20).toLowerCase(),
      folderId: PMS.Util.cleanText(source.folderId, 200),
      fileId: PMS.Util.cleanText(source.fileId, 200),
      fileName: PMS.Util.cleanText(source.fileName, 255),
      url: PMS.Util.cleanText(source.url, 1000),
      mimeType: PMS.Util.cleanText(source.mimeType, 200).toLowerCase(),
      sizeBytes: Number(source.sizeBytes),
      sha256: PMS.Util.cleanText(source.sha256, 64).toLowerCase(),
      uploadedAt: timestampText(source.uploadedAt),
      uploadedBy: PMS.Util.normalizeEmail(source.uploadedBy),
      recordId: PMS.Util.cleanText(source.recordId, 100),
      idempotencyKey: PMS.Util.cleanText(source.idempotencyKey, 200),
      assetType: PMS.Util.cleanText(source.assetType, 100),
      assetTag: PMS.Util.normalizeAssetTag(source.assetTag),
      maintenanceDate: maintenanceDateText(source.maintenanceDate),
      cycleId: PMS.Util.cleanText(source.cycleId, 20),
      itSection: PMS.Util.cleanText(source.itSection, 40).toUpperCase(),
      signature: PMS.Util.cleanText(source.signature, 200)
    };
    if (descriptor.tokenVersion !== TOKEN_VERSION || !/^[A-Za-z0-9_-]{10,}$/.test(descriptor.fileId) ||
        !descriptor.fileName || !/^https:\/\/drive\.google\.com\//i.test(descriptor.url) ||
        descriptor.url.indexOf(descriptor.fileId) < 0 ||
        !descriptor.uploadedAt || !descriptor.uploadedBy ||
        !Number.isInteger(descriptor.sizeBytes) || descriptor.sizeBytes < 1 ||
        descriptor.sizeBytes > PMS.CONFIG.MAX_EVIDENCE_BYTES ||
        !/^[a-f0-9]{64}$/.test(descriptor.sha256) ||
        !/^PMS-\d{4}-T[123]-[A-F0-9]{32}$/.test(descriptor.recordId) ||
        !descriptor.idempotencyKey || PMS.CONFIG.INFRA_ASSET_TYPES.indexOf(descriptor.assetType) < 0 ||
        !descriptor.assetTag || !/^\d{4}-\d{2}-\d{2}$/.test(descriptor.maintenanceDate) ||
        !/^\d{4}-T[123]$/.test(descriptor.cycleId) || descriptor.itSection !== 'INFRA_SECURITY') {
      PMS.Util.fail('The uploaded evidence descriptor is invalid. Upload the file again.', 'EVIDENCE_INVALID');
    }
    validateIdempotencyKey(descriptor.idempotencyKey);
    return descriptor;
  }

  function compareExpected(descriptor, expected) {
    var source = expected && typeof expected === 'object' ? expected : {};
    var keys = [
      'recordId', 'evidenceKind', 'idempotencyKey', 'assetType', 'assetTag',
      'maintenanceDate', 'cycleId', 'itSection', 'uploadedBy'
    ];
    keys.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(source, key) || source[key] === null) return;
      var expectedValue = key === 'uploadedBy'
        ? PMS.Util.normalizeEmail(source[key])
        : key === 'assetTag'
          ? PMS.Util.normalizeAssetTag(source[key])
          : key === 'maintenanceDate'
            ? maintenanceDateText(source[key])
            : String(source[key]);
      if (String(descriptor[key]) !== expectedValue) {
        PMS.Util.fail('Uploaded evidence does not belong to this maintenance record.', 'EVIDENCE_MISMATCH');
      }
    });
  }

  function verifyStoredFile(descriptor) {
    try {
      var file = DriveApp.getFileById(descriptor.fileId);
      if (file.isTrashed()) throw new Error('Evidence file is in trash.');
      var inExpectedFolder = false;
      var parents = file.getParents();
      while (parents.hasNext()) {
        if (parents.next().getId() === descriptor.folderId) {
          inExpectedFolder = true;
          break;
        }
      }
      if (!inExpectedFolder) throw new Error('Evidence file is outside its required folder.');
      if (file.getName() !== descriptor.fileName || file.getUrl() !== descriptor.url ||
          Number(file.getSize()) !== descriptor.sizeBytes ||
          String(file.getMimeType() || '').toLowerCase() !== descriptor.mimeType) {
        throw new Error('Evidence file metadata no longer matches the uploaded descriptor.');
      }
      if (hexDigest(file.getBlob().getBytes()) !== descriptor.sha256) {
        throw new Error('Evidence file contents no longer match the uploaded descriptor.');
      }
    } catch (error) {
      PMS.Util.fail(
        'Required evidence is missing, inaccessible, moved, or changed. Upload it again.',
        'EVIDENCE_MISSING'
      );
    }
  }

  function verifyDescriptor(raw, expected) {
    var descriptor = cleanDescriptor(raw);
    var config = evidenceConfig(descriptor.evidenceKind);
    if (descriptor.itSection !== 'INFRA_SECURITY' || descriptor.folderId !== config.folderId) {
      PMS.Util.fail('Uploaded evidence has an invalid destination.', 'EVIDENCE_INVALID');
    }
    if (!constantTimeEqual(descriptor.signature, signature(descriptor))) {
      PMS.Util.fail('Uploaded evidence could not be authenticated. Upload the file again.', 'EVIDENCE_INVALID');
    }
    compareExpected(descriptor, expected);
    if (expected && expected.requireStoredFile === true) verifyStoredFile(descriptor);
    return descriptor;
  }

  function evidenceRecordKeys(kind) {
    var prefix = evidenceConfig(kind).recordPrefix;
    var keys = {};
    Object.keys(METADATA_SUFFIXES).forEach(function (key) {
      keys[key] = prefix + METADATA_SUFFIXES[key];
    });
    return keys;
  }

  function descriptorFromRecord(record, kind) {
    var source = record && typeof record === 'object' ? record : {};
    var config = evidenceConfig(kind);
    var keys = evidenceRecordKeys(kind);
    if (!source[keys.fileId]) return null;
    var descriptor = {
      tokenVersion: TOKEN_VERSION,
      evidenceKind: config.key,
      folderId: config.folderId,
      fileId: String(source[keys.fileId] || ''),
      fileName: String(source[keys.fileName] || ''),
      url: String(source[keys.url] || ''),
      mimeType: String(source[keys.mimeType] || '').toLowerCase(),
      sizeBytes: Number(source[keys.sizeBytes]),
      sha256: String(source[keys.sha256] || '').toLowerCase(),
      uploadedAt: timestampText(source[keys.uploadedAt] || ''),
      uploadedBy: PMS.Util.normalizeEmail(source[keys.uploadedBy] || source.technicianEmail),
      recordId: String(source.recordId || ''),
      idempotencyKey: String(source.idempotencyKey || ''),
      assetType: String(source.assetType || ''),
      assetTag: PMS.Util.normalizeAssetTag(source.assetTag),
      maintenanceDate: maintenanceDateText(source.maintenanceDate),
      cycleId: String(source.cycleId || ''),
      itSection: String(source.itSection || '').toUpperCase()
    };
    descriptor.signature = signature(descriptor);
    return cleanDescriptor(descriptor);
  }

  /** Revalidates both stored Infra evidence files before tracker synchronization. */
  function verifyRecordEvidence(record) {
    var source = record && typeof record === 'object' ? record : {};
    if (String(source.itSection || '').toUpperCase() !== 'INFRA_SECURITY') {
      return { ok: true, evidence: {} };
    }
    var evidence = {};
    Object.keys(PMS.CONFIG.EVIDENCE).forEach(function (kind) {
      var recordKeys = evidenceRecordKeys(kind);
      var descriptor = descriptorFromRecord(source, kind);
      if (!descriptor) {
        PMS.Util.fail(PMS.CONFIG.EVIDENCE[kind].label + ' is missing.', 'EVIDENCE_MISSING');
      }
      evidence[kind] = verifyDescriptor(descriptor, {
        recordId: source.recordId,
        idempotencyKey: source.idempotencyKey,
        assetType: source.assetType,
        assetTag: source.assetTag,
        maintenanceDate: source.maintenanceDate,
        cycleId: source.cycleId,
        itSection: source.itSection,
        evidenceKind: kind,
        uploadedBy: source[recordKeys.uploadedBy] || source.technicianEmail,
        requireStoredFile: true
      });
    });
    return { ok: true, evidence: evidence };
  }

  function hexDigest(bytes) {
    return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(function (value) {
      var normalized = value < 0 ? value + 256 : value;
      return ('0' + normalized.toString(16)).slice(-2);
    }).join('');
  }

  function extensionOf(fileName) {
    var match = /\.([A-Za-z0-9]{1,12})$/.exec(String(fileName || '').trim());
    return match ? match[1].toLowerCase() : '';
  }

  function asciiPrefix(bytes, limit) {
    return bytes.slice(0, limit || 512).map(function (value) {
      var normalized = value < 0 ? value + 256 : value;
      return normalized >= 32 && normalized <= 126 ? String.fromCharCode(normalized) : ' ';
    }).join('').toLowerCase();
  }

  function validateFile(blob, bytes) {
    var originalName = PMS.Util.cleanText(blob.getName(), 255);
    var extension = extensionOf(originalName);
    var mimeType = PMS.Util.cleanText(blob.getContentType() || 'application/octet-stream', 200).toLowerCase();
    if (!extension || DENIED_EXTENSIONS[extension] || !SAFE_EXTENSIONS[extension]) {
      PMS.Util.fail('This evidence file type is not allowed.', 'EVIDENCE_TYPE_NOT_ALLOWED');
    }
    if (/html|javascript|ecmascript|executable|x-msdownload|x-dosexec|shellscript/.test(mimeType) ||
        mimeType === 'image/svg+xml') {
      PMS.Util.fail('Scripts, executable files, and HTML are not allowed as evidence.', 'EVIDENCE_TYPE_NOT_ALLOWED');
    }
    var allowedMime = /^(image\/(png|jpeg|gif|webp|bmp|tiff)|application\/(pdf|json|xml|yaml|x-yaml|zip|x-zip-compressed|octet-stream)|text\/(plain|csv|markdown|xml|yaml|x-yaml))$/;
    if (!allowedMime.test(mimeType)) {
      PMS.Util.fail('This evidence MIME type is not allowed.', 'EVIDENCE_TYPE_NOT_ALLOWED');
    }
    if (!bytes.length) PMS.Util.fail('Evidence files cannot be empty.', 'EVIDENCE_EMPTY');
    if (bytes.length > PMS.CONFIG.MAX_EVIDENCE_BYTES) {
      PMS.Util.fail('Each evidence file must be 10 MiB or smaller.', 'EVIDENCE_TOO_LARGE');
    }
    var first = bytes.slice(0, 4).map(function (value) { return value < 0 ? value + 256 : value; });
    var magic = first.map(function (value) { return ('0' + (value || 0).toString(16)).slice(-2); }).join('');
    var prefix = asciiPrefix(bytes, 4096).trim();
    var executableMagic = (first[0] === 77 && first[1] === 90) ||
      (first[0] === 127 && first[1] === 69 && first[2] === 76 && first[3] === 70) ||
      ['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', '0061736d'].indexOf(magic) >= 0;
    var activeMarkup = /<!doctype\s+html\b|<html(?:\s|>)|<script(?:\s|>)|<iframe(?:\s|>)|<svg(?:\s|>)/.test(prefix);
    if (executableMagic || prefix.indexOf('#!') === 0 || activeMarkup) {
      PMS.Util.fail('Scripts, executable files, and HTML are not allowed as evidence.', 'EVIDENCE_TYPE_NOT_ALLOWED');
    }
    return { originalName: originalName, extension: extension, mimeType: mimeType };
  }

  function safeSegment(value, fallback, maximum) {
    var segment = String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/^[_\-.]+|[_\-.]+$/g, '')
      .replace(/_+/g, '_');
    return (segment || fallback || 'UNKNOWN').slice(0, maximum || 80);
  }

  function validateIdempotencyKey(value) {
    var key = PMS.Util.cleanText(value, 200);
    var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    var fallback = /^pms-\d{10,16}-[a-z0-9]{4,24}-[a-z0-9]{4,24}$/i;
    if (!uuid.test(key) && !fallback.test(key)) {
      PMS.Util.fail('The request identifier is invalid. Reopen the questionnaire and try again.', 'VALIDATION_ERROR');
    }
    return key;
  }

  function existingRecord(input, profile) {
    var record = null;
    if (input.recordId) {
      record = PMS.Records.findByRecordId(input.recordId);
      if (!record) PMS.Util.fail('The PMS draft was not found. Reopen the questionnaire.', 'NOT_FOUND');
    } else if (typeof PMS.Records.findByIdempotencyKey === 'function') {
      record = PMS.Records.findByIdempotencyKey(input.idempotencyKey);
    }
    if (!record) return null;
    if (PMS.Util.normalizeEmail(record.technicianEmail) !== profile.email || record.itSection !== 'INFRA_SECURITY') {
      PMS.Util.fail('You cannot upload evidence for another technician or IT section.', 'ACCESS_DENIED');
    }
    if (PMS.Util.completionState(record.pmsCompletion) === 'COMPLETED') {
      PMS.Util.fail('Completed PMS evidence cannot be replaced.', 'RECORD_LOCKED');
    }
    var comparisons = {
      idempotencyKey: input.idempotencyKey,
      assetTag: input.assetTag,
      assetType: input.assetType
    };
    Object.keys(comparisons).forEach(function (key) {
      if (String(record[key] || '') !== String(comparisons[key] || '')) {
        PMS.Util.fail('Asset, date, and request details cannot change after a draft is created.', 'VALIDATION_ERROR');
      }
    });
    if (maintenanceDateText(record.maintenanceDate) !== input.maintenanceDate) {
      PMS.Util.fail('Asset, date, and request details cannot change after a draft is created.', 'VALIDATION_ERROR');
    }
    return record;
  }

  function cacheKey(input, sha256) {
    return 'PMS_EVIDENCE_' + PMS.Util.hashText([
      input.uploadedBy, input.idempotencyKey, input.evidenceKind, sha256
    ].join('|')).slice(0, 36);
  }

  function upload(formObject) {
    var profile = PMS.Auth.requireProfile();
    if (profile.section !== 'INFRA_SECURITY') {
      PMS.Util.fail('Evidence uploads are available only to Infrastructure & Security.', 'ACCESS_DENIED');
    }
    var source = formObject && typeof formObject === 'object' ? formObject : {};
    var config = evidenceConfig(source.evidenceKind);
    var assetTag = PMS.Util.normalizeAssetTag(source.assetTag);
    if (!assetTag) PMS.Util.fail('Select an asset tag before uploading evidence.', 'VALIDATION_ERROR');
    var maintenanceDateValue = PMS.Util.parseDateInput(source.maintenanceDate);
    var maintenanceDate = Utilities.formatDate(maintenanceDateValue, PMS.CONFIG.TIME_ZONE, 'yyyy-MM-dd');
    var cycle = PMS.Util.deriveCycle(maintenanceDateValue);
    var idempotencyKey = validateIdempotencyKey(source.idempotencyKey);
    var recordId = PMS.Util.cleanText(source.recordId, 100);
    if (!recordId || !/^PMS-\d{4}-T[123]-[A-F0-9]{32}$/.test(recordId)) {
      PMS.Util.fail('Save the PMS draft before uploading evidence.', 'EVIDENCE_DRAFT_REQUIRED');
    }
    var assetType = PMS.Validation.normalizeInfraAssetType(source.assetType);
    PMS.Validation.validateInfraAssetType(assetTag, assetType);
    PMS.Assets.requireEligible('INFRA_SECURITY', assetTag);

    var blob = source.file || source.evidenceFile;
    if (!blob || typeof blob.getBytes !== 'function' || typeof blob.getName !== 'function') {
      PMS.Util.fail('Choose one evidence file to upload.', 'EVIDENCE_REQUIRED');
    }
    var bytes = blob.getBytes();
    var fileInfo = validateFile(blob, bytes);
    var sha256 = hexDigest(bytes);
    var input = {
      evidenceKind: config.key,
      recordId: recordId,
      idempotencyKey: idempotencyKey,
      assetType: assetType,
      assetTag: assetTag,
      maintenanceDate: maintenanceDate,
      cycleId: cycle.cycleId,
      itSection: 'INFRA_SECURITY',
      uploadedBy: profile.email
    };
    var prior = existingRecord(input, profile);
    var reusablePrior = null;
    if (prior) {
      try {
        var priorDescriptor = descriptorFromRecord(prior, config.key);
        if (priorDescriptor && priorDescriptor.sha256 === sha256) {
          reusablePrior = verifyDescriptor(priorDescriptor, Object.assign({}, input, {
            requireStoredFile: true
          }));
        }
      } catch (priorError) {
        // A missing/moved/changed prior file should not trap the technician in
        // a retry loop. Continue by creating and attaching the selected file.
        console.warn('Stored evidence will be replaced: ' + priorError.message);
      }
    }
    if (reusablePrior) {
      PMS.Records.attachEvidence(recordId, config.key, reusablePrior);
      return { ok: true, descriptor: reusablePrior, reused: true, newlyCreated: false };
    }

    // Ensure the signing key exists before taking the upload lock; ensureSecret
    // also uses the script lock during first-time initialization.
    ensureSecret();
    // A per-user lock prevents accidental duplicate uploads while allowing the
    // record attachment hook to take the script lock for its sheet update.
    var lock = LockService.getUserLock();
    if (!lock.tryLock(30000)) PMS.Util.fail('Another evidence upload is being processed. Try again.', 'BUSY');
    try {
      var cache = CacheService.getScriptCache();
      var key = cacheKey(input, sha256);
      var cached = cache.get(key);
      if (cached) {
        var cachedDescriptor = null;
        try {
          cachedDescriptor = verifyDescriptor(JSON.parse(cached), Object.assign({}, input, {
            requireStoredFile: true
          }));
        } catch (error) {
          cache.remove(key);
        }
        if (cachedDescriptor) {
          PMS.Records.attachEvidence(recordId, config.key, cachedDescriptor);
          return {
            ok: true,
            descriptor: cachedDescriptor,
            reused: true,
            newlyCreated: false
          };
        }
      }

      var timestamp = PMS.Util.nowIso();
      var timestampSegment = Utilities.formatDate(new Date(), PMS.CONFIG.TIME_ZONE, 'yyyyMMdd-HHmmss');
      var recordSegment = recordId || ('DRAFT-' + PMS.Util.hashText(idempotencyKey).slice(0, 12).toUpperCase());
      var fileName = [
        safeSegment(cycle.cycleId, 'CYCLE', 20),
        safeSegment(assetType, 'ASSET', 40),
        safeSegment(assetTag, 'TAG', 80),
        safeSegment(recordSegment, 'DRAFT', 80),
        safeSegment(config.key, 'EVIDENCE', 20),
        timestampSegment
      ].join('_') + '.' + fileInfo.extension;

      var folder = DriveApp.getFolderById(config.folderId);
      var storedFile = folder.createFile(blob.copyBlob().setName(fileName).setContentType(fileInfo.mimeType));
      try {
        storedFile.setDescription([
          'YDC PMS evidence',
          'Record: ' + (recordId || 'draft ' + idempotencyKey),
          'Asset: ' + assetTag,
          'Cycle: ' + cycle.cycleId,
          'Kind: ' + config.key,
          'Uploaded by: ' + profile.email
        ].join('\n'));
      } catch (descriptionError) {
        console.warn('Evidence description could not be set: ' + descriptionError.message);
      }
      var descriptor = {
        tokenVersion: TOKEN_VERSION,
        evidenceKind: config.key,
        folderId: config.folderId,
        fileId: storedFile.getId(),
        fileName: storedFile.getName(),
        url: storedFile.getUrl(),
        mimeType: storedFile.getMimeType() || fileInfo.mimeType,
        sizeBytes: bytes.length,
        sha256: sha256,
        uploadedAt: timestamp,
        uploadedBy: profile.email,
        recordId: recordId,
        idempotencyKey: idempotencyKey,
        assetType: assetType,
        assetTag: assetTag,
        maintenanceDate: maintenanceDate,
        cycleId: cycle.cycleId,
        itSection: 'INFRA_SECURITY'
      };
      descriptor.signature = signature(descriptor);
      descriptor = verifyDescriptor(descriptor, input);
      try {
        if (!PMS.Records || typeof PMS.Records.attachEvidence !== 'function') {
          PMS.Util.fail('Evidence record attachment is not configured.', 'CONFIGURATION_ERROR');
        }
        PMS.Records.attachEvidence(recordId, config.key, descriptor);
      } catch (attachError) {
        // This exact file was created by the failed operation and has never
        // been committed to a record. Trash it best-effort; never touch a
        // previously saved or reused evidence file.
        try {
          storedFile.setTrashed(true);
        } catch (cleanupError) {
          console.error('Orphan evidence cleanup failed for ' + storedFile.getId() + ': ' + cleanupError.message);
        }
        throw attachError;
      }
      cache.put(key, JSON.stringify(descriptor), CACHE_SECONDS);
      return { ok: true, descriptor: descriptor, reused: false, newlyCreated: true };
    } finally {
      lock.releaseLock();
    }
  }

  /** Read-only deployment preflight; also creates the private signing secret. */
  function readiness() {
    ensureSecret();
    return Object.keys(PMS.CONFIG.EVIDENCE).map(function (kind) {
      var config = evidenceConfig(kind);
      try {
        var folder = DriveApp.getFolderById(config.folderId);
        return {
          kind: kind,
          folderId: config.folderId,
          folderName: folder.getName(),
          accessible: true
        };
      } catch (error) {
        PMS.Util.fail(
          config.label + ' folder is not accessible to the web-app deployment owner.',
          'EVIDENCE_FOLDER_ACCESS_DENIED'
        );
      }
    });
  }

  return {
    upload: upload,
    verifyDescriptor: verifyDescriptor,
    descriptorFromRecord: descriptorFromRecord,
    verifyRecordEvidence: verifyRecordEvidence,
    evidenceRecordKeys: evidenceRecordKeys,
    ensureSecret: ensureSecret,
    readiness: readiness
  };
})();
