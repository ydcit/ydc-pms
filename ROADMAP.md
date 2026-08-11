# Preventive Maintenance Web App — Implementation Roadmap

**Status:** Version 1 implemented; pending Apps Script owner setup, deployment, and pilot validation  
**Approval:** Implementation was explicitly authorized after PRD review  
**Change policy:** `Code.js` remains unchanged. During normal version-1 operation, existing asset data stays read-only; the approved existing-tab writes are the matched asset's T1/T2/T3 checkbox and paired Remarks cell after a fully completed record, plus the explicit administrator-controlled annual rollover of D2 and D:I.

## Delivery strategy

Build the web app in small gates so identity and section isolation are proven before questionnaire data can be written. Every phase has an explicit exit check. Tracker synchronization is added only after the new response row, last-column completion logic, and failure recovery are verified.

## Gate 0 — Product approval

### Work

- Review the PRD and workbook findings.
- Confirm the eight approval decisions listed in the PRD.
- Confirm exact allowed domain and administrator emails.
- Confirm the final names of the new storage tab or tabs.
- Confirm whether legacy checkbox completions are included in dashboard metrics by unique union.
- Confirm the `SYNC REQUIRED` rule for maintenance dates whose year differs from the tracker year in row 2.
- Confirm the administrator-controlled annual rollover model for moving the operational tracker from 2026 to 2027 and later years.

### Exit criteria

- PRD marked approved.
- Storage, authentication, registration, and historical-compliance choices recorded.
- Explicit authorization to begin implementation received.

## Phase 1 — Application skeleton and contracts

### Planned files

All implementation is placed in new files. `Code.js` is treated as immutable.

Server-side Apps Script:

- `PmsConfig.js` — workbook ID, allowed domain, section-to-tab mapping, cycles, checklist schema.
- `PmsWebApp.js` — web-app entry point and HTML partial loader.
- `PmsAuth.js` — identity, domain checks, registration, role checks.
- `PmsIdentity.js` — short-lived verified-mailbox fallback, rate limits, and temporary-key binding.
- `PmsUsers.js` — persistent user directory, legacy-profile migration, and identity continuity binding.
- `PmsAssets.js` — bounded asset reads, normalization, section filtering, revalidation.
- `PmsRecords.js` — response schema, append, idempotency, duplicate/reinspection logic.
- `PmsTracker.js` — controlled term-checkbox and full-assessment remarks synchronization.
- `PmsRollover.js` — dry-run, year close/open, bounded reset, reconciliation, and rollover audit.
- `PmsMetrics.js` — compliance and dashboard aggregation.
- `PmsValidation.js` — shared payload and boundary validation.

HTML Service files:

- `Index.html` — application shell.
- `Styles.html` — shared CSS partial.
- `Client.html` — browser JavaScript partial.
- `Register.html` — first-use registration view.
- `Dashboard.html` — cards, filters, activity, and progress views.
- `Questionnaire.html` — modal stepper and fields.

Apps Script does not serve standalone browser `.js` files directly; browser logic therefore lives in an HTML partial, while `.js` files contain server-side Apps Script.

### Work

- Add a collision-safe `PMS_` function naming convention or namespace.
- Define constants for the two exact PMS tab names, their A/B/C asset contract, and D/E, F/G, H/I cycle mappings.
- Derive cycle IDs from dates; do not hardcode 2026 or a finite year list.
- Define the 20 checklist items and 10 peripheral types once on the server.
- Add explicit business time-zone handling using `Asia/Manila` in new logic.
- Review manifest scopes and API dependencies needed by the approved name-resolution option.
- Confirm the existing legacy Form updater still loads without changes.

### Exit criteria

- Web-app shell renders from new files.
- No existing workbook cells or files are changed.
- Configuration and schema tests pass for both sections and all cycle boundaries.

## Phase 2 — Authentication and section registration

### Work

- Configure a test deployment restricted to the YDC Workspace organization.
- Prove active-user email behavior with at least two non-owner YDC accounts.
- Enforce the allowed domain on the server.
- Resolve the display name using the approved approach.
- Implement first-use display-name and section registration backed by `PMS Users`.
- Bind a hashed temporary Google user key so returning technicians survive blank-email sessions; when the key is unmapped, verify an exact YDC mailbox with a short-lived single-use code before binding it.
- Lock section changes behind administrator authorization.
- Add access-denied, identity-unavailable, and authorization-required states.

### Test cases

- Allowed YDC account.
- Non-YDC account.
- Blank/unavailable active email.
- First-time registration for each section.
- Returning user.
- Attempted browser tampering with email, role, or section.

### Exit criteria

- Two test users are reliably identified.
- Cross-section server calls are rejected.
- No technician needs direct workbook edit access under the selected deployment model.

## Phase 3 — Dashboard shell and read-only data adapter

### Work

- Read only columns A:C from the registered section's PMS tab.
- Normalize values and keep nonblank tags with status exactly `INPROD`.
- Return only the authorized section's asset data.
- Add short-lived caching and bounded reads.
- Build current-cycle banner and empty/loading/error states.
- Implement the searchable asset combobox data source.
- Add a read-only adapter for approved legacy checkbox completion metrics.

### Test cases

- Service Desk returns only Service Desk `INPROD` assets.
- Infrastructure & Security returns only Infrastructure & Security `INPROD` assets.
- `SPARE`, `DEFECTIVE`, and unusual statuses are excluded.
- Blank tags are excluded and duplicates are de-duplicated.
- Blank location remains visible as a data-quality state.

### Exit criteria

- Counts match a fresh, read-only workbook comparison.
- No cross-section tag can be discovered through client calls.
- Existing tabs remain unchanged during this read-only phase.

## Phase 4 — Questionnaire modal

### Work

- Build the four-step responsive modal.
- Add auto-filled identity and registered section.
- Add `Maintenance Performed On` with year/cycle derivation.
- Add searchable asset selection with read-only status and location.
- Add conditional observed-location capture.
- Add the ten peripheral tag inputs with chip behavior.
- Add all six checklist categories, category progress, and overall progress.
- Add explicit N/A handling for applicable items.
- Add assessment result, findings, action, and recommendation.
- Add **Save progress** for an `INCOMPLETE` record and **Complete PMS** for a 100% record.
- Add review screen, unsaved-change warning, accessible focus management, and mobile full-screen behavior.

### Test cases

- January 1, April 30, May 1, August 31, September 1, and December 31 cycle boundaries.
- Older valid dates and future invalid dates.
- N/A denominator calculations.
- Multiple peripheral tags of the same type.
- Empty and incorrect master locations.
- Keyboard-only and small-screen completion.

### Exit criteria

- Every PRD field is represented.
- Overall progress is correct; incomplete work can be saved, but **Complete PMS** cannot run below 100% applicable.
- Client-side validation is helpful but never treated as authoritative.

## Phase 5 — New response storage and server validation

### Work

- Create only the approved new storage tab or tabs.
- Create and verify stable headers before accepting writes.
- Add final server-side identity, registration, section, asset, status, date, cycle, checklist, and assessment validation.
- Use a script lock around record creation.
- Generate a unique record ID and accept a client idempotency key.
- Detect prior completion for asset + year + cycle and classify repeat work as reinspection.
- Create an incomplete response row once, then update that same row by record ID as progress is saved.
- Make `PMS Completion` the final physical column and populate its visual percentage/status value.
- For a 100% record, write the full technician assessment into the correct cycle Remarks cell, preserving existing remarks.
- Set the paired cycle checkbox only after the remarks write succeeds.
- Verify the Remarks cell and checkbox, then finalize the response row as `COMPLETED`.
- Store `SYNC REQUIRED` for a tracker-year mismatch and `SYNC FAILED` for a failed controlled write.
- Never write to any other existing-sheet cell.

### Test cases

- Valid record for each section.
- Manually injected wrong-section tag.
- Asset changed from `INPROD` after the modal loaded.
- Double-click and network retry.
- Existing completion followed by a reinspection.
- Incomplete progress save does not affect tracker cells.
- T1, T2, and T3 completion each targets the correct checkbox/remarks pair.
- Existing remarks are preserved and the new full assessment is appended once.
- Retry with the same record ID does not duplicate the assessment block.
- Maintenance year different from row-2 tracker year produces `SYNC REQUIRED`.
- Concurrent submissions from multiple technicians.
- Failure before remarks, between remarks and checkbox, and before final status reconciliation.

### Exit criteria

- Save progress produces exactly one resumable row and one stable record ID.
- Successful completion produces a verified remarks block, checked term, and final-column `COMPLETED` value.
- Duplicate retries do not create duplicate rows.
- Failure cannot leave an unchecked assessment marked complete or a checked asset without its assessment.

## Phase 6 — Dashboard metrics and activity

### Work

- Calculate eligible, completed, pending, compliance, findings, follow-up, and overdue using PRD definitions.
- De-duplicate by asset + year + cycle.
- Merge pre-existing and newly synchronized completion flags by unique asset/year/cycle union when approved.
- Add section-scoped technician dashboard and recent activity.
- Add administrator filters and combined view.
- Populate year filters dynamically from stored cycle IDs.
- Add completion by location and pending-by-location views.
- Add data-quality indicators.
- Refresh/invalidate relevant cache after a successful submission.

### Test cases

- Repeat inspections do not inflate completion.
- Non-`INPROD` legacy flags do not count.
- Zero-eligible case shows N/A, not divide-by-zero.
- Past deadline converts pending to overdue.
- Technician cannot request another section's metrics.

### Exit criteria

- Dashboard totals reconcile to a separately calculated read-only sample.
- User-scoped and administrator-scoped views pass authorization tests.

## Phase 7 — Annual rollover and scalability

### Work

- Implement an administrator-only rollover dry run and confirmation screen.
- Create the one-time authoritative legacy baseline, then block rollover until every closing-year sync error is resolved.
- Write year-close and year-open audit events.
- Update the tracker year and reset only D:I term checkbox/remarks cells in bounded batches.
- Make the operation resumable and reject duplicate or skipped-year rollovers.
- Reconcile new-year `SYNC REQUIRED` records after the year opens.
- Add workbook cell-count, response-row, latency, and error monitoring.
- Add a 70%-capacity warning and document a closed-year archive procedure.

### Test cases

- Successful 2026-to-2027 rollover for both sections.
- Dry run causes no writes.
- Unauthorized technician cannot start or inspect rollover controls.
- Duplicate 2027 rollover is rejected.
- Attempt to skip directly from 2026 to 2028 is rejected.
- Failure between year close, tracker reset, and year open resumes safely.
- A 2027 record saved before rollover changes from `SYNC REQUIRED` to synchronized after rollover.
- 2026 dashboard history remains available after the tracker shows 2027.
- Large rollover workload stays within bounded batches and Apps Script execution limits.

### Exit criteria

- A new year requires no source-code or schema change.
- Prior-year history and assessments reconcile before any tracker reset.
- Only the intended year and D:I operational tracker cells change.
- Waiting new-year records reconcile without duplicates.

## Phase 8 — Quality assurance and pilot

### Work

- Run the full functional and authorization test matrix.
- Test cold starts, large Service Desk dropdown performance, and concurrent appends.
- Verify Chrome desktop and mobile layouts.
- Verify keyboard navigation, focus trapping, labels, contrast, and error announcements.
- Conduct a pilot with one Service Desk and one Infrastructure & Security technician.
- Reconcile pilot records against displayed dashboard metrics.
- Review Apps Script execution logs and quotas.

### Exit criteria

- No critical or high-severity defects.
- Both pilot users complete a full record without assistance.
- Pilot metrics reconcile exactly.
- Product owner signs off for production deployment.

## Phase 9 — Controlled production release

### Work

- Create a versioned production web-app deployment.
- Restrict access to the approved Workspace organization.
- Publish a short user guide and owner/admin runbook.
- Communicate the cycle definition and compliance target.
- Monitor initial submissions, failures, latency, and quota usage.
- Keep the previous deployment version available for rollback.

### Exit criteria

- Production identity and section isolation are verified.
- First production records and metrics reconcile.
- Support owner and escalation path are documented.

## Rollback strategy

- Disable or replace only the new web-app deployment.
- Preserve submitted rows for audit; do not delete them during rollback.
- Revert to the prior Apps Script deployment version.
- Preserve each tracker cell's prior checkbox and remarks values in the response audit fields before synchronization.
- Use those stored prior values for a reviewed, record-specific rollback when a synchronized tracker write must be reversed.
- Never run a bulk rollback against the asset tabs; `Code.js` remains untouched.

## Main risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Active user email unavailable in chosen deployment mode | Domain test deployment before building persistence; block rather than guess identity |
| Full Google account name unavailable from Session | Let the user confirm an email-derived display name once and persist it in `PMS Users` |
| User self-registers to the wrong section | One-time locked registration plus administrator reset and server enforcement |
| Most IT-IS locations are blank | Conditional observed-location capture and data-quality flag |
| Existing dashboard includes non-production assets | New metric definitions filter eligibility and de-duplicate assets |
| Historical denominator changes with current status | Label version-1 metrics as live compliance; add a cycle-scope snapshot after approval |
| Large Service Desk asset list is hard to use | Section-scoped searchable combobox and short-lived cache |
| Duplicate rows from retries | Idempotency key, lock, and record verification |
| Remarks written but checkbox/final status fails | Ordered writes, prior-value audit fields, `SYNC FAILED`, and reconciliation retry |
| Existing remarks are overwritten or duplicated | Append with a record-ID marker; preserve prior value and upsert the same record block on retry |
| Maintenance date maps to a different tracker year | Complete an archived past year in records without a tracker write; keep an ahead-of-tracker year as `SYNC REQUIRED`; never check the wrong term |
| Annual rollover clears history or runs twice | Pre-rollover reconciliation, admin dry run, explicit confirmation, audit events, lock, resumable checkpoints, and duplicate-year guard |
| Response history grows until dashboard requests time out | Dynamic year filtering, bounded reads, cached aggregates, capacity monitoring, and a reviewed archive threshold |
| Legacy code broadens OAuth scopes or has an installed trigger | Review consent in the test deployment; leave legacy code and triggers untouched |
| Time-zone boundary errors | Use `Asia/Manila` and explicit boundary tests |

## Suggested later enhancements

These are intentionally outside version 1:

- Cycle-scope snapshots for audit-grade historical compliance.
- Scheduled reminders as cycle deadlines approach.
- Follow-up ownership and closure workflow.
- Exportable compliance reports.
- Asset QR/barcode scanning.
- Attachment/photo evidence.
- Automatic issue/ticket integration.
- Offline drafts.

## Current handoff checkpoint

Implementation is complete. The remaining gates are owner/admin bootstrap, organization-restricted web-app deployment, two-account authorization testing, and the controlled pilot described in Phase 8.
