var PMS = PMS || {};

PMS.Validation = (function () {
  function normalizeChecklist(rawChecklist) {
    var source = rawChecklist && typeof rawChecklist === 'object' ? rawChecklist : {};
    var normalized = {};
    var completed = 0;
    var applicable = 0;
    var groupProgress = {};

    PMS.CONFIG.CHECKLIST.forEach(function (group) {
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

    var checklist = normalizeChecklist(source.checklist);
    var assessment = normalizeAssessment(source.assessment, saveMode === 'COMPLETE');
    var locationDiscrepancy = source.locationDiscrepancy === true || String(source.locationDiscrepancy).toLowerCase() === 'true';
    var observedLocation = PMS.Util.cleanText(source.observedLocation, 500);
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

    if (saveMode === 'COMPLETE' && checklist.percent !== 100) {
      PMS.Util.fail('Complete every applicable checklist item before completing PMS.', 'VALIDATION_ERROR');
    }

    return {
      mode: saveMode,
      recordId: recordId,
      idempotencyKey: idempotencyKey,
      maintenanceDate: Utilities.formatDate(date, PMS.CONFIG.TIME_ZONE, 'yyyy-MM-dd'),
      cycle: cycle,
      assetTag: assetTag,
      observedLocation: observedLocation,
      locationDiscrepancy: locationDiscrepancy,
      peripherals: normalizePeripherals(source.peripherals),
      checklist: checklist,
      assessment: assessment,
      profile: profile
    };
  }

  function validateObservedLocation(normalized, asset) {
    if ((normalized.locationDiscrepancy || !asset.location) && !normalized.observedLocation && normalized.mode === 'COMPLETE') {
      PMS.Util.fail('Observed location is required when the master location is blank or incorrect.', 'VALIDATION_ERROR');
    }
  }

  return {
    payload: payload,
    validateObservedLocation: validateObservedLocation,
    normalizeChecklist: normalizeChecklist
  };
})();
