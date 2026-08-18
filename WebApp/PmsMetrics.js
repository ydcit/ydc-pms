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

  var CYCLE_RANK = { T1: 1, T2: 2, T3: 3 };

  /**
   * Cycle choices for the dashboard's cycle filter: YYYY-T1/T2/T3.
   *
   * Discovered from stored records rather than a hardcoded range, so a filter
   * never offers a cycle nobody has touched and never needs a code change for
   * a new year. The current cycle is always included, even with zero history,
   * so the filter is usable on a freshly deployed workbook.
   */
  function cycleOptionsFrom(records, current) {
    var seen = {};
    var options = [];
    function addOption(year, cycleKey) {
      var cycleId = year + '-' + cycleKey;
      if (seen[cycleId]) return;
      seen[cycleId] = true;
      options.push({ year: year, cycle: cycleKey, cycleId: cycleId });
    }
    addOption(current.year, current.cycle);
    records.forEach(function (record) {
      if (!PMS.Records.isMaintenanceRecord(record)) return;
      var year = Number(record.maintenanceYear);
      var cycleKey = String(record.cycle || '');
      if (!year || !PMS.CONFIG.CYCLES[cycleKey]) return;
      addOption(year, cycleKey);
    });
    return options.sort(function (a, b) {
      return b.year - a.year || CYCLE_RANK[b.cycle] - CYCLE_RANK[a.cycle];
    });
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
    var deferred = 0;
    var withFindings = 0;
    var followUp = 0;
    var pmsNotPerformed = 0;
    var locations = {};
    var pendingAssets = [];
    var deferredAssets = [];
    var completionSources = { record: 0, tracker: 0 };

    /**
     * A completed asset whose tracker cell currently reads DEFERRED needs a
     * revisit before its PMS genuinely counts as done — that is exactly what
     * "PMS not performed" means. Counting it as Completed would hide the
     * outstanding work; counting it as Pending would say nothing was ever
     * attempted, which is also false. It gets its own bucket instead, live
     * off the same ticket data trackerStatusForRecord already uses to decide
     * what the tracker cell itself shows, so this can never disagree with the
     * sheet: the moment the linked ticket closes, the next read of this
     * asset moves it back into Completed on its own. Returns the deferring
     * ticket itself (not just a boolean) so the dashboard can link to it.
     */
    function deferringTicket(assessment) {
      if (!assessment || !assessment.recordId) return null;
      try {
        var tickets = PMS.Tickets.forRecord(assessment.recordId);
        for (var i = 0; i < tickets.length; i += 1) {
          if (tickets[i].status === 'DEFERRED') return tickets[i];
        }
        return null;
      } catch (error) {
        console.warn('Deferred status could not be resolved for ' + assessment.recordId + ': ' + error.message);
        return null;
      }
    }

    eligibleAssets.forEach(function (asset) {
      var key = PMS.Records.completionKey(asset.section, asset.tag, cycleId);
      var location = asset.location || 'Location not recorded';
      if (!locations[location]) locations[location] = { location: location, eligible: 0, completed: 0, pending: 0, deferred: 0 };
      locations[location].eligible += 1;
      if (completedKeys[key]) {
        var assessment = latestAssessment[key];
        var ticket = deferringTicket(assessment);
        if (ticket) {
          deferred += 1;
          locations[location].deferred += 1;
          if (deferredAssets.length < 100) {
            deferredAssets.push({
              tag: asset.tag,
              location: location,
              ticketId: ticket.ticketId,
              section: asset.section,
              recordId: assessment.recordId,
              findings: PMS.Util.cleanText(assessment.assetFindings, 300)
            });
          }
        } else {
          completed += 1;
          locations[location].completed += 1;
          if (completedKeys[key] === 'RECORD') completionSources.record += 1;
          else completionSources.tracker += 1;
        }
        if (assessment && (assessment.assessmentResult === 'Findings resolved' || assessment.assessmentResult === 'Follow-up required')) {
          withFindings += 1;
        }
        if (assessment && assessment.assessmentResult === 'Follow-up required') followUp += 1;
        if (assessment && assessment.assessmentResult === 'PMS not performed') pmsNotPerformed += 1;
      } else {
        locations[location].pending += 1;
        if (pendingAssets.length < 100) {
          pendingAssets.push({ tag: asset.tag, location: location, section: asset.section });
        }
      }
    });

    var eligible = eligibleAssets.length;
    var pending = Math.max(eligible - completed - deferred, 0);
    var compliance = eligible ? Math.round(completed / eligible * 1000) / 10 : null;
    var cycleConfig = PMS.CONFIG.CYCLES[cycle];
    var deadlineText = year + '-' + String(cycleConfig.endMonth).padStart(2, '0') + '-' + String(cycleConfig.endDay).padStart(2, '0');
    var today = dateFromText(PMS.Util.todayString());
    var deadline = dateFromText(deadlineText);
    var daysRemaining = PMS.Util.daysBetween(today, deadline);
    // Deferred is not done either, so it is exactly as overdue as Pending
    // once the cycle deadline has passed.
    var overdue = daysRemaining < 0 ? pending + deferred : 0;

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
      deferred: deferred,
      compliance: compliance,
      withFindings: withFindings,
      followUp: followUp,
      pmsNotPerformed: pmsNotPerformed,
      overdue: overdue,
      myCompleted: Object.keys(myCompletedKeys).length,
      sections: sections,
      completionSources: completionSources,
      locations: locationRows.slice(0, 20),
      pendingAssets: pendingAssets,
      deferredAssets: deferredAssets,
      cycleOptions: cycleOptionsFrom(records, current),
      liveEligibility: true,
      generatedAt: PMS.Util.nowIso()
    };
  }

  return { dashboard: dashboard };
})();
