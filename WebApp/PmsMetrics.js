var PMS = PMS || {};

PMS.Metrics = (function () {
  function selectedSections(profile, requestedSection) {
    if (!profile.isAdmin) return [profile.section];
    var requested = String(requestedSection || profile.section || '').toUpperCase();
    if (requested === 'ALL') return Object.keys(PMS.CONFIG.SECTIONS);
    if (PMS.CONFIG.SECTIONS[requested]) return [requested];
    return [profile.section];
  }

  function dateFromText(text) {
    return Utilities.parseDate(text, PMS.CONFIG.TIME_ZONE, 'yyyy-MM-dd');
  }

  function dashboard(filters, recordSet) {
    var profile = PMS.Auth.requireProfile();
    var input = filters && typeof filters === 'object' ? filters : {};
    var current = PMS.Util.currentCycle();
    var year = Number(input.year) || current.year;
    var cycle = PMS.CONFIG.CYCLES[String(input.cycle || '').toUpperCase()]
      ? String(input.cycle).toUpperCase()
      : current.cycle;
    var cycleId = year + '-' + cycle;
    var sections = selectedSections(profile, input.section);
    var records = Array.isArray(recordSet) ? recordSet : PMS.Records.dashboardRecords();
    var completedKeys = {};
    records.forEach(function (record) {
      if (!PMS.Records.isMaintenanceRecord(record)) return;
      if (Number(record.maintenanceYear) !== year || record.cycle !== cycle) return;
      if (PMS.Util.completionState(record.pmsCompletion) !== 'COMPLETED') return;
      var completionKey = PMS.Records.completionKey(record.itSection, record.assetTag, record.cycleId);
      var source = record.recordType === 'LEGACY' || record.recordType === 'LEGACY_SEED'
        ? 'TRACKER'
        : 'RECORD';
      if (!completedKeys[completionKey] || source === 'RECORD') completedKeys[completionKey] = source;
    });

    var eligibleAssets = [];
    sections.forEach(function (sectionKey) {
      PMS.Assets.listEligible(sectionKey).forEach(function (asset) {
        eligibleAssets.push(asset);
      });
    });
    var latestAssessment = {};
    var myCompletedKeys = {};
    records.forEach(function (record) {
      if (!PMS.Records.isMaintenanceRecord(record)) return;
      if (Number(record.maintenanceYear) !== year || record.cycle !== cycle) return;
      if (sections.indexOf(record.itSection) < 0) return;
      if (PMS.Util.completionState(record.pmsCompletion) !== 'COMPLETED') return;
      var key = PMS.Records.completionKey(record.itSection, record.assetTag, record.cycleId);
      var priorAssessment = latestAssessment[key];
      var recordTime = String(record.submittedAt || record.updatedAt || record.createdAt || '');
      var priorTime = priorAssessment ? String(priorAssessment.submittedAt || priorAssessment.updatedAt || priorAssessment.createdAt || '') : '';
      if (!priorAssessment || recordTime >= priorTime) latestAssessment[key] = record;
      if (record.technicianEmail === profile.email) myCompletedKeys[key] = true;
    });

    var completed = 0;
    var withFindings = 0;
    var followUp = 0;
    var locations = {};
    var pendingAssets = [];
    var completionSources = { record: 0, tracker: 0 };

    eligibleAssets.forEach(function (asset) {
      var key = PMS.Records.completionKey(asset.section, asset.tag, cycleId);
      var location = asset.location || 'Location not recorded';
      if (!locations[location]) locations[location] = { location: location, eligible: 0, completed: 0, pending: 0 };
      locations[location].eligible += 1;
      if (completedKeys[key]) {
        completed += 1;
        locations[location].completed += 1;
        if (completedKeys[key] === 'RECORD') completionSources.record += 1;
        else completionSources.tracker += 1;
        var assessment = latestAssessment[key];
        if (assessment && (assessment.assessmentResult === 'Findings resolved' || assessment.assessmentResult === 'Follow-up required')) {
          withFindings += 1;
        }
        if (assessment && assessment.assessmentResult === 'Follow-up required') followUp += 1;
      } else {
        locations[location].pending += 1;
        if (pendingAssets.length < 100) {
          pendingAssets.push({ tag: asset.tag, location: location, section: asset.section });
        }
      }
    });

    var eligible = eligibleAssets.length;
    var pending = Math.max(eligible - completed, 0);
    var compliance = eligible ? Math.round(completed / eligible * 1000) / 10 : null;
    var cycleConfig = PMS.CONFIG.CYCLES[cycle];
    var deadlineText = year + '-' + String(cycleConfig.endMonth).padStart(2, '0') + '-' + String(cycleConfig.endDay).padStart(2, '0');
    var today = dateFromText(PMS.Util.todayString());
    var deadline = dateFromText(deadlineText);
    var daysRemaining = PMS.Util.daysBetween(today, deadline);
    var overdue = daysRemaining < 0 ? pending : 0;

    var locationRows = Object.keys(locations).map(function (key) {
      var row = locations[key];
      row.compliance = row.eligible ? Math.round(row.completed / row.eligible * 1000) / 10 : null;
      return row;
    }).sort(function (a, b) {
      return b.pending - a.pending || a.location.localeCompare(b.location);
    });

    return {
      year: year,
      cycle: cycle,
      cycleId: cycleId,
      deadline: deadlineText,
      daysRemaining: daysRemaining,
      eligible: eligible,
      completed: completed,
      pending: pending,
      compliance: compliance,
      withFindings: withFindings,
      followUp: followUp,
      overdue: overdue,
      myCompleted: Object.keys(myCompletedKeys).length,
      sections: sections,
      completionSources: completionSources,
      locations: locationRows.slice(0, 20),
      pendingAssets: pendingAssets,
      liveEligibility: true,
      generatedAt: PMS.Util.nowIso()
    };
  }

  return { dashboard: dashboard };
})();
