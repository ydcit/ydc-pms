# Preventive Maintenance Web App — Implementation Roadmap

**Status:** Version 1.1 implemented; pending deploying-owner Drive authorization, deployment, and pilot validation
**Version:** 1.1
**Updated:** 2026-08-13
**Approval:** Implementation was explicitly authorized after PRD review
**Change policy:** `Code.js` remains unchanged. During normal version-1.1 operation, existing asset data stays read-only; the approved existing-tab writes are the matched asset's T1/T2/T3 checkbox and paired Remarks cell after a fully completed record, plus the explicit administrator-controlled annual rollover of D2 and D:I.

## Delivery strategy

Build the web app in small gates so identity and section isolation are proven before questionnaire data can be written. Every phase has an explicit exit check. Tracker synchronization is added only after the new response row, last-column completion logic, and failure recovery are verified.

## Gate 0 — Product approval (complete)

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

## Phase 1 — Application skeleton and contracts (implemented)

### Planned files

All implementation is placed in new files. `Code.js` is treated as immutable.

Server-side Apps Script:

- `PmsConfig.js` — workbook ID, allowed domain, section-to-tab mapping, cycles, checklist schema.
- `PmsWebApp.js` — web-app entry point and HTML partial loader.
- `PmsAuth.js` — Google-account identity, domain checks, roster gating, registration, role checks.
- `PmsUsers.js` — persistent user directory, access roster, and legacy-profile migration.
- `PmsAssets.js` — bounded asset reads, normalization, section filtering, revalidation.
- `PmsRecords.js` — response schema, append, idempotency, duplicate/reinspection logic.
- `PmsEvidence.js` — trusted Infra Drive uploads, validation, signed descriptors, and stored-file verification.
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
- Define the 20 Service Desk checklist items, 10 peripheral types, four Infra checks, six Infra asset types, and two evidence destinations once on the server.
- Add explicit business time-zone handling using `Asia/Manila` in new logic.
- Declare `userinfo.email` and full Drive scope explicitly; keep the two evidence-folder IDs server-side.
- Confirm the existing legacy Form updater still loads without changes.

### Exit criteria

- Web-app shell renders from new files.
- No existing workbook cells or files are changed.
- The 70-column Service Desk schema and 62-column Infra schema are unique, section-routed, and finish with `PMS Completion`.
- Configuration and schema tests pass for both sections and all cycle boundaries.

## Phase 2 — Authentication and section registration (implemented; multi-account verification pending)

### Work

- Configure a test deployment restricted to the YDC Workspace organization.
- Declare `userinfo.email` in the manifest so Session identity is populated, and prove active-user email behavior with at least two non-owner YDC accounts.
- Never use `Session.getEffectiveUser()` as the visitor identity in an execute-as-owner deployment.
- Enforce the allowed domain on the server.
- Require the signed-in email to exist in `PMS Users`, always permitting configured administrators.
- Resolve the display name using the approved approach.
- Implement first-use display-name and section registration backed by `PMS Users`.
- Bind a server-hashed temporary active-user key for returning-technician continuity when `ActiveUser` is blank; deny registration and administrator functions on that path.
- Lock section changes behind administrator authorization.
- Add access-denied, not-provisioned, account-disabled, identity-unavailable, and authorization-required states.

### Test cases

- Allowed YDC account on the roster.
- Allowed YDC account absent from the roster.
- Roster row explicitly marked inactive.
- Malformed roster row alongside a valid one.
- Non-YDC account.
- Blank/unavailable active email.
- Blank active email with a unique active temporary-key binding, no binding, and an ambiguous binding.
- First-time registration for each section.
- Returning user.
- Administrator call with a live `ActiveUser` versus temporary-key continuity only.
- Attempted browser tampering with email, role, or section.

### Exit criteria

- Two test users are reliably identified from their Google account alone, with no code prompt.
- A non-rostered YDC account is refused with an actionable provisioning message.
- Registration and administrator functions require a live `ActiveUser` email; continuity fallback never elevates access.
- Cross-section server calls are rejected.
- No technician needs direct workbook edit access under the selected deployment model.

## Phase 3 — Dashboard shell and read-only data adapter (implemented)

### Work

- Read only columns A:C from the registered section's PMS tab.
- Normalize values and keep nonblank tags with status exactly `INPROD`.
- Return only the authorized section's asset data.
- Add short-lived caching and bounded reads.
- Build current-cycle banner and empty/loading/error states.
- Implement the searchable asset combobox data source.
- Return tracker year and T1/T2/T3 completion flags as presentation data so the browser can evaluate the cycle derived from the selected maintenance date.
- Hide an asset only when it is already complete for that selected cycle in the matching tracker year; a T1 completion must not remove it from T2 or T3.
- Add a read-only adapter for approved legacy checkbox completion metrics.

### Test cases

- Service Desk returns only Service Desk `INPROD` assets.
- Infrastructure & Security returns only Infrastructure & Security `INPROD` assets.
- `SPARE`, `DEFECTIVE`, and unusual statuses are excluded.
- Blank tags are excluded and duplicates are de-duplicated.
- Blank location remains visible as a data-quality state.
- Changing the maintenance date between T1, T2, and T3 refreshes availability against that derived cycle.
- A selected date whose year differs from the tracker year does not inherit an unrelated current tracker checkbox.

### Exit criteria

- Counts match a fresh, read-only workbook comparison.
- No cross-section tag can be discovered through client calls.
- Existing tabs remain unchanged during this read-only phase.

## Phase 4 — Section-specific questionnaire modal (implemented)

### Work

- Build the four-step responsive modal.
- Add auto-filled identity and registered section.
- Add `Maintenance Performed On` with year/cycle derivation.
- Add searchable asset selection with read-only status and location.
- Add conditional observed-location capture.
- Render the Service Desk variant with ten peripheral tag inputs, six checklist categories, explicit N/A handling, category progress, and overall progress.
- Render the Infrastructure & Security variant with `IT-IS Asset Type` before Asset tag; allow only Switch, Firewall, Access Point, OMADA Controller, Server, and FortiAnalyzer.
- Filter known Infra tag prefixes by asset type and flag unknown future prefixes without exposing another section's assets.
- Add the three Physical Checking items and one Digital Checking item for Infra.
- Add the two Infra evidence pickers, saved-evidence links, per-file validation state, and `6/6` overall progress.
- Add assessment result, findings, action, and recommendation.
- Add **Save progress** for an `INCOMPLETE` record and **Complete PMS** only when the active section's full completion rule is met.
- Add review screen, unsaved-change warning, accessible focus management, and mobile full-screen behavior.

### Test cases

- January 1, April 30, May 1, August 31, September 1, and December 31 cycle boundaries.
- Older valid dates and future invalid dates.
- N/A denominator calculations.
- Multiple peripheral tags of the same type.
- All six Infra asset types, known prefix mismatches, and unknown prefixes.
- Infra progress at 0/6 through 6/6, with completion blocked until four checks and both evidence files are ready.
- Save/reload an Infra draft with one or both evidence files already attached.
- Empty and incorrect master locations.
- Keyboard-only and small-screen completion.

### Exit criteria

- Every PRD field is represented.
- Service Desk and Infra users receive only their own questionnaire variant and asset source.
- Overall progress is correct; incomplete work can be saved, but **Complete PMS** cannot run below 100% applicable for Service Desk or below `6/6` for Infra.
- Client-side validation is helpful but never treated as authoritative.

## Phase 5 — Separate response storage, evidence, and server validation (implemented)

### Work

- Use `PMS Records` for Service Desk and create `PMS Records - Infra & Security` for the separate Infra schema.
- Create and verify stable 70-column and 62-column headers before accepting writes; keep `PMS Completion` last in both.
- Add final server-side identity, registration, section, asset, status, date, cycle, checklist, and assessment validation.
- Use a script lock around record creation.
- Generate a unique record ID and accept a client idempotency key.
- Detect prior completion for asset + year + cycle and classify repeat work as reinspection.
- Create an incomplete response row once, then update that same row by record ID as progress is saved.
- Save an Infra draft first, then upload each selected file to its fixed server-configured Drive folder and commit its trusted metadata immediately.
- Limit each file to 10 MiB; allowlist safe formats, reject scripts/executables/HTML/SVG and suspicious signatures, sanitize names, and calculate SHA-256.
- Sign evidence descriptors against immutable record context and re-open/re-hash both files before completion and tracker reconciliation.
- Preserve existing Drive ACLs and never create public sharing links.
- Make `PMS Completion` the final physical column and populate its visual percentage/status value.
- For a 100% record, write the full technician assessment into the correct cycle Remarks cell, preserving existing remarks.
- Set the paired cycle checkbox only after the remarks write succeeds.
- Verify the Remarks cell and checkbox, then finalize the response row as `COMPLETED`.
- Store `SYNC REQUIRED` for a tracker-year mismatch and `SYNC FAILED` for a failed controlled write.
- Never write to any other existing-sheet cell.

### Test cases

- Valid record for each section.
- Infra records are written only to `PMS Records - Infra & Security`; Service Desk records remain in `PMS Records`.
- Manually injected wrong-section tag.
- Manually injected evidence folder, uploader, asset, date, type, metadata, or signature.
- Empty, oversized, disallowed, moved, trashed, changed, or inaccessible evidence file.
- Interrupted first upload, interrupted second upload, reload, and safe retry without losing the committed file descriptor.
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
- Infra completion requires four checks and two verified evidence files (`6/6`).
- Successful completion produces a verified remarks block, checked term, and final-column `COMPLETED` value.
- Duplicate retries do not create duplicate rows.
- Failure cannot leave an unchecked assessment marked complete or a checked asset without its assessment.

## Phase 6 — Dashboard metrics and activity (implemented; reconciliation verification pending)

### Work

- Calculate eligible, completed, pending, compliance, findings, follow-up, and overdue using PRD definitions.
- De-duplicate by asset + year + cycle.
- Merge pre-existing and newly synchronized completion flags by unique asset/year/cycle union when approved.
- Add section-scoped technician dashboard and recent activity.
- Aggregate authorized metrics, recent activity, archive, duplicate detection, and reconciliation across both response tabs.
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

## Phase 7 — Annual rollover and scalability (implemented; full rollover test pending)

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

## Phase 7A — Bulk legacy PMS import (implemented; production pilot pending)

### Work

- Add an administrator-only Prepare → Review → Results workflow for legacy completion backfill.
- Accept one section, one shared maintenance date, pasted asset tags, or the first column of a local CSV/TXT file.
- Validate a maximum of 1,500 unique tags and display ready, resumable, duplicate, already-completed, and invalid classifications before any workbook write.
- Bind a short-lived confirmation token to the administrator, request digest, section, cycle, tracker year, and current-versus-historical mode.
- Use deterministic `LEGACY_SEED` IDs and the natural key section + asset tag + cycle ID for idempotent retries.
- Execute in 250-record chunks with continuation state stored in chunked Cache Service entries.
- For the open tracker year, batch-stage response records, capture prior tracker state, write marker-idempotent remarks and `COMPLETED` status, verify, then finalize.
- For older years, create completed historical records without changing current D:I tracker cells.
- Preserve explicit audit flags for absent checklist/evidence details, importing administrator, batch ID, source note, and historical/non-production conditions.
- Keep normal Service Desk checklist and Infrastructure evidence requirements unchanged.

### Test cases

- Non-admin preview and execute are rejected before import data is read or written.
- Preview changes no workbook cell and produces no token when nothing is ready.
- Duplicate input, missing/duplicate tracker tags, existing completed records, and conflicting drafts are classified correctly.
- Current-year Service Desk and Infra imports write only the selected term status/remarks and finalize once verification succeeds.
- Historical imports write response records only; future and mismatched tracker years are rejected.
- A crash after record staging, prior-state capture, remarks, status, or finalization can be retried without duplicate rows or duplicate remark markers.
- A rollover or tracker-year change invalidates the preview before any import write.
- Multi-chunk totals and per-tag results remain correct through continuation and retry.

### Exit criteria

- Administrators can backfill a large approved tag list without completing questionnaires one by one.
- Every accepted tag is represented once by an auditable legacy record.
- The current tracker is changed only for the matching open year, section, and trimester.
- Deployment alone performs no import; an administrator must preview and explicitly confirm each batch.

## Phase 8 — Quality assurance and pilot (pending)

### Work

- Run the full functional and authorization test matrix.
- Test cold starts, large Service Desk dropdown performance, and concurrent appends.
- Verify Chrome desktop and mobile layouts.
- Verify keyboard navigation, focus trapping, labels, contrast, and error announcements.
- Conduct a pilot with one Service Desk and one Infrastructure & Security technician.
- In the Infra pilot, verify both fixed Drive destinations, 10 MiB enforcement, draft recovery, evidence integrity checks, and `6/6` completion.
- Reconcile pilot records against displayed dashboard metrics.
- Review Apps Script execution logs and quotas.

### Exit criteria

- No critical or high-severity defects.
- Both pilot users complete a full record without assistance.
- Pilot metrics reconcile exactly.
- Product owner signs off for production deployment.

## Phase 9 — Controlled production release (pending)

### Work

- Create a versioned production web-app deployment.
- Restrict access to the approved Workspace organization.
- Have the deploying owner authorize the added full Drive scope and run readiness checks for both fixed evidence folders before releasing Infra users.
- Publish a short user guide and owner/admin runbook.
- Communicate the cycle definition and compliance target.
- Monitor initial submissions, failures, latency, and quota usage.
- Keep the previous deployment version available for rollback.

### Exit criteria

- Production identity and section isolation are verified.
- Both evidence destinations are readable by the deploying owner, uploads preserve existing ACLs, and a production Infra completion verifies both files.
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
| Active user email unavailable in chosen deployment mode | Declare `userinfo.email`; use a unique server-hashed temporary-key binding only for an existing active technician; never use `getEffectiveUser()`, and require live `ActiveUser` for registration/admin |
| Full Google account name unavailable from Session | Let the user confirm an email-derived display name once and persist it in `PMS Users` |
| Unapproved domain account opens the deployment | Require a `PMS Users` roster row before any session is created |
| One malformed roster row blocks all sign-ins | Skip unreadable rows with a logged warning; validate strictly only for the email being looked up |
| User self-registers to the wrong section | One-time locked registration plus administrator reset and server enforcement |
| Most IT-IS locations are blank | Conditional observed-location capture and data-quality flag |
| Existing dashboard includes non-production assets | New metric definitions filter eligibility and de-duplicate assets |
| Historical denominator changes with current status | Label version-1 metrics as live compliance; add a cycle-scope snapshot after approval |
| Large Service Desk asset list is hard to use | Section-scoped searchable combobox and short-lived cache |
| Duplicate rows from retries | Idempotency key, lock, and record verification |
| Infra evidence is spoofed, moved, or changed | Fixed server-side folders, signed record-bound descriptors, stored metadata, SHA-256 verification, and revalidation before tracker synchronization |
| Unsafe or oversized evidence is uploaded | 10 MiB per-file limit, extension/MIME allowlist, content-signature checks, and explicit script/executable/HTML/SVG denial |
| Drive permissions broaden unintentionally | Execute uploads under the deploying owner, retain inherited folder ACLs, and never change sharing or publish a link |
| Deploying owner has not authorized the Drive scope | Require owner reauthorization and evidence-folder readiness checks before production release |
| Remarks written but checkbox/final status fails | Ordered writes, prior-value audit fields, `SYNC FAILED`, and reconciliation retry |
| Existing remarks are overwritten or duplicated | Append with a record-ID marker; preserve prior value and upsert the same record block on retry |
| Maintenance date maps to a different tracker year | Complete an archived past year in records without a tracker write; keep an ahead-of-tracker year as `SYNC REQUIRED`; never check the wrong term |
| Annual rollover clears history or runs twice | Pre-rollover reconciliation, admin dry run, explicit confirmation, audit events, lock, resumable checkpoints, and duplicate-year guard |
| Response history grows until dashboard requests time out | Dynamic year filtering, bounded reads, cached aggregates, capacity monitoring, and a reviewed archive threshold |
| Legacy code broadens OAuth scopes or has an installed trigger | Review consent in the test deployment; leave legacy code and triggers untouched |
| Time-zone boundary errors | Use `Asia/Manila` and explicit boundary tests |

## Suggested later enhancements

These are intentionally outside version 1.1:

- Cycle-scope snapshots for audit-grade historical compliance.
- Scheduled reminders as cycle deadlines approach.
- Follow-up ownership and closure workflow.
- Exportable compliance reports.
- Asset QR/barcode scanning.
- Automatic issue/ticket integration.
- Offline drafts.

## Current handoff checkpoint

Version 1.1 implementation is complete, including the section-specific Infra questionnaire and dedicated response tab. The remaining gates are deploying-owner authorization of the full Drive scope, both evidence-folder readiness checks, organization-restricted deployment, two-account identity/authorization testing, and the controlled Service Desk/Infra pilot described in Phase 8.
