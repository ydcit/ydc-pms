var PMS = PMS || {};

PMS.Validation = (function () {
  function normalizeChecklist(rawChecklist, checklistGroups) {
    var source = rawChecklist && typeof rawChecklist === 'object' ? rawChecklist : {};
    var groups = Array.isArray(checklistGroups) ? checklistGroups : PMS.CONFIG.CHECKLIST;
    var normalized = {};
    var completed = 0;
    var applicable = 0;
    var groupProgress = {};

    groups.forEach(function (group) {
      var groupCompleted = 0;
      var groupApplicable = 0;
      group.items.forEach(function (item) {
        var state = PMS.Util.cleanText(source[item.key], 10).toUpperCase();
        if (state !== 'DONE' && state !== 'NA') state = '';
        if (state === 'NA' && !item.allowsNa) {
          PMS.Util.fail(item.label + ' cannot be marked not applicable.', 'VALIDATION_ERROR');
        }
        normalized[item.key] = state;
        if (state !== 'NA') {
          applicable += 1;
          groupApplicable += 1;
          if (state === 'DONE') {
            completed += 1;
            groupCompleted += 1;
          }
        }
      });
      groupProgress[group.key] = {
        completed: groupCompleted,
        applicable: groupApplicable,
        percent: groupApplicable ? Math.round(groupCompleted / groupApplicable * 100) : 100
      };
    });

    return {
      values: normalized,
      completed: completed,
      applicable: applicable,
      percent: applicable ? Math.round(completed / applicable * 100) : 0,
      groups: groupProgress
    };
  }

  function normalizePeripherals(rawPeripherals) {
    var source = rawPeripherals && typeof rawPeripherals === 'object' ? rawPeripherals : {};
    var normalized = {};
    PMS.CONFIG.PERIPHERALS.forEach(function (item) {
      normalized[item.key] = PMS.Util.serializeTags(source[item.key]);
    });
    return normalized;
  }

  function normalizeInfraAssetType(value) {
    var assetType = PMS.Util.cleanText(value, 100);
    if (PMS.CONFIG.INFRA_ASSET_TYPES.indexOf(assetType) < 0) {
      PMS.Util.fail('Select a valid IT-IS asset type.', 'VALIDATION_ERROR');
    }
    return assetType;
  }

  function inferInfraAssetType(assetTag) {
    // Treat AP/SW/FW/SVR as known only when they are a complete tag segment or
    // immediately prefix the numeric sequence. This covers YDC-AP-001, AP-001,
    // and AP001 without misclassifying unrelated text such as SNAPSHOT.
    var match = /(?:^|[^A-Z0-9])(AP|SW|FW|SVR)(?=$|[^A-Z0-9]|\d)/.exec(
      PMS.Util.normalizeAssetTag(assetTag)
    );
    if (!match) return '';
    return PMS.CONFIG.INFRA_ASSET_TYPE_BY_TAG_PREFIX[match[1]] || '';
  }

  function validateInfraAssetType(assetTag, assetType) {
    var inferred = inferInfraAssetType(assetTag);
    if (inferred && inferred !== assetType) {
      PMS.Util.fail('The selected asset tag is a ' + inferred + ', not a ' + assetType + '.', 'VALIDATION_ERROR');
    }
    return !inferred;
  }

  function evidenceSource(source, kind) {
    if (source.evidence && typeof source.evidence === 'object' && source.evidence[kind]) {
      return source.evidence[kind];
    }
    if (kind === 'firmware') return source.firmwareEvidence || source.evidenceFirmware || null;
    return source.backupEvidence || source.evidenceBackup || null;
  }

  function mergeStoredEvidence(source, recordId, profile) {
    if (profile.section !== 'INFRA_SECURITY' || !recordId) return source;
    var record = PMS.Records.findByRecordId(recordId);
    if (!record || record.itSection !== 'INFRA_SECURITY' ||
        PMS.Util.normalizeEmail(record.technicianEmail) !== profile.email) return source;
    var merged = Object.assign({}, source);
    merged.evidence = Object.assign({}, source.evidence || {});
    Object.keys(PMS.CONFIG.EVIDENCE).forEach(function (kind) {
      if (!merged.evidence[kind]) {
        merged.evidence[kind] = PMS.Evidence.descriptorFromRecord(record, kind);
      }
    });
    return merged;
  }

  function normalizeInfraEvidence(source, expected, requireComplete) {
    var evidence = {};
    var completed = 0;
    Object.keys(PMS.CONFIG.EVIDENCE).forEach(function (kind) {
      var descriptor = evidenceSource(source, kind);
      if (descriptor) {
        evidence[kind] = PMS.Evidence.verifyDescriptor(descriptor, Object.assign({}, expected, {
          evidenceKind: kind
        }));
        completed += 1;
      } else {
        evidence[kind] = null;
        if (requireComplete) {
          PMS.Util.fail(PMS.CONFIG.EVIDENCE[kind].label + ' is required to complete PMS.', 'VALIDATION_ERROR');
        }
      }
    });
    return { values: evidence, completed: completed };
  }

  function normalizeAssessment(rawAssessment, requireComplete) {
    var source = rawAssessment && typeof rawAssessment === 'object' ? rawAssessment : {};
    var result = PMS.Util.cleanText(source.result, 100);
    var findings = PMS.Util.cleanText(source.findings, PMS.CONFIG.MAX_TEXT_LENGTH);
    var actionTaken = PMS.Util.cleanText(source.actionTaken, PMS.CONFIG.MAX_TEXT_LENGTH);
    var recommendation = PMS.Util.cleanText(source.recommendation, PMS.CONFIG.MAX_TEXT_LENGTH);
    if (result && PMS.CONFIG.ASSESSMENT_RESULTS.indexOf(result) < 0) {
      PMS.Util.fail('Select a valid assessment result.', 'VALIDATION_ERROR');
    }
    if (requireComplete) {
      if (!result) PMS.Util.fail('Assessment result is required to complete PMS.', 'VALIDATION_ERROR');
      if (!findings) PMS.Util.fail('Asset Findings is required to complete PMS.', 'VALIDATION_ERROR');
      if (!actionTaken) PMS.Util.fail('Action Taken is required to complete PMS.', 'VALIDATION_ERROR');
      if (!recommendation) PMS.Util.fail('Recommendation is required to complete PMS.', 'VALIDATION_ERROR');
      if (result === 'No findings' && findings.toLowerCase() !== 'no findings') {
        PMS.Util.fail('Use “No findings” in Asset Findings when the assessment result is No findings.', 'VALIDATION_ERROR');
      }
    }
    return {
      result: result,
      findings: findings,
      actionTaken: actionTaken,
      recommendation: recommendation
    };
  }

  function payload(rawPayload, mode, profile) {
    var source = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
    var saveMode = String(mode || source.mode || 'SAVE').toUpperCase();
    if (saveMode !== 'SAVE' && saveMode !== 'COMPLETE') {
      PMS.Util.fail('Unknown save mode.', 'VALIDATION_ERROR');
    }
    var date = PMS.Util.parseDateInput(source.maintenanceDate);
    var cycle = PMS.Util.deriveCycle(date);
    var assetTag = PMS.Util.normalizeAssetTag(source.assetTag);
    if (!assetTag) PMS.Util.fail('Select an asset tag.', 'VALIDATION_ERROR');

    if (!profile || (profile.section !== 'SERVICE_DESK' && profile.section !== 'INFRA_SECURITY')) {
      PMS.Util.fail('Your registered IT section is invalid.', 'ACCESS_DENIED');
    }
    var isInfra = profile.section === 'INFRA_SECURITY';
    var recordId = PMS.Util.cleanText(source.recordId, 100);
    var idempotencyKey = PMS.Util.cleanText(source.idempotencyKey, 200) || PMS.Util.makeIdempotencyKey();
    if (recordId && !/^PMS-\d{4}-T[123]-[A-F0-9]{32}$/.test(recordId)) {
      PMS.Util.fail('The PMS record identifier is invalid.', 'VALIDATION_ERROR');
    }
    var uuidKey = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    var fallbackKey = /^pms-\d{10,16}-[a-z0-9]{4,24}-[a-z0-9]{4,24}$/i;
    if (!uuidKey.test(idempotencyKey) && !fallbackKey.test(idempotencyKey)) {
      PMS.Util.fail('The request identifier is invalid. Reopen the questionnaire and try again.', 'VALIDATION_ERROR');
    }

    source = mergeStoredEvidence(source, recordId, profile);
    var checklist = normalizeChecklist(source.checklist, isInfra ? PMS.CONFIG.INFRA_CHECKLIST : PMS.CONFIG.CHECKLIST);
    var assessment = normalizeAssessment(source.assessment, saveMode === 'COMPLETE');
    var locationDiscrepancy = source.locationDiscrepancy === true || String(source.locationDiscrepancy).toLowerCase() === 'true';
    var observedLocation = PMS.Util.cleanText(source.observedLocation, 500);
    var normalized = {
      mode: saveMode,
      formType: profile.section,
      recordId: recordId,
      idempotencyKey: idempotencyKey,
      maintenanceDate: Utilities.formatDate(date, PMS.CONFIG.TIME_ZONE, 'yyyy-MM-dd'),
      cycle: cycle,
      assetTag: assetTag,
      observedLocation: observedLocation,
      locationDiscrepancy: locationDiscrepancy,
      peripherals: isInfra ? {} : normalizePeripherals(source.peripherals),
      checklist: checklist,
      assessment: assessment,
      profile: profile
    };

    if (isInfra) {
      normalized.assetType = normalizeInfraAssetType(source.assetType);
      normalized.assetTypeUnverified = validateInfraAssetType(assetTag, normalized.assetType);
      var evidenceResult = normalizeInfraEvidence(source, {
        recordId: recordId,
        idempotencyKey: idempotencyKey,
        assetType: normalized.assetType,
        assetTag: assetTag,
        maintenanceDate: normalized.maintenanceDate,
        cycleId: cycle.cycleId,
        itSection: profile.section,
        uploadedBy: profile.email,
        requireStoredFile: saveMode === 'COMPLETE'
      }, saveMode === 'COMPLETE');
      normalized.evidence = evidenceResult.values;
      normalized.progress = {
        completed: checklist.completed + evidenceResult.completed,
        applicable: 6,
        percent: Math.round((checklist.completed + evidenceResult.completed) / 6 * 100)
      };
    } else {
      normalized.assetType = '';
      normalized.assetTypeUnverified = false;
      normalized.evidence = { firmware: null, backup: null };
      normalized.progress = {
        completed: checklist.completed,
        applicable: checklist.applicable,
        percent: checklist.percent
      };
    }

    if (saveMode === 'COMPLETE' && normalized.progress.percent !== 100) {
      PMS.Util.fail('Complete every applicable checklist item before completing PMS.', 'VALIDATION_ERROR');
    }

    return normalized;
  }

  function validateObservedLocation(normalized, asset) {
    if ((normalized.locationDiscrepancy || !asset.location) && !normalized.observedLocation && normalized.mode === 'COMPLETE') {
      PMS.Util.fail('Observed location is required when the master location is blank or incorrect.', 'VALIDATION_ERROR');
    }
  }

  return {
    payload: payload,
    validateObservedLocation: validateObservedLocation,
    normalizeChecklist: normalizeChecklist,
    normalizeInfraAssetType: normalizeInfraAssetType,
    inferInfraAssetType: inferInfraAssetType,
    validateInfraAssetType: validateInfraAssetType
  };
})();
