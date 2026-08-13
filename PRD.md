# Preventive Maintenance Web App — Product Requirements Document

**Status:** Version 1.1 implemented; pending deployment and pilot validation
**Version:** 1.1
**Date:** 2026-08-13
**Source workbook:** [PMS - All Asset](https://docs.google.com/spreadsheets/d/1T33Z8JFRdL9oFZ-6XT_lz-tNIAFKXF2ekp-e-cYm7uc/edit)
**Workbook handling:** Discovery was read-only. Implementation adds only the approved application storage tabs; source and asset-master data remain read-only except for controlled tracker synchronization and administrator rollover described below.

## 1. Product summary

Build a Google Apps Script web app for YDC's preventive-maintenance process. A signed-in YDC technician sees a section-specific dashboard and opens the maintenance questionnaire in a modal. The app automatically identifies the technician, limits asset choices to the technician's registered IT section, and only offers assets whose current equipment status is `INPROD`.

The modal renders a section-specific questionnaire. Service Desk records are stored in `PMS Records`; Infrastructure & Security records, including Drive evidence metadata, are stored in `PMS Records - Infra & Security`. Existing workbook data is read-only except for the controlled write that marks the matched asset's correct cycle checkbox and stores the completed technician assessment in its paired Remarks cell. The dashboard aggregates both response tabs and tracks whether all eligible assets receive PMS within each four-month maintenance cycle:

- T1: January 1–April 30
- T2: May 1–August 31
- T3: September 1–December 31

The recommended product term is **PMS Cycle** or **Maintenance Cycle**, rather than “trimester,” because each period is four months. The operational target is **PMS compliance**: 100% of eligible assets completed by the cycle deadline. This is similar to an SLA target, but it is more accurately described as a compliance target.

## 2. Workbook review

### 2.1 Relevant tabs and observed data

| Tab | Current role | Populated assets | `INPROD` | Data-quality observation |
| --- | --- | ---: | ---: | --- |
| `IT-SD PMS` | Service Desk asset master and legacy T1/T2/T3 tracker | 1,365 | 1,113 | 170 blank locations |
| `IT-IS PMS` | Infrastructure & Security asset master and legacy T1/T2/T3 tracker | 153 | 120 | 151 blank locations |
| `Source IT-SD` | Formula mirror of `IT-SD PMS!A3:C` | 1,365 | 1,113 | Not an independent source |
| `Source IT-IS` | Formula mirror of `IT-IS PMS!A3:C` | 153 | 120 | Not an independent source |
| `PM Dashboard` | Existing generated summary | 1,518 total | Not filtered | Counts every status, not only `INPROD` |

The source tabs use `ARRAYFORMULA` to mirror the first three columns of the PMS tabs. Therefore the web app's authoritative runtime source should be:

- Service Desk → `IT-SD PMS`
- Infrastructure & Security → `IT-IS PMS`

Both PMS tabs currently use:

- Row 2, column D: tracker year (`2026`)
- Row 3: headers
- Column A: `TAGGING`
- Column B: `STATUS OF EQUIPMENT`
- Column C: `LOCATION OF ASSET`
- Columns D/E: T1 checkbox and remarks
- Columns F/G: T2 checkbox and remarks
- Columns H/I: T3 checkbox and remarks

No duplicate asset tags or discrepancies between each PMS tab and its source mirror were found in the read-only review.

### 2.2 Current metric implications

The current eligible population, using the requested `INPROD` rule, is 1,233 assets: 1,113 Service Desk and 120 Infrastructure & Security.

The existing `PM Dashboard` currently reports 1,518 total assets because it includes `SPARE`, `DEFECTIVE`, and other statuses. It reports 242 Service Desk T2 completions; two of those assets are currently non-production (`YDC-NU-765`, status `SPARE`, and `YDC-NU-803`, status `DEFECTIVE`). A new dashboard must use unique eligible `INPROD` assets as its compliance denominator and must not let non-production completions inflate the compliance rate.

As of the review snapshot, a live-eligibility interpretation would show 240 completed of 1,233 eligible assets for 2026 T2, or approximately 19.5%. This is a discovery observation, not a workbook change or a final audited figure.

## 3. Goals

1. Make completing a PMS record fast and difficult to enter incorrectly.
2. Ensure a technician can view and select assets only from the technician's registered IT section.
3. Enforce the `INPROD` eligibility rule in both the interface and the server.
4. Capture a complete, searchable maintenance audit trail.
5. Show progress toward 100% completion for every PMS cycle.
6. Preserve the asset-master content and legacy script while allowing only the explicitly approved T1/T2/T3 checkbox-and-remarks synchronization.

## 4. Non-goals for version 1.1

- Editing asset tags, equipment status, or master locations from the web app.
- Replacing the asset-management process that populates the PMS tabs.
- Modifying the existing `Code.js` legacy Google Form updater.
- Writing anywhere in an existing tab except the matched asset's cycle checkbox and paired remarks cell in `IT-SD PMS` or `IT-IS PMS` after a completed PMS record.
- Editing `Source IT-SD`, `Source IT-IS`, `PM Dashboard`, or `OVERALL SCHEDULE` from the web app.
- Automatic ticket creation, email reminders, or escalation workflows.
- Public or non-YDC access.

## 5. Users and permissions

### 5.1 Technician

- Must sign in with an allowed YDC Google Workspace account.
- Registers an IT section on first use: `Service Desk` or `Infrastructure & Security`.
- After registration, sees only the registered section's assets and metrics.
- Cannot change the stored section without an administrator-approved reset.
- Can create maintenance records and view the technician's recent submissions.

### 5.2 PMS administrator

- Can view combined and section-level dashboard metrics.
- Can correct a technician's registered section.
- Can inspect submission records and data-quality flags.
- Administrator identities must come from a configuration allowlist, not from a client-side control.

### 5.3 Authorization rules

All authorization is enforced again on the server. The browser must never be trusted for email, section, role, asset status, asset location, cycle, or completion calculations.

## 6. Authentication and registration

### 6.1 Required behavior

1. The deployment is restricted to the YDC Google Workspace organization.
2. The server reads the signed-in Google account email from `Session.getActiveUser()` and rejects an email outside the configured domain, `ydc.com.ph`.
3. The email must already exist in the `PMS Users` sheet. A user who is not on that roster is refused with an actionable message and no profile is created. A configured administrator with a live active-user email is always permitted so the deployment owner cannot be locked out of an empty or damaged roster.
4. There is no email code, one-time password, or second factor. Signing in to the domain-restricted web app with a rostered YDC account is the whole authentication step.
5. The user's email is never accepted from the browser and is always read-only in the interface.
6. The user's name is resolved automatically and displayed as read-only.
7. A rostered user whose row has no IT section yet confirms a display name and chooses one section in a registration screen. The section is written to `PMS Users` and subsequent visits go directly to the dashboard.
8. The chosen section is persisted and subsequently auto-filled.
9. The server uses the persisted section, not a submitted browser value, when loading and validating assets.

### 6.2 Google Apps Script identity constraint

`Session.getActiveUser().getEmail()` can return a blank value unless the visitor belongs to the same Workspace domain as the script owner and the script has the `https://www.googleapis.com/auth/userinfo.email` scope. The manifest therefore declares that scope explicitly. `Session.getEffectiveUser()` is never used as a visitor fallback: this app executes as the deploying owner, so treating the effective user as the visitor would incorrectly identify technicians as the owner and could grant the wrong privileges.

Google Apps Script can expose the active user's email, but not the user's full name. The registration screen therefore pre-fills an email-derived display label and lets the user confirm or correct that name once.

The deployment model is:

- execute as the deploying owner so technicians do not need direct edit access to the workbook;
- allow access only within the YDC Workspace organization;
- declare `userinfo.email` in the manifest so Session identity is actually populated;
- enforce the allowed domain and the `PMS Users` roster in server code even when the deployment is domain-restricted.

When the live active-user email is temporarily blank for a returning technician, the server may hash `Session.getTemporaryActiveUserKey()` and resolve it only to one previously bound, active `PMS Users` profile. The raw temporary key is never stored or sent to the browser. This continuity path cannot register a user, create or select a profile, change a section, or grant administrator access. Registration and every administrator operation require a live `Session.getActiveUser()` email; an unresolved or ambiguous temporary-key lookup is denied. Because Google can rotate the temporary key, it is a recovery aid for returning technicians, not a durable credential.

Official references: [Apps Script web apps](https://developers.google.com/apps-script/guides/web) and [Apps Script Session identity](https://developers.google.com/apps-script/reference/base/session).

### 6.3 Access provisioning

Adding a technician is a single administrator action: add the person's `@ydc.com.ph` address to a new row in `PMS Users`. Leaving `Active` blank means active; only an explicit `FALSE` disables an account. The technician then picks their IT section once on first sign-in.

A malformed row must never block sign-in for anyone else, so the directory reader skips unreadable rows with a logged warning instead of failing the whole lookup.

## 7. Primary user flow

1. Technician opens the web-app URL and signs in with a YDC account.
2. The server validates identity and domain.
3. On first use, the technician registers a section.
4. The dashboard loads with the technician's name, section, current PMS cycle, and section-scoped metrics.
5. The technician selects **New maintenance record**.
6. A responsive modal opens and renders the questionnaire for the technician's registered section:
   1. Asset and date
   2. Included peripherals for Service Desk, or required evidence for Infrastructure & Security
   3. The section-specific checklist
   4. Assessment and review
7. The technician may **Save progress** while requirements are incomplete or select **Complete PMS** after every applicable item is resolved. An Infrastructure & Security draft receives a stable record ID before evidence is uploaded.
8. The server revalidates the user, asset, status, section, date, cycle, questionnaire schema, and any required evidence.
9. The app creates or updates the auditable row in the response tab for that section and computes the final `PMS Completion` value in the last column.
10. An incomplete record stops there and does not affect a tracker checkbox.
11. A completed record writes the full assessment to the correct T1/T2/T3 Remarks cell and then checks the paired term checkbox.
12. The app finalizes the response row as `COMPLETED`, refreshes the dashboard, and displays the record ID.

## 8. Questionnaire requirements

### 8.1 Identity, cycle, and asset

| Field | UI and behavior | Required |
| --- | --- | --- |
| Technician name | Auto-detected; read-only | Yes |
| Technician email | Auto-detected; read-only | Yes |
| IT section | Loaded from registration; read-only | Yes |
| Maintenance Performed On | Date picker; past dates permitted; future dates rejected | Yes |
| Maintenance year | Derived from maintenance date; read-only | Yes |
| PMS cycle | Derived as T1, T2, or T3; read-only | Yes |
| IT-IS Asset Type | Infrastructure & Security only; appears before Asset tag and uses the approved enum | Conditional |
| Asset tag | Searchable dropdown from `IT-SD PMS` or `IT-IS PMS` according to the stored section; only current `INPROD` rows | Yes |
| Equipment status | Auto-populated from column B; read-only | Yes |
| Master location | Auto-populated from column C; read-only | No when source is blank |
| Observed location | Shown and required only when the master location is blank or marked incorrect | Conditional |

Because the section lists contain up to 1,113 eligible tags, “dropdown” is implemented as a keyboard-accessible searchable combobox rather than a long native select. The technician selects the maintenance date first; the derived year and T1/T2/T3 cycle determine which tracker-completion flag the picker evaluates. An asset completed in T1 remains available for T2 and T3, and a tracker flag is not applied to a selected date from a different tracker year.

### 8.2 Service Desk included peripheral asset tags

Show a fixed, compact table with one optional tag input per peripheral type. Each input supports one or more tags as removable chips so dual monitors or multiple adaptors can be recorded without comma-parsing ambiguity.

1. NUC
2. NUC adaptor
3. Monitor
4. Keyboard
5. Mouse
6. UPS
7. Power adaptor
8. Headset
9. Type-C adaptor
10. Webcam

Peripheral entries are optional because not every maintained asset has every listed peripheral. Values are trimmed and normalized to uppercase. Version 1.1 warns when an entered tag is not found in the technician's section but permits the entry with an `Unverified peripheral tag` flag; this supports discovery of missing inventory without silently losing the observation.

### 8.3 Service Desk checklist

#### Hardware inspection

- Physical inspection completed
- Display checked
- Keyboard and mouse checked
- Ports tested
- Battery and charger checked, if applicable
- Camera and audio checked

#### System health

- Operating system updated
- Storage checked
- Performance checked
- Startup verified

#### Security controls

- Antivirus verified
- Firewall verified
- Disk encryption verified, if applicable
- Screen lock verified

#### Network connectivity

- Ethernet port tested
- Wi-Fi adapter checked

#### Required applications

- Required software verified

#### Maintenance and cleaning

- Temporary files cleaned
- Device cleaned
- Health check completed

“Maintenance and Cleaning” is the recommended replacement for a second section also named “Preventive Maintenance.”

Each category shows `completed/applicable` and a progress bar. The modal also shows overall progress. The two “if applicable” checks support **Not applicable**. An N/A item is excluded from the denominator and must store an explicit reason or applicability state; silently leaving it unchecked does not count as complete.

For Service Desk, **Save progress** is available below 100% and stores the record as `INCOMPLETE`; it never changes a PMS tracker checkbox. **Complete PMS** is enabled only when 100% of applicable checklist items have been completed.

### 8.4 Infrastructure & Security questionnaire

The Infrastructure & Security form uses `IT-IS PMS` exclusively. Before choosing an asset tag, the technician must select one of these exact `IT-IS Asset Type` values:

- Switch
- Firewall
- Access Point
- OMADA Controller
- Server
- FortiAnalyzer

Known tracker prefixes are validated against the chosen type: `SW` → Switch, `FW` → Firewall, `AP` → Access Point, and `SVR` → Server. A known mismatch is rejected. An unfamiliar future prefix remains selectable and is stored with a data-quality flag so a newly introduced naming convention does not silently block maintenance.

The Infra checklist has four mandatory checks; none supports N/A:

**Physical Checking**

- Power Cables Checked
- Data Cables Checked
- Power Supply / UPS Checked

**Digital Checking**

- Firmware Version at latest

Two evidence files are also mandatory for completion:

1. **Latest Firmware Version Evidence**, stored in the configured [firmware evidence folder](https://drive.google.com/drive/folders/1_YwagxFnBU8M6Yx6Ilr8oy8JFGClgw9I4O7zHQ-K0vsbgVUGCISKjjDNO8TiB23GlY0HHJ47).
2. **Configurations / Backup / Checkpoints Evidence**, stored in the configured [configuration and backup evidence folder](https://drive.google.com/drive/folders/1IuRmXoTM7pctSvEe6489RP9hgA-AbcXNoeJI_o4IhPeSHT8Bk14ZjiRCitU972lczPpLAojg).

Infra completion is deliberately shown as `completed/6`: four checked maintenance items plus two verified evidence files. A draft may be saved with fewer than six requirements, but **Complete PMS** is enabled only at `6/6` and after the shared assessment is valid. Evidence already attached to a draft remains linked after reload.

### 8.5 Assessment

| Field | Behavior | Required |
| --- | --- | --- |
| Assessment result | `No findings`, `Findings resolved`, or `Follow-up required` | Yes |
| Asset findings | Multiline text; may use explicit `No findings` only when result is `No findings` | Yes |
| Action taken | Multiline text; may use explicit `No action required` | Yes |
| Recommendation | Multiline text; may use explicit `None` | Yes |

The explicit assessment result is needed for reliable dashboard metrics; free-text interpretation alone is not dependable.

## 9. PMS cycle and compliance rules

### 9.1 Cycle derivation

| Cycle | Start | Deadline |
| --- | --- | --- |
| T1 | January 1 | April 30 |
| T2 | May 1 | August 31 |
| T3 | September 1 | December 31 |

The cycle and year always come from **Maintenance Performed On**, not the submission timestamp. A technician may submit an older maintenance date. Dates after the current date are rejected.

Every record also receives a derived, immutable cycle ID such as `2026-T1`, `2026-T2`, or `2027-T1`. Years are never hardcoded into the application, so January 1 of a new year automatically derives the new year's T1 without a code change.

### 9.2 Completion rules

- Eligibility: the asset exists in the user's section master and its status is exactly `INPROD` at submission time.
- The asset picker evaluates existing completion against the cycle derived from **Maintenance Performed On**, rather than today's cycle. Current `INPROD` status is still revalidated by the server on every save.
- A Service Desk compliance completion requires 100% of applicable checklist items. An Infrastructure & Security compliance completion requires all four checks plus both verified Drive evidence files (`6/6`).
- A compliance completion is a successfully synchronized record whose final-column status is `COMPLETED`.
- Any record below 100% is `INCOMPLETE`, remains resumable by record ID, and does not alter a term checkbox or remarks cell.
- Completion metrics count unique asset tag + maintenance year + PMS cycle combinations.
- Multiple records for the same asset and cycle never inflate completion counts.
- If a completed record already exists for the asset/cycle, the UI warns the technician and records the next submission as a reinspection. The latest record is shown in activity, while compliance remains one completed asset.
- A status change between modal load and submit causes the server to reject or refresh the submission rather than accepting stale eligibility.

### 9.3 Final-column completion decision

The last column of each response tab is exactly `PMS Completion`. It is system-managed, visually formatted as an in-cell progress indicator, and is the authoritative completion decision for that response row.

Examples:

- `██████░░░░ 60% — INCOMPLETE`
- `██████████ 100% — COMPLETED`
- `██████████ 100% — SYNC REQUIRED`
- `██████████ 100% — SYNC FAILED`

The server calculates this value from the requirements for the record's section; a user cannot type or edit it. For Infra, each of the four checks and two evidence files contributes one of six required units. Only the exact `COMPLETED` state counts toward compliance. A 100% record is not finalized as `COMPLETED` until its tracker remarks and checkbox have both been synchronized successfully.

### 9.4 PMS tracker synchronization

When the final checklist reaches 100%, the server finds the selected asset in the PMS tab assigned to the registered section and uses the maintenance date to choose the exact pair:

| PMS cycle | Checkbox | Remarks |
| --- | --- | --- |
| T1 | Column D | Column E (`T1 Remarks`) |
| T2 | Column F | Column G (`T2 Remarks`) |
| T3 | Column H | Column I (`T3 Remarks`) |

The server must verify all of the following immediately before writing:

- signed-in user and registered section are still authorized;
- asset tag still belongs to that section;
- asset status is still `INPROD`;
- the asset tag resolves to exactly one row;
- the maintenance year matches the tracker year in row 2;
- the response row satisfies its section-specific completion rule and has all required assessment fields;
- for Infrastructure & Security, both evidence descriptors and the actual Drive files still pass signature, folder, ownership-context, metadata, size, and SHA-256 verification.

For a valid completion, the write sequence under one script lock is:

1. Save or update the response row as `SYNCING`.
2. Append the assessment block to the correct Remarks cell while preserving any existing remarks.
3. Set the paired T1/T2/T3 checkbox to `TRUE`.
4. Verify both tracker cells.
5. Set the last response-sheet column to `██████████ 100% — COMPLETED`.

The remarks block must contain the technician's complete assessment, not a shortened summary. Infrastructure & Security remarks additionally include the IT-IS asset type, all four check results, and both evidence file names and Drive URLs:

```text
[PMS Record: <record ID>]
Technician: <name> <email>
Maintenance Performed On: <date>
Assessment Result: <result>
Asset Findings: <complete technician entry>
Action Taken: <complete technician entry>
Recommendation: <complete technician entry>
[End PMS Record: <record ID>]
```

If the Remarks cell already contains text, the new block is appended below a clear separator. A retry with the same record ID must update or recognize the existing block rather than append it twice. The checkbox is written after the remarks so a checked asset cannot be left without its assessment.

Backdated maintenance remains valid. If its year is older than the operational tracker year, the app finalizes it as a historical `COMPLETED` record with `HISTORICAL_NO_TRACKER_WRITE` and does not change the current-year D:I projection. A record dated ahead of the tracker year remains `SYNC REQUIRED` until that year is opened. The app never checks a term for the wrong year.

### 9.5 Legacy completion compatibility

On first authorized use for each tracker year and section, the app performs a one-time, read-only baseline scan of the operational tracker and batch-imports pre-existing checkboxes/remarks into the response tab for that section as `LEGACY` records. After that baseline is committed, the final `PMS Completion` column is authoritative: the dashboard never treats later raw/manual checkbox changes as completion evidence. This preserves launch-day progress while preventing a partially synchronized or manually changed checkbox from bypassing the response decision.

### 9.6 Live compliance versus audit-grade compliance

Using the current `INPROD` list as the denominator produces a **live compliance** view. If an asset changes status later, historical denominators can change. An audit-grade historical SLA needs a per-cycle eligibility snapshot.

Recommended version-1 behavior: show live compliance and label it clearly. A future approved `PMS Cycle Scope` store can freeze the eligible roster at cycle start and record later additions/removals with reasons.

### 9.7 Annual rollover and new-year scalability

`PMS Records` and `PMS Records - Infra & Security` are the permanent multi-year sources of truth for their respective sections. Both use a long-form structure: each record carries its own maintenance year and cycle ID. The design must never add another six response columns for every new year.

The D:I term columns in `IT-SD PMS` and `IT-IS PMS` are treated as a **current-year operational projection**, not the historical database. Row 2 identifies the year currently projected there. At the end of 2026, an administrator uses a controlled **Start New PMS Year** action to prepare 2027.

The rollover is manual and administrator-only; it must not run automatically at midnight. The action first presents a dry-run report, requires explicit confirmation, and performs these steps under a script lock:

1. Verify the current tracker year and reject a duplicate or skipped-year rollover.
2. Verify that the one-time legacy baseline exists for both closing-year sections.
3. Block rollover while any closing-year `SYNCING`, `SYNC FAILED`, or `SYNC REQUIRED` record remains; the administrator must use the recovery control and resolve any permanent failure first.
4. Reconcile completed, pending, findings, and follow-up counts from authoritative records for both sections and all three cycles.
5. Write a `YEAR_CLOSE` audit event into `PMS Records` containing the old year, counts, administrator, and timestamp.
6. Change the tracker year in row 2 to the new year.
7. Reset only the D/F/H term checkboxes and E/G/I term remarks for the new operational year; columns A:C and all other cells remain untouched.
8. Verify the reset and write a `YEAR_OPEN` audit event into `PMS Records`.
9. Reconcile any already-saved new-year records that were waiting as `SYNC REQUIRED`, using persisted 50-row cursors and scheduled continuation until every queued row has been attempted.

A new-year record submitted before rollover is still accepted into its section's response tab. It remains `SYNC REQUIRED` and cannot be counted as tracker-synchronized until the administrator opens that year. This avoids writing a 2027 T1 result into the 2026 tracker.

The dashboard obtains its year choices dynamically from stored maintenance years. Historical 2026 results continue to be available after the visible PMS tracker has moved to 2027.

### 9.8 Capacity and performance outlook

At the current eligible population of 1,233 assets, full three-cycle coverage produces approximately 3,699 completed asset-cycle records per year before drafts and reinspections. With the implemented 70-column Service Desk schema and 62-column Infra schema, that is about 256,050 cells per year.

The reviewed workbook currently allocates approximately 2.57 million grid cells. Google Sheets supports up to 10 million cells per spreadsheet, leaving roughly 7.43 million cells at the review snapshot. At the current asset volume, raw storage is sufficient for many years, although practical performance must be managed well before the hard limit. See [Google Drive file limits](https://support.google.com/drive/answer/37603).

Scalability requirements:

- never scan the entire workbook or call `getDataRange()` during an interactive request;
- read only the selected year, cycle, section, and required columns;
- batch-import the launch baseline and reuse one record read for dashboard metrics plus recent activity;
- cache large section asset lists in integrity-checked chunks below Cache Service per-key limits;
- monitor workbook cell count, Apps Script latency, failures, and quotas;
- issue an administrator capacity warning at 70% of the spreadsheet cell limit;
- define a reviewed archive process for closed years before the workbook reaches the warning threshold.

Apps Script currently limits an individual execution to six minutes, so rollover, reconciliation, and archive work must use bounded batches with resumable checkpoints rather than one unbounded job. See [Apps Script quotas and limits](https://developers.google.com/apps-script/guides/services/quotas).

## 10. Dashboard requirements

### 10.1 Technician dashboard

- Current maintenance year and PMS cycle, including the cycle deadline and days remaining.
- Eligible `INPROD` assets.
- Completed unique assets.
- Pending assets.
- Compliance percentage.
- Assets with findings.
- Follow-up required.
- “My completed this cycle.”
- Overall progress bar toward 100%.
- Completion by location.
- Recent submissions table with record ID, date performed, asset, result, and status.
- Primary **New maintenance record** button that opens the questionnaire modal.

### 10.2 Administrator dashboard

- All technician metrics.
- Section selector: all, Service Desk, Infrastructure & Security.
- Filters for year, PMS cycle, location, technician, result, and completion source.
- Year options are discovered from stored cycle IDs and are never hardcoded to 2026.
- Comparison of section compliance.
- Pending assets by location.
- Findings and follow-up queue.
- Data-quality indicators: blank master locations, unverified peripheral tags, unknown Infra tag prefixes, and rejected/stale submissions.

### 10.3 Metric definitions

| Metric | Definition |
| --- | --- |
| Eligible | Unique current `INPROD` asset tags in scope |
| Completed | Unique eligible asset tags with a completed new record or eligible legacy flag for the selected year/cycle |
| Pending | `max(Eligible - Completed, 0)` |
| Compliance % | `Completed / Eligible × 100`; show N/A if Eligible is zero |
| With findings | Unique assets whose latest completed record is not `No findings` |
| Follow-up required | Unique assets whose latest completed record result is `Follow-up required` |
| Overdue | Pending assets after the selected cycle deadline |

Metrics must never count submissions, rows, or repeat inspections as extra completed assets.

## 11. New response storage

The approved response tabs are `PMS Records` for Service Desk and `PMS Records - Infra & Security` for Infrastructure & Security. They have separate schemas because the questionnaires are materially different. A saved incomplete record is updated in its original section tab by its server-issued record ID until completion; a later reinspection receives a new record ID. Dashboard, archive, duplicate detection, and reconciliation reads aggregate both tabs without weakening section authorization.

Existing asset-master columns remain read-only, and the only normal runtime writes to an existing tab are the matched cycle checkbox and paired remarks cell described in section 9.4 (plus the explicit administrator rollover of D2 and D:I).

The 70-column Service Desk schema contains:

1. Audit: record ID, submission timestamp, idempotency key, record type, schema version.
2. Identity: technician name, technician email, registered section.
3. Cycle: maintenance date, maintenance year, cycle, immutable cycle ID, and cycle deadline.
4. Asset snapshot: source tab, source row, asset tag, status, master location, observed location, location discrepancy.
5. Peripherals: one column for each of the ten listed peripheral types; multiple tags serialized as a stable delimiter-separated value.
6. Checklist: one boolean/applicability field per checklist item, category counts, total completed, total applicable, completion percentage.
7. Assessment: result, asset findings, action taken, recommendation.
8. Tracker synchronization: target PMS tab/row/year/cycle, prior checkbox value, prior remarks snapshot, sync timestamp, and sync error if any.
9. System: legacy completion used, duplicate/reinspection reference, data-quality flags, created-at and updated-at time zone.
10. **Final column:** `PMS Completion`, containing the system-generated progress indicator and decisive status.

The 62-column Infra schema contains:

1. The same audit, identity, cycle, asset snapshot, assessment, tracker synchronization, and system controls needed for a durable PMS record.
2. `IT-IS Asset Type` and a section form type/schema version.
3. Four dedicated physical/digital check fields and their counts.
4. Server-derived metadata for each required evidence file: Drive file ID, file name, URL, MIME type, size, SHA-256 digest, upload timestamp, and uploader.
5. **Final column:** `PMS Completion`, containing the system-generated six-unit progress indicator and decisive status.

Headers are created once and validated before any append. Writes use locks, a unique record ID, an idempotency key, and a final server-side asset lookup to prevent duplicate or inconsistent rows. A legacy Infra draft found in the old shared schema remains preserved but cannot be extended with evidence; the technician must start a new Infra record in the dedicated tab.

### 11.1 Infrastructure evidence storage and security

- The browser selects only an evidence category and file. It cannot supply a destination folder, trusted metadata, uploader identity, section, or completion state.
- The server uploads each file to its fixed preconfigured Drive folder under the deploying owner's authority and does not change sharing settings or make evidence public. Access continues to follow the folder's existing Drive permissions.
- The manifest requires the full `https://www.googleapis.com/auth/drive` scope because the app writes to two fixed, pre-existing folders. The deploying owner must explicitly authorize that added scope before the Infra form is released.
- Each evidence file is limited to 10 MiB. The server allows only configured document, image, archive, text, and configuration extensions/MIME types; it rejects empty files, scripts, executables, HTML, SVG, and suspicious executable or markup signatures.
- File names are sanitized. The server derives the Drive metadata and SHA-256 digest, then signs a descriptor bound to the record ID, idempotency key, technician, section, asset type, asset tag, maintenance date, cycle, evidence kind, and required folder.
- Evidence metadata is committed to the draft immediately after upload so a reload can recover it. Completion and tracker reconciliation re-open the Drive file and verify that it is not trashed, remains in the required folder, and still matches its signed name, URL, MIME type, size, and SHA-256 digest.
- A technician can upload only to the technician's own incomplete Infra record. Evidence for a completed record cannot be replaced through the app.

### 11.2 Registration storage decision

Registration profiles are stored in the dedicated `PMS Users` tab, one row per normalized YDC email. It contains the saved display name, locked IT section, role, active state, and audit timestamps. The tab doubles as the access roster: presence of an email is what authorizes sign-in.

The server-hashed Google temporary user key may bind a returning technician to one previously registered, active profile when `ActiveUser` is temporarily blank. It is never accepted from the browser and cannot authorize registration or administrator functions. A live `ActiveUser` email is required for administrator access. Existing Script Property profiles are migrated once and retained only as rollback evidence. An explicitly configured administrator can change a user's section through the server API.

## 12. UX and visual design

- Minimalist SaaS layout with a neutral background, one accent color, compact cards, generous spacing, and clear type hierarchy.
- Responsive desktop and mobile layout.
- Persistent top bar showing user, section, current cycle, and sign-in state.
- Dashboard first; questionnaire appears as a large modal on desktop and a full-screen sheet on mobile.
- Stepper and overall progress remain visible while scrolling.
- **Save progress** persists an incomplete record without synchronizing the tracker; closing a dirty modal still requires confirmation.
- Clear loading, empty, success, warning, and error states.
- Keyboard-operable combobox, checkboxes, modal focus trap, visible focus states, sufficient contrast, and semantic labels.
- No color-only status communication.

## 13. Non-functional requirements

### Security and privacy

- Domain restriction, server-side domain validation, and server-side roster validation.
- Identity, section, and role never accepted from the browser as authoritative.
- Never identify a web-app visitor through `Session.getEffectiveUser()`; a live `ActiveUser` is mandatory for registration and administrator access.
- Output escaped before rendering.
- Spreadsheet ID and allowed sections kept in server configuration.
- No OAuth tokens or sensitive server errors returned to the browser.
- Store only business identity and maintenance data required for the workflow.
- Keep Infra evidence in the two fixed Drive folders with inherited permissions; the app never creates a public link or changes file/folder ACLs.

### Reliability

- Lock concurrent writes.
- Idempotent submission retries.
- Revalidate asset eligibility immediately before append.
- Revalidate required Infra evidence before completion and again before tracker synchronization.
- Return a stable record ID only after the row is confirmed.
- Log server errors with correlation IDs.
- Existing asset and dashboard tabs remain untouched if the new-record append fails.

### Performance

- Load only the signed-in user's section asset list.
- Filter already-completed picker items against the year/cycle derived from the selected maintenance date.
- Cache read-only asset lists and summary metrics briefly, then invalidate after a successful submission.
- Search asset options locally after the scoped list is returned.
- Target initial dashboard load under three seconds on a normal corporate connection, subject to Apps Script cold starts.

### Time zone

The workbook remains on its existing time zone. The application logic and Apps Script manifest use `Asia/Manila`, making the business boundary for dates and trimester derivation explicit.

## 14. Edge cases

- Blank signed-in email with one valid temporary-key binding → allow returning-technician continuity only; never allow registration or administrator access through this path.
- Blank signed-in email without a unique active binding → refuse with an `IDENTITY_UNAVAILABLE` message telling the user to open the domain-restricted deployment and approve access. No session is created and no data is written.
- Non-YDC email → access denied.
- YDC email that is not on the `PMS Users` roster → refuse with `ACCESS_NOT_PROVISIONED` and instructions to ask an administrator to add the email.
- Roster row explicitly marked `Active = FALSE` → refuse with `ACCOUNT_DISABLED`.
- Malformed roster row → skipped with a logged warning; other users are unaffected.
- Rostered user with no section yet → registration screen only.
- Wrong-section asset supplied manually → server rejection.
- Asset no longer `INPROD` at submit → refresh and require a new selection.
- Blank master location → require observed location and flag the record.
- Duplicate submit caused by retry/double-click → one record through idempotency.
- Prior completion for the same asset/cycle → reinspection warning; no double count.
- Backdated record in the current tracker year → accepted and synchronized to its derived cycle.
- Backdated record older than the tracker year → accepted as historical `COMPLETED` with `HISTORICAL_NO_TRACKER_WRITE`; no wrong-year checkbox is changed.
- Record dated ahead of the tracker year → retained as `SYNC REQUIRED` until that tracker year is opened.
- Future maintenance date → rejected.
- No eligible assets → dashboard empty state, not an error.
- Partial checklist → may be saved as `INCOMPLETE`; no tracker checkbox or remarks cell is changed.
- Infra asset type does not match a known tag prefix → reject; unknown future prefix → allow with a data-quality flag.
- Missing, moved, trashed, changed, oversized, or unsafe Infra evidence → refuse completion and leave the tracker unchanged.

## 15. Acceptance criteria

1. A signed-in allowed-domain user on the `PMS Users` roster is identified without entering an email, a code, or any second factor.
2. A YDC user who is not on the roster is refused with a clear provisioning message and creates no profile row.
3. A first-time rostered user can register exactly one IT section.
4. A registered Service Desk user cannot retrieve or submit an Infrastructure & Security asset, and vice versa.
5. The asset combobox contains only nonblank tags whose current column-B status is `INPROD`.
6. Status and master location come from the authoritative PMS tab and cannot be edited directly.
7. Maintenance date accepts valid past dates, rejects future dates, and derives the correct year/cycle at boundary dates.
8. Every listed peripheral field and checklist item is represented in the response schema.
9. N/A checklist items are explicit and excluded from progress; below 100% saves as `INCOMPLETE`, while completion requires 100% of applicable items.
10. Assessment result, findings, action, and recommendation follow the stated conditional rules.
11. A saved draft creates or updates exactly one validated response row and sets the last column to an `INCOMPLETE` progress status.
12. Only a 100% valid record can become `COMPLETED`.
13. Completion writes the full Findings, Action Taken, and Recommendation block to the correct cycle Remarks cell, preserving existing content.
14. Completion then checks the paired T1/T2/T3 checkbox on the asset's exact section row.
15. A normal completion modifies no existing workbook cell other than that matched checkbox and paired remarks cell; annual D2/D:I changes require the separate administrator rollover confirmation.
16. A tracker synchronization failure cannot leave the response row marked `COMPLETED`.
17. Dashboard counts unique eligible assets rather than rows or total inventory.
18. Repeat maintenance does not inflate compliance or duplicate the same remarks block.
19. Modal, searchable dropdown, and checklist are usable by keyboard and on mobile.
20. The existing `Code.js` file remains unchanged.
21. A maintenance date of January 1, 2027 derives `2027-T1` without a deployment or code change.
22. A new-year completion submitted before rollover is safely stored as `SYNC REQUIRED` and never changes the prior year's tracker.
23. The administrator rollover preserves prior-year history, updates the tracker year, resets only D:I term cells, and reconciles waiting new-year records.
24. Repeating an already completed rollover is rejected and cannot clear the active year twice.
25. An Infrastructure & Security user receives the Infra form only, selects one of the six approved asset types, and can select only `INPROD` tags from `IT-IS PMS`; known prefixes must match the selected type and unknown prefixes are flagged.
26. An Infra draft is stored in `PMS Records - Infra & Security`; Service Desk records remain in `PMS Records`, and combined dashboards aggregate both without cross-section exposure.
27. Infra progress reaches 100% only at `6/6`: four required checks and two authenticated evidence files.
28. Each Infra evidence file is 10 MiB or smaller, passes the server allowlist/content checks, is stored in its configured folder without an ACL change, and remains verifiable by signed metadata and SHA-256 before completion.
29. Asset availability is evaluated for the cycle derived from the selected maintenance date, so a T1 completion does not hide an asset from T2 or T3.
30. `Session.getEffectiveUser()` is never used to identify a visitor. Temporary-key continuity cannot register or elevate a user, and administrator actions require a live `ActiveUser` email.

## 16. Implemented decisions

1. **Application storage:** `PMS Records` stores Service Desk history, `PMS Records - Infra & Security` stores Infra history and evidence metadata, and `PMS Users` stores persistent registration profiles; pre-existing workbook tabs remain otherwise unchanged.
2. **Full name source:** one-time user-confirmed display name, initially derived from email, with the validated Google-account email as the authoritative identity.
3. **Historical denominator:** live current-`INPROD` compliance in version 1.1; cycle-scope snapshots remain a later enhancement.
4. **Tracker-year mismatch:** complete archived past-year records in the appropriate section response tab without changing D:I; retain ahead-of-tracker records as `SYNC REQUIRED` until rollover. Never write to the wrong tracker year.
5. **Blank locations:** require observed location without changing the asset master.
6. **Peripheral validation:** capture normalized peripheral tags as technician-entered evidence; they are not used to determine main-asset eligibility.
7. **Legacy progress:** batch-import pre-existing tracker flags once, then use the two section response tabs as the sole completion authority.
8. **Annual rollover:** treat D:I as the current-year operational view and preserve multi-year history in the two section response tabs.
9. **Infra completion:** require four section-specific checks plus two verified Drive evidence files (`6/6`) before synchronization.
10. **Asset picker scope:** apply existing T1/T2/T3 completion flags to the cycle and year derived from the technician's selected maintenance date.
11. **Identity continuity:** use only `ActiveUser` as live identity; a server-hashed temporary key may restore one active returning profile but can never register a user or authorize an administrator.
