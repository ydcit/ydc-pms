# Preventive Maintenance Web App — Product Requirements Document

**Status:** Version 2.0 implemented and in production
**Version:** 2.0
**Date:** 2026-08-22
**Source workbook:** [PMS - All Asset](https://docs.google.com/spreadsheets/d/1T33Z8JFRdL9oFZ-6XT_lz-tNIAFKXF2ekp-e-cYm7uc/edit)
**Workbook handling:** Discovery was read-only. Implementation adds only the approved application storage tabs; source and asset-master data remain read-only except for controlled tracker synchronization and administrator-controlled operations described below.
**Change note:** This revision documents everything built and shipped after the original version 1.1 PRD (2026-08-13): findings-ticket repair tracking, deferred-asset visibility, an in-app asset-management screen, an in-app user-management screen, resumable drafts with duplicate prevention, permanent read-only locking of completed records with an edit-attempt audit trail, three administrator data-lifecycle tools (Year Purge and Reset, alongside the existing Rollover), and a daily cycle-deadline email reminder. Section and paragraph numbering has been kept stable where the underlying requirement is unchanged, with new sections inserted where a subsystem is new.

## 1. Product summary

Build a Google Apps Script web app for YDC's preventive-maintenance process. A signed-in YDC technician sees a section-specific dashboard and opens the maintenance questionnaire in a modal. The app automatically identifies the technician, limits asset choices to the technician's registered IT section, and only offers assets whose current equipment status is `INPROD`.

The modal renders a section-specific questionnaire. Service Desk records are stored in `PMS Records`; Infrastructure & Security records, including Drive evidence metadata, are stored in `PMS Records - Infra & Security`. Existing workbook data is read-only except for the controlled write that marks the matched asset's correct cycle status as `COMPLETED` (or a repair-in-progress state — see §9A) and stores the completed technician assessment in its paired Remarks cell. The dashboard aggregates both response tabs and tracks whether all eligible assets receive PMS within each four-month maintenance cycle:

- T1: January 1–April 30
- T2: May 1–August 31
- T3: September 1–December 31

The recommended product term is **PMS Cycle** or **Maintenance Cycle**, rather than "trimester," because each period is four months. The operational target is **PMS compliance**: 100% of eligible assets completed by the cycle deadline. This is similar to an SLA target, but it is more accurately described as a compliance target.

Beyond the original record-taking workflow, the product now also: tracks repair work raised by a maintenance finding through to resolution (§9A); gives a technician a resumable Drafts list and prevents accidental duplicate submissions (§7A); permanently locks a completed record against edits while giving any viewer, not only the technician, a read-only view of it (§7B); gives an administrator or delegated Asset Manager an in-app screen to add, edit, and bulk-update the asset master instead of hand-editing the tracker sheet (§11.3); gives an administrator an in-app screen to manage the user roster's section, role, and active status (§11.4); and proactively reminds every technician by email, once a day, as a cycle's deadline approaches (§9C).

## 2. Workbook review

### 2.1 Relevant tabs and observed data

| Tab | Current role | Populated assets | `INPROD` | Data-quality observation |
| --- | --- | ---: | ---: | --- |
| `IT-SD PMS` | Service Desk asset master and legacy T1/T2/T3 tracker | 1,365 | 1,113 | 170 blank locations |
| `IT-IS PMS` | Infrastructure & Security asset master and legacy T1/T2/T3 tracker | 153 | 120 | 151 blank locations |
| `Source IT-SD` | Formula mirror of `IT-SD PMS!A3:C` | 1,365 | 1,113 | Not an independent source |
| `Source IT-IS` | Formula mirror of `IT-IS PMS!A3:C` | 153 | 120 | Not an independent source |
| `PM Dashboard` | Existing generated summary | 1,518 total | Not filtered | Counts every status, not only `INPROD` |

The source tabs use `ARRAYFORMULA` to mirror the first three columns of the PMS tabs. Therefore the web app's authoritative runtime source is:

- Service Desk → `IT-SD PMS`
- Infrastructure & Security → `IT-IS PMS`

Both PMS tabs use:

- Row 2, column D: tracker year (e.g. `2026`)
- Row 3: headers
- Column A: `TAGGING`
- Column B: `STATUS OF EQUIPMENT`
- Column C: `LOCATION OF ASSET`
- Columns D/E: T1 completion status and remarks
- Columns F/G: T2 completion status and remarks
- Columns H/I: T3 completion status and remarks

No duplicate asset tags or discrepancies between each PMS tab and its source mirror were found in the read-only review.

### 2.2 Current metric implications

The current eligible population, using the requested `INPROD` rule, is 1,233 assets: 1,113 Service Desk and 120 Infrastructure & Security. These figures are a discovery-time snapshot; live compliance is now visible on the production dashboard at all times (§10).

## 3. Goals

1. Make completing a PMS record fast and difficult to enter incorrectly.
2. Ensure a technician can view and select assets only from the technician's registered IT section.
3. Enforce the `INPROD` eligibility rule in both the interface and the server.
4. Capture a complete, searchable maintenance audit trail.
5. Show progress toward 100% completion for every PMS cycle.
6. Preserve the asset-master content and legacy script while allowing only the explicitly approved status-and-remarks synchronization and the explicitly approved administrator data-lifecycle operations described in §9B.
7. Carry a maintenance finding through to an actual repair outcome, not just record that a problem was found (§9A).
8. Let day-to-day roster and asset-master administration happen inside the app, under the same authorization rules as everything else, instead of by hand-editing spreadsheet rows (§11.3, §11.4).
9. Proactively surface an approaching deadline instead of relying on a technician to check the dashboard (§9C).

## 4. Non-goals

Carried forward from version 1.1, with items that have since been built removed and annotated:

- Editing asset tags, equipment status, or master locations from the web app remains out of scope for the **asset master's own identity columns** — the Manage Assets screen (§11.3) edits status and location, which was explicitly approved once an authorization model existed; the asset tag itself and section are still not editable in place.
- Replacing the asset-management process that populates the PMS tabs.
- Modifying the existing `Code.js` legacy Google Form updater.
- Writing anywhere in an existing tab except the matched asset's cycle status and paired remarks cell in `IT-SD PMS` or `IT-IS PMS` after a completed PMS record, the explicit administrator rollover of D2 and D:I (§9.8), and the explicit administrator Year Purge/Reset operations (§9B) — all three are approved, deliberate, audited exceptions to "read-only."
- Editing `Source IT-SD`, `Source IT-IS`, `PM Dashboard`, or `OVERALL SCHEDULE` from the web app.
- Public or non-YDC access.
- ~~Automatic ticket creation~~ — **built**, see §9A. A ticket is never created without a person filing it (directly, or through the guided "Track the repair" panel), but the workflow, the tracker-cell mapping, and the email notification are automatic once filed.
- ~~Email reminders~~ — **built**, see §9C, scoped specifically to a daily cycle-deadline reminder. Broader escalation workflows (e.g., per-technician overdue-asset digests) remain out of scope.
- Escalation workflows beyond the deadline reminder in §9C.

## 5. Users and permissions

### 5.1 Technician

- Must sign in with an allowed YDC Google Workspace account.
- Registers an IT section on first use: `Service Desk` or `Infrastructure & Security`.
- After registration, sees only the registered section's assets and metrics.
- Cannot change the stored section without an administrator-approved reset.
- Can create maintenance records, save an in-progress draft and resume it later, view recent submissions and a personal Drafts list, view any completed record (read-only) regardless of who submitted it, file or advance a findings ticket on any asset, and view the Deferred Assets list for their section.

### 5.2 Asset Manager (new role)

- A technician's roster row can independently carry an Asset Manager grant, set by an administrator.
- Everyone — Asset Manager or not — can *view* the Manage Assets screen for their own section; only a user with this grant (or an administrator) can add an asset, edit an asset's status/location, or run a bulk CSV update.
- An administrator already has every permission this role grants; it is never a separate elevation for an administrator, only something a technician's own roster row can turn on.
- Granting or revoking this role is a server function (`PMS.Auth.adminSetAssetManager`) invoked either through the in-app Manage Users screen (§11.4) or directly against the roster.

### 5.3 PMS administrator

- Can view combined and section-level dashboard metrics for every section at once.
- Can add a bare roster row for a new hire, and edit an existing user's IT section, role (Technician/Asset Manager), and active status through the in-app Manage Users screen (§11.4). Administrator status itself is never editable this way — see §5.4.
- Can inspect submission records and data-quality flags.
- Can run the annual Rollover, Year Purge, and Reset data-lifecycle operations (§9B).
- Can import legacy (pre-web-app) completed maintenance in bulk, and — unlike an ordinary technician — into any section and into a historical (already-closed) tracker year (§9.6).
- Administrator identities must come from a configuration allowlist, not from a client-side control.

### 5.4 Authorization rules

All authorization is enforced again on the server. The browser must never be trusted for email, section, role, asset status, asset location, cycle, or completion calculations. Administrator status is a **configuration-level** fact — a static allowlist plus an optional Script Property allowlist for additional administrators — never a spreadsheet cell an in-app screen can toggle. This is a deliberate, permanent design boundary: the Manage Users screen can promote a technician to Asset Manager or demote them, edit section, and toggle active status, but it structurally cannot grant or revoke administrator access, because the server-side function it calls never reads or writes that field. An administrator is added only by editing the configuration allowlist or the `PMS_ADMIN_EMAILS` Script Property directly.

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

When the live active-user email is temporarily blank for a returning technician, the server may hash `Session.getTemporaryActiveUserKey()` and resolve it only to one previously bound, active `PMS Users` profile. The raw temporary key is never stored or sent to the browser. This continuity path cannot register a user, create or select a profile, change a section, or grant administrator access. Registration and every administrator operation require a live `Session.getActiveUser()` email; an unresolved or ambiguous temporary-key lookup is denied.

### 6.3 Access provisioning

Adding a technician is a single administrator action, available two ways: adding the person's `@ydc.com.ph` address to a new row in `PMS Users` directly, or using the Manage Users screen's **Add user** action (§11.4), which performs the identical bare-row provisioning through the server rather than a spreadsheet edit. Leaving `Active` blank means active; only an explicit `FALSE` disables an account. The technician then picks their IT section once on first sign-in.

A malformed row must never block sign-in for anyone else, so the directory reader skips unreadable rows with a logged warning instead of failing the whole lookup.

## 7. Primary user flow

1. Technician opens the web-app URL and signs in with a YDC account.
2. The server validates identity and domain.
3. On first use, the technician registers a section.
4. The dashboard loads with the technician's name, section, current PMS cycle, and section-scoped metrics.
5. The technician selects **New PMS** to start a fresh record, or resumes an unfinished one from **My Drafts** (§7A).
6. A responsive modal opens and renders the questionnaire for the technician's registered section:
   1. Asset and date
   2. Included peripherals for Service Desk, or required evidence for Infrastructure & Security
   3. The section-specific checklist
   4. Assessment and review
7. The technician may **Save progress** while requirements are incomplete or select **Complete PMS** after every applicable item is resolved. An Infrastructure & Security draft receives a stable record ID before evidence is uploaded.
8. If the assessment result is `Follow-up required` or `PMS not performed`, the technician must file a findings ticket (guided in-modal, or separately) before the record can complete (§9A).
9. The server revalidates the user, asset, status, section, date, cycle, questionnaire schema, findings-ticket requirement, and any required evidence.
10. The app creates or updates the auditable row in the response tab for that section and computes the final `PMS Completion` value in the last column.
11. An incomplete record stops there and does not affect a tracker status.
12. A completed record writes the full assessment to the correct T1/T2/T3 Remarks cell and then sets the paired term status to `COMPLETED` — or, if an open findings ticket exists for that asset, to the repair status that ticket maps to (§9A).
13. The app finalizes the response row, refreshes the dashboard, and displays the record ID. The record becomes permanently read-only from this point (§7B), and a completion email fires to subscribed recipients (§9D).

### 7A. Drafts and duplicate-submission prevention

An incomplete record is a resumable draft, listed for its owner under the **My Drafts** dashboard button (with a count badge) and identified by asset tag, cycle, and checklist progress. A draft is never counted toward compliance and never touches the tracker.

The client warns a technician who tries to start a *second* record against an asset they already have an open draft for, pointing them to Drafts instead of letting them fill out a duplicate questionnaire from scratch. Server-side, `save()` additionally recognizes this situation by natural key (section, asset tag, cycle, technician) whenever a submission arrives without a matching record ID or idempotency key — the common result of a page reload or a retried failed request — and adopts the existing open draft instead of minting a new row. A completed record is never adopted this way; a fresh attempt against an already-completed asset/cycle is always treated as a new **reinspection**, never merged into the prior completed row.

An administrator has two console-only cleanup tools for any duplicates that predate this protection or otherwise slip through: one flags every duplicate open draft for the same natural key except the most-progressed one (never deleting data), and one deletes specific — or all — incomplete records outright, for a genuine "start over" reset.

### 7B. Permanent read-only lock on a completed record

Once a record's `PMS Completion` state reaches `COMPLETED`, it can never be edited again, by anyone, including the technician who completed it. This applies uniformly:

- The Completed Assets archive lets any registered user — not only the original technician — open a completed record and view every field, including the asset-tag selector, in a read-only state, with the actual technician's name and identity shown accurately regardless of who is viewing.
- Every input, and every button except navigation (Previous/Next), Save progress, and Complete PMS themselves, is disabled the moment a read-only record is opened; a visible notice states plainly whose completed record it is and that nothing on it can be changed.
- A save attempt against an already-completed record is intercepted before any write. It never surfaces as an error to the caller (a flaky retry must not look like a failure), but it is not silent: the server appends a best-effort audit event recording who attempted the edit, when, and against which record, without ever blocking or delaying the (no-op) response the caller sees.
- Infrastructure & Security evidence follows the identical rule: evidence already attached to a completed record can never be replaced through the app.

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
| Asset tag | Searchable dropdown from `IT-SD PMS` or `IT-IS PMS` according to the stored section; only current `INPROD` rows; locked once a completed record is being viewed | Yes |
| Equipment status | Auto-populated from column B; read-only | Yes |
| Master location | Auto-populated from column C; read-only | No when source is blank |
| Observed location | Shown and required only when the master location is blank or marked incorrect | Conditional |

Because the section lists contain up to 1,113 eligible tags, "dropdown" is implemented as a keyboard-accessible searchable combobox rather than a long native select. The technician selects the maintenance date first; the derived year and T1/T2/T3 cycle determine which tracker-completion flag the picker evaluates. An asset completed in T1 remains available for T2 and T3, and a tracker flag is not applied to a selected date from a different tracker year. Any open findings ticket already filed against the selected asset — including one from a prior cycle — is shown to the technician on this step before they proceed, so a known pre-existing fault is visible up front (§9A).

### 8.2 Service Desk included peripheral asset tags

Show a fixed, compact table with one optional tag input per peripheral type. Each input supports one or more tags as removable chips so dual monitors or multiple adaptors can be recorded without comma-parsing ambiguity.

1. Yubikey
2. Laptop charger
3. Monitor
4. Keyboard
5. Mouse
6. UPS
7. Power adaptor
8. Headset
9. Type-C adaptor
10. Webcam

Peripheral entries are optional because not every maintained asset has every listed peripheral. Values are trimmed and normalized to uppercase. The technician's entered tag is accepted even when it is not found in the technician's section asset list; this supports discovery of missing inventory without silently losing the observation.

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

Each category shows `completed/applicable` and a progress bar. The modal also shows overall progress. The two "if applicable" checks support **Not applicable**. An N/A item is excluded from the denominator and must store an explicit reason or applicability state; silently leaving it unchecked does not count as complete. An item also counts as answered — not only when ticked, but when explicitly left unticked with a stated reason — so the completion percentage always reflects "every item was addressed," not merely "every item was ticked yes."

For Service Desk, **Save progress** is available below 100% and stores the record as `INCOMPLETE`; it never changes a PMS tracker status. **Complete PMS** is enabled only when 100% of applicable checklist items have been answered, and — when the assessment calls for it — a findings ticket has been filed (§9A).

### 8.4 Infrastructure & Security questionnaire

The Infrastructure & Security form uses `IT-IS PMS` exclusively. Before choosing an asset tag, the technician must select one of these exact `IT-IS Asset Type` values:

- Switch
- Firewall
- Access Point
- OMADA Controller
- Server
- FortiAnalyzer

Known tracker prefixes are validated against the chosen type: `SW` → Switch, `FW` → Firewall, `AP` → Access Point, and `SVR` → Server. A known mismatch is rejected. An asset type with no recognized prefix mapping (Access Point, OMADA Controller, and FortiAnalyzer have none) is accepted and flagged as unverified rather than blocked.

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

Infra completion is deliberately shown as `completed/6`: four checked maintenance items plus two verified evidence files. A draft may be saved with fewer than six requirements, but **Complete PMS** is enabled only at `6/6` and after the shared assessment — and, when required, a filed findings ticket — is valid. Evidence already attached to a draft remains linked after reload, and re-saving a draft never requires re-uploading evidence the server already has on file for it.

### 8.5 Assessment

| Field | Behavior | Required |
| --- | --- | --- |
| Assessment result | `No findings`, `Findings resolved`, `Follow-up required`, or `PMS not performed` | Yes |
| Asset findings | Multiline text; must read exactly "No findings" when result is `No findings` | Yes |
| Action taken | Multiline text | Yes |
| Recommendation | Multiline text | Yes |

The explicit assessment result is needed for reliable dashboard metrics; free-text interpretation alone is not dependable. A result of `Follow-up required` or `PMS not performed` is what triggers the mandatory findings-ticket requirement in §9A.

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
- A Service Desk compliance completion requires 100% of applicable checklist items answered. An Infrastructure & Security compliance completion requires all four checks plus both verified Drive evidence files (`6/6`).
- A compliance completion is a successfully synchronized record whose final-column status is `COMPLETED`.
- Any record below 100% is `INCOMPLETE`, remains resumable by record ID (or from Drafts, §7A), and does not alter a term status or remarks cell.
- Completion metrics count unique asset tag + maintenance year + PMS cycle combinations.
- Multiple records for the same asset and cycle never inflate completion counts.
- If a completed record already exists for the asset/cycle, the next submission is recorded as a reinspection. The latest record is shown in activity, while compliance remains one completed asset.
- A status change between modal load and submit causes the server to reject or refresh the submission rather than accepting stale eligibility.
- An asset whose completed record still has an open findings ticket counts in a distinct **Deferred** bucket, separate from both Completed and Pending (§9A, §10.3).

### 9.3 Final-column completion decision

The last column of each response tab is exactly `PMS Completion`. It is system-managed, visually formatted as an in-cell progress indicator, and is the authoritative completion decision for that response row and the sole basis for whether a record can still be edited (§7B).

The indicator is a ten-block Unicode bar (one block per 10%) followed by the percentage, the raw completed/applicable fraction, and a state word, for example:

- `██████░░░░ 60% (12/20) — INCOMPLETE`
- `██████████ 100% (20/20) — COMPLETED`
- `██████████ 100% (6/6) — SYNC REQUIRED`
- `██████████ 100% (6/6) — SYNC FAILED`

The server calculates this value from the requirements for the record's section; a user cannot type or edit it. For Infra, each of the four checks and two evidence files contributes one of six required units. Only the exact `COMPLETED` state counts toward compliance and only a `COMPLETED` record becomes permanently locked (§7B). A 100% record is not finalized as `COMPLETED` until its tracker remarks and status have both been synchronized successfully; for Infrastructure & Security, that synchronization step also re-verifies both evidence files in full (§11.2) — a file that has since moved, changed, or been trashed fails the completion outright rather than silently finalizing.

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
- the response row satisfies its section-specific completion rule and has all required assessment fields, including a filed findings ticket where §9A requires one;
- for Infrastructure & Security, both evidence descriptors and the actual Drive files still pass signature, folder, ownership-context, metadata, size, and SHA-256 verification.

For a valid completion, the write sequence under one script lock is:

1. Save or update the response row as `SYNCING`.
2. Append the assessment block to the correct Remarks cell while preserving any existing remarks.
3. Set the paired T1/T2/T3 status cell to the non-interactive text `COMPLETED`, or — if the record has an open findings ticket — to that ticket's mapped repair status (§9A).
4. Verify both tracker cells.
5. Set the last response-sheet column to the final `PMS Completion` value.

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

If the Remarks cell already contains text, the new block is appended below a clear separator. A retry with the same record ID must update or recognize the existing block rather than append it twice. The status is written after the remarks so a completed asset cannot be left without its assessment.

Backdated maintenance remains valid. If its year is older than the operational tracker year, the app finalizes it as a historical `COMPLETED` record with `HISTORICAL_NO_TRACKER_WRITE` and does not change the current-year D:I projection. A record dated ahead of the tracker year remains `SYNC REQUIRED` until that year is opened. The app never writes a term status for the wrong year.

### 9.5 Legacy completion compatibility

On first authorized use for each tracker year and section, the app performs a one-time, read-only baseline scan of the operational tracker and batch-imports pre-existing legacy checkbox/status values and remarks into the response tab for that section as `LEGACY` records. After that baseline is committed, the final `PMS Completion` column is authoritative: the dashboard never treats later raw/manual tracker-status changes as completion evidence. This preserves launch-day progress while preventing a partially synchronized or manually changed status from bypassing the response decision.

### 9.6 Administrator bulk legacy import

Any registered user can backfill completed PMS work that was performed before a web-app record existed, into their own section and the currently open tracker year; an administrator can additionally import into any section and into a historical (already-closed) year. One import batch contains one IT section, pasted asset tags or the first column of a local CSV/TXT file, and a maintenance date — either one shared date for the whole batch, or a per-tag date supplied as an optional second CSV column, freely mixable within the same batch.

The flow is a three-stage wizard — **Prepare → Review → Results**. Preview is mandatory and causes no workbook writes: the server classifies every input tag as ready for a new record, resumable (a previously staged but unfinished import for the same tag), a duplicate within the submitted batch, already completed, or invalid (with a specific reason: missing/unparseable date, a future year, a tag not found or duplicated on the tracker, a non-admin attempting a historical year, or a conflicting resumable entry). A row for a historical year whose asset is not currently `INPROD` is accepted with a warning rather than rejected, since a historical completion never touches the live tracker.

Confirmation uses a short-lived token bound to the administrator or technician, the normalized request, section, cycle, tracker year, and current-versus-historical mode, paired with a dynamic phrase of the form `IMPORT <count>` that must be typed exactly. Execution revalidates the complete remaining plan under the script lock and processes up to 250 records per call, continuing automatically until the whole batch — up to 1,500 unique tags — is done.

Each accepted item uses a deterministic natural key of section + normalized asset tag + cycle ID and is stored as `LEGACY_SEED`, crediting no individual technician (legacy rows are attributed to "Legacy PMS Import," not the importing administrator, so they never inflate anyone's personal completion count). For the currently open tracker year, the record is staged, the exact term Remarks block is written, the paired status becomes `COMPLETED`, and the response row is finalized only after verification. For an older year, the response is finalized as historical `COMPLETED` with `HISTORICAL_NO_TRACKER_WRITE`; current D:I cells are not changed. A year ahead of the tracker is rejected.

Legacy imports intentionally do not invent checklist answers or Infrastructure evidence. Records carry explicit data-quality flags, the importing user, batch ID, timestamp, source note when supplied, and a recommendation to consult the original source. Normal technician completion rules and Infra evidence verification remain unchanged for every other path.

### 9.7 Live compliance versus audit-grade compliance

Using the current `INPROD` list as the denominator produces a **live compliance** view. If an asset changes status later, historical denominators can change. An audit-grade historical SLA needs a per-cycle eligibility snapshot.

Recommended behavior: show live compliance and label it clearly. A future approved `PMS Cycle Scope` store can freeze the eligible roster at cycle start and record later additions/removals with reasons.

### 9.8 Annual rollover and new-year scalability

`PMS Records` and `PMS Records - Infra & Security` are the permanent multi-year sources of truth for their respective sections. Both use a long-form structure: each record carries its own maintenance year and cycle ID. The design must never add another six response columns for every new year.

The D:I term columns in `IT-SD PMS` and `IT-IS PMS` are treated as a **current-year operational projection**, not the historical database. Row 2 identifies the year currently projected there. At the end of a year, an administrator uses a controlled **Start new PMS year** action to prepare the next one.

The rollover is manual and administrator-only; it must not run automatically at midnight. The action first presents a dry-run report, requires explicit confirmation, and performs these steps under a script lock:

1. Verify the current tracker year and reject a duplicate or skipped-year rollover.
2. Verify that the one-time legacy baseline exists for both closing-year sections.
3. Block rollover while any closing-year `SYNCING`, `SYNC FAILED`, or `SYNC REQUIRED` record remains; the administrator must use the recovery control and resolve any permanent failure first.
4. Archive an exact snapshot of each section's tracker sheet, as it stood at close, into a new permanent sheet named `<sheet name> <year> (Closed)`.
5. Write a `YEAR_CLOSE` audit event into `PMS Records` containing the old year, counts, administrator, and timestamp.
6. Change the tracker year in row 2 to the new year.
7. Reset only the D/F/H term statuses and E/G/I term remarks for the new operational year; columns A:C and all other cells remain untouched.
8. Verify the reset and write a `YEAR_OPEN` audit event into `PMS Records`.
9. Reconcile any already-saved new-year records that were waiting as `SYNC REQUIRED`, using a persisted cursor and an automatic self-rescheduling background trigger, in bounded batches, until every queued row has been attempted with no further administrator action required.

A new-year record submitted before rollover is still accepted into its section's response tab. It remains `SYNC REQUIRED` and cannot be counted as tracker-synchronized until the administrator opens that year. This avoids writing a future cycle's result into the current tracker.

The dashboard obtains its year choices dynamically from stored maintenance years. Historical results continue to be available after the visible PMS tracker has moved to a later year, and every closed year's archived tracker snapshot remains readable from the dashboard's rollover panel until it is deliberately purged (§9B).

### 9.9 Capacity and performance outlook

At the current eligible population of 1,233 assets, full three-cycle coverage produces approximately 3,699 completed asset-cycle records per year before drafts and reinspections. With the implemented 70-column Service Desk schema and 62-column Infra schema, that is about 256,050 cells per year, plus findings-ticket and ticket-history rows.

The reviewed workbook currently allocates approximately 2.57 million grid cells. Google Sheets supports up to 10 million cells per spreadsheet. At the current asset volume, raw storage is sufficient for many years, although practical performance must be managed well before the hard limit; the administrator-only **Year Purge** tool (§9B) exists specifically to retire a closed year's data, with an enforced downloadable backup, once it is no longer needed live in the workbook. See [Google Drive file limits](https://support.google.com/drive/answer/37603).

Scalability requirements:

- never scan the entire workbook or call `getDataRange()` during an interactive request;
- read only the selected year, cycle, section, and required columns;
- batch-import the launch baseline and reuse one record read for dashboard metrics plus recent activity;
- cache large section asset lists in integrity-checked chunks below Cache Service per-key limits;
- monitor workbook cell count, Apps Script latency, failures, and quotas;
- issue an administrator capacity warning as the spreadsheet approaches its cell limit;
- provide an administrator-controlled, audited archive/delete process for closed years (§9B).

Apps Script currently limits an individual execution to six minutes, so rollover, reconciliation, and archive work use bounded batches with resumable checkpoints rather than one unbounded job. See [Apps Script quotas and limits](https://developers.google.com/apps-script/guides/services/quotas).

## 9A. Findings tickets and repair tracking

A maintenance record captures what was found at a point in time. A finding that needs fixing outlives that moment: it is worked on by whoever is available, possibly across more than one visit, and needs a defensible history of who changed what and why. The findings-ticket system exists to carry a finding from "discovered" to "actually fixed," separately from the maintenance record that first raised it.

### 9A.1 When a ticket is required, and when it is optional

A record cannot be finalized as `COMPLETED` if its assessment result is `Follow-up required` or `PMS not performed` and no ticket yet exists for that record. A ticket may optionally also be filed for a `Findings resolved` result, to keep a record of a repair that was already completed. A ticket is never required, and never automatically created, for a `No findings` result.

A ticket can be filed two ways: from inside the questionnaire's assessment step, in a guided panel that pre-fills the finding and required action from what the technician just wrote (this is the normal path, and the one that satisfies the completion requirement in the same action), or independently against any asset at any time — including standalone, with no linked record at all — from the Findings dashboard.

### 9A.2 Ticket status and its effect on the tracker

A ticket is always in exactly one of three states: **In Progress**, **Deferred**, or **Closed**. A ticket tied to a `PMS not performed` assessment starts life Deferred (nothing was actually done to the asset, so nothing is "in progress" yet); every other new ticket starts In Progress. Any registered user may move any ticket between any of these states and must supply a short remark explaining the change — this is deliberately not restricted to the filer, the asset's home section, or an administrator, because fixing an asset is cross-team work and accountability comes from the permanent, append-only change history rather than from restricting who can act.

A ticket's current status drives what the asset's tracker cycle-status cell shows, replacing the plain `COMPLETED` text an unremarkable maintenance visit would otherwise leave:

| Ticket status | Tracker cell shows |
| --- | --- |
| In Progress | `IN PROGRESS` |
| Deferred | `DEFERRED` |
| Closed | `COMPLETED` |

If more than one ticket is open against the same record, the most urgent status wins for what the cell shows. This mapping runs automatically every time a ticket changes, and is recomputed from ticket state on every change rather than depending on a client to keep the cell in sync — so a stuck cell self-heals the next time anything about the ticket changes.

### 9A.3 History and every ticket field

Every ticket carries: a sequential ticket ID, current status, the affected asset tag and IT section, its location, a short summary, the finding, the action required, an optional link back to the maintenance record that raised it, the cycle and year it belongs to, who filed it and when, who last touched it and when, and a running change count. A separate, strictly append-only log records every single change to a ticket forever — who, when, what the status moved from and to (or that it was only a progress note), and the mandatory remark — so nothing about a ticket's history can be edited or deleted after the fact. Every rostered user, regardless of section, can see every ticket; this is a deliberate choice, since diagnosing and repairing an asset is cross-team work.

### 9A.4 Where tickets are visible

- A **Findings** dashboard button, badged with the count of tickets still needing attention, opens the full ticket list — filterable by status, section, and free text, sortable, and pageable.
- The questionnaire's asset-selection step shows any ticket already open against the selected asset before the technician starts their assessment, so a known pre-existing fault isn't discovered twice.
- The Completed Assets archive shows a clickable status chip for every ticket ever raised against an asset directly on its record, and offers a **File ticket** action on any record whose assessment wasn't clean.
- The **Deferred Assets** view (§10.4) surfaces, specifically, the completed assets whose findings ticket is currently Deferred.
- The Manage Assets screen's PMS-status column reflects the same tracker cell this system drives.

## 9B. Administrator data-lifecycle tools

Three administrator-only operations exist for managing the workbook's size and long-term history, each with a distinct blast radius. All three require a dry-run/preview step, an explicit typed confirmation phrase, and run under the script lock.

### 9B.1 Annual rollover (see §9.8)

Advances the operational tracker to a new year, resetting only the current year's T1–T3 status/remarks columns after archiving an exact snapshot of the closing year. `PMS Records` and `PMS Records - Infra & Security` are never touched. Confirmed by typing `START <year>`.

### 9B.2 Year Purge

Permanently deletes one specific, already-closed year's data — its maintenance records in both response tabs, its findings tickets and their full change history, and its archived tracker snapshot sheet — to reclaim space once that year is no longer needed live in the workbook. The currently open tracker year can never be selected, and any year with an unresolved (still-open) findings ticket cannot be purged until that ticket is closed. A downloadable ZIP backup (one CSV per affected sheet) is mandatory and enforced by the server before deletion is even possible — there is no path to delete a year's data without first having generated its backup. Confirmed by typing `DELETE <year>`. A permanent `YEAR_PURGED` audit event, deliberately stamped with the *current* live year rather than the purged one, is written so the audit trail of a purge can never itself become the target of a later purge.

### 9B.3 Reset

Clears all maintenance records, findings tickets, and ticket history, for every year at once, plus every tracker cycle cell — intended for clearing pilot or test data before a real rollout, not for closing a year. Unlike rollover and purge, it has no eligibility precondition and can be run at any time. It deliberately does not touch the user roster, the notification recipient list, the asset master itself, or any sheet's formatting/dropdowns/filters — only the data that a pilot would have generated. Confirmed by typing the fixed word `RESET`.

## 10. Dashboard requirements

### 10.1 Technician dashboard

- Current maintenance year and PMS cycle, including the cycle deadline and days remaining.
- Eligible `INPROD` assets.
- Completed unique assets.
- Deferred assets (§10.4) — tracked separately from Pending.
- Pending assets.
- Compliance percentage.
- Assets with findings.
- Follow-up required.
- PMS not performed.
- "My completed this cycle."
- Overall progress bar toward 100%.
- Completion by location.
- Recent submissions table with record ID, date performed, asset, result, and status.
- Header action row: Manage Users and Manage Assets (visible only to those with the corresponding permission), Legacy Import, Deferred Assets, Findings, Completed Assets, My Drafts, and a primary **New PMS** action that opens the questionnaire modal.

### 10.2 Administrator dashboard

- All technician metrics.
- Section selector: all, Service Desk, Infrastructure & Security.
- Filters for year, PMS cycle, location, technician, result, and completion source.
- Year options are discovered from stored cycle IDs and are never hardcoded.
- Comparison of section compliance.
- Pending assets by location.
- Findings and follow-up queue.
- Data-quality indicators: blank master locations, unverified peripheral tags, unknown Infra tag prefixes, and rejected/stale submissions.
- The Rollover, Year Purge, and Reset panels (§9B), visible only to an administrator.

### 10.3 Metric definitions

| Metric | Definition |
| --- | --- |
| Eligible | Unique current `INPROD` asset tags in scope |
| Completed | Unique eligible asset tags with a completed new record or eligible legacy flag for the selected year/cycle, whose findings ticket (if any) is not currently Deferred |
| Deferred | Unique assets with a completed record whose linked findings ticket is currently Deferred |
| Pending | `max(Eligible - Completed - Deferred, 0)` |
| Compliance % | `Completed / Eligible × 100`; show N/A if Eligible is zero |
| With findings | Unique assets whose latest completed record is not `No findings` |
| Follow-up required | Unique assets whose latest completed record result is `Follow-up required` |
| Overdue | Pending assets after the selected cycle deadline |

Metrics must never count submissions, rows, or repeat inspections as extra completed assets.

### 10.4 Deferred Assets

A dedicated, read-only view — reusing data the dashboard has already loaded, so opening it costs no extra server call — listing every completed asset in the current dashboard scope whose findings ticket is currently Deferred: asset tag, location, IT section (administrators only), the reason (drawn from the record's own findings text), and a direct link into that ticket. This answers "which of this cycle's otherwise-completed assets still secretly need a revisit" and is distinct from filtering the full ticket list by status, which is asset/cycle-agnostic and shows every deferred ticket ever filed, from any cycle.

## 11. New response storage

The approved response tabs are `PMS Records` for Service Desk and `PMS Records - Infra & Security` for Infrastructure & Security, plus `PMS Tickets` and `PMS Ticket Log` for the findings-ticket workflow, `PMS Users` for the access roster, and `PMS Notification Recipients` for email opt-ins. They have separate schemas because the questionnaires and workflows are materially different. A saved incomplete record is updated in its original section tab by its server-issued record ID until completion; a later reinspection receives a new record ID. Dashboard, archive, duplicate detection, and reconciliation reads aggregate both record tabs without weakening section authorization.

Existing asset-master columns remain read-only from the ordinary technician workflow, and the only normal runtime writes to an existing tracker tab are the matched cycle status and paired remarks cell described in §9.4 (plus the explicit administrator rollover of D2 and D:I, and the explicit administrator Year Purge/Reset operations, all in §9B). Asset status and location *are* directly editable through the Manage Assets screen (§11.3), which is a deliberate, authorized exception with its own permission model.

The 70-column Service Desk schema contains:

1. Audit: record ID, submission timestamp, idempotency key, record type, schema version.
2. Identity: technician name, technician email, registered section.
3. Cycle: maintenance date, maintenance year, cycle, immutable cycle ID, and cycle deadline.
4. Asset snapshot: source tab, source row, asset tag, status, master location, observed location, location discrepancy.
5. Peripherals: one column for each of the ten listed peripheral types; multiple tags serialized as a stable delimiter-separated value.
6. Checklist: one boolean/applicability field per checklist item, category counts, total completed, total applicable, completion percentage.
7. Assessment: result, asset findings, action taken, recommendation.
8. Tracker synchronization: target PMS tab/row/year/cycle, prior tracker-status value, prior remarks snapshot, sync timestamp, and sync error if any.
9. System: legacy completion used, duplicate/reinspection reference, data-quality flags, created-at and updated-at time zone.
10. **Final column:** `PMS Completion`, containing the system-generated progress indicator and decisive status.

The 62-column Infra schema contains the same audit, identity, cycle, asset snapshot, assessment, tracker synchronization, and system controls, plus `IT-IS Asset Type`, the four checklist fields, server-derived metadata for each of the two required evidence files (Drive file ID, file name, URL, MIME type, size, SHA-256 digest, upload timestamp, uploader), and the same final `PMS Completion` column with the section's own six-unit progress indicator.

Headers are created once and validated before any append, on every schema this product owns; an unrecognized header shape refuses to use the sheet rather than risk misaligned columns. Writes use locks, a unique record ID, an idempotency key, and a final server-side asset lookup to prevent duplicate or inconsistent rows.

### 11.1 Infrastructure evidence storage and security

- The browser selects only an evidence category and file. It cannot supply a destination folder, trusted metadata, uploader identity, section, or completion state.
- The server uploads each file to its fixed preconfigured Drive folder under the deploying owner's authority and does not change sharing settings or make evidence public. Access continues to follow the folder's existing Drive permissions.
- The manifest requires the full `https://www.googleapis.com/auth/drive` scope because the app writes to two fixed, pre-existing folders.
- Each evidence file is limited to 10 MiB. The server allows only a fixed set of document, image, archive, text, and configuration extensions/MIME types; it separately content-sniffs the first bytes of every upload — regardless of declared extension or MIME type — to reject Windows/ELF/Mach-O/WASM executables, a shebang script header, and embedded HTML/script/SVG markers.
- File names are never taken from the browser; the server generates a sanitized name from the record, asset, cycle, evidence kind, and timestamp. The server derives the Drive metadata and SHA-256 digest, then signs a descriptor bound to the record ID, idempotency key, technician, section, asset type, asset tag, maintenance date, cycle, evidence kind, and required folder, using a constant-time signature comparison.
- Evidence metadata is committed to the draft immediately after upload so a reload can recover it. Completion and tracker reconciliation re-open the Drive file and verify that it is not trashed, remains in the required folder, and still matches its signed name, URL, MIME type, size, and SHA-256 digest — a file that fails any of these checks blocks completion outright rather than finalizing with stale evidence.
- A technician can upload only to their own incomplete Infra record. Evidence for a completed record can never be replaced through the app (§7B).

### 11.2 Registration storage decision

Registration profiles are stored in the dedicated `PMS Users` tab, one row per normalized YDC email. It contains the saved display name, IT section, computed role, Asset Manager grant, active state, and audit timestamps. The tab doubles as the access roster: presence of an email is what authorizes sign-in. Role and administrator status are always computed at read time — administrator status from the configuration allowlist, role from administrator status plus the Asset Manager grant — never independently stored as an editable truth (§5.4).

The server-hashed Google temporary user key may bind a returning technician to one previously registered, active profile when `ActiveUser` is temporarily blank. It is never accepted from the browser and cannot authorize registration or administrator functions. A live `ActiveUser` email is required for administrator access.

### 11.3 In-app Manage Assets screen

Every registered user can view the asset master for their own section — asset tag, status, location, and the current cycle's PMS status at a glance — without opening the underlying spreadsheet. Adding a new asset, editing an existing asset's status or location, or running a bulk CSV update (download the current list, edit it in a spreadsheet application, re-upload — matched by exact tag, nothing existing is ever silently removed) is restricted to an Asset Manager or an administrator (§5.2); those without the permission see the same list with the write actions hidden. An administrator additionally sees a section switcher; anyone else only ever sees their own section, since there is nothing else for them to choose.

### 11.4 In-app Manage Users screen

Administrator-only. Lists every roster row with its section, computed role, and active status; lets an administrator add a bare email (identical to a manual roster row, so a new hire can self-register without a spreadsheet edit) and edit an existing user's section, role (Technician or Asset Manager), and active status, all in one save. As established in §5.4, administrator status itself is structurally never editable here. An administrator cannot deactivate their own account through this screen, to prevent an accidental lockout with no other administrator available.

## 9C. Cycle-deadline email reminder

Once a day, an unattended time-based trigger checks how many days remain until the current cycle's deadline. While more than a configured threshold (50 days) remain, nothing is sent. From 50 days out through the deadline day itself, every active, registered user — pulled directly from the live roster, not a separately curated list, so nobody who still has PMS work outstanding can be missed by an out-of-sync distribution list — receives one email stating the number of days left, visually emphasized, and a reminder to complete PMS on every asset in their section before the deadline. The reminder stops once the cycle actually closes. An administrator can force-send the real content immediately, bypassing the day-count window, to check wording and delivery without waiting for a cycle to actually be closing.

## 9D. Other email notifications

Two further notification types share the same recipient-and-delivery infrastructure, opted into per recipient through a managed `PMS Notification Recipients` sheet (email, name, section scope, active flag, and one opt-in switch per notification family) rather than the live roster used by §9C, since these are event-driven updates a recipient chooses to be copied on rather than a reminder aimed at everyone with outstanding work:

- **PMS completed** — sent when a record finishes, to whoever opted into that section's completions. The subject and headline follow the tracker outcome (`Completed`, `For Fixing`, `In Progress`, `Deferred`), not always "Completed," so a still-outstanding repair doesn't read as fully resolved in an inbox scan. The full assessment and, for Service Desk, the itemized checklist are included.
- **Findings ticket events** — sent on every ticket filing, status change, and progress note, to whoever opted into that section's ticket updates (or all sections). The email states the transition, the remark, and the resulting tracker status.

A master switch can disable all outbound notifications app-wide without emptying the recipient list. Every notification is best-effort: a failed or skipped send is logged and never blocks or fails the operation that triggered it, and mail is always sent after the operation's own lock is released so a slow send cannot make concurrent writes queue behind it.

## 12. UX and visual design

- Minimalist SaaS layout with a neutral background, one accent color, compact cards, generous spacing, and clear type hierarchy.
- Fully responsive desktop and mobile layout: every dashboard modal collapses filters/sort controls behind a toggle on narrow screens so a short results list is never buried below them, background scroll is locked correctly behind an open modal on touch devices, and buttons are sized and stacked appropriately per breakpoint rather than sharing one desktop-sized layout.
- Persistent top bar showing user, section, current cycle, and sign-in state.
- Dashboard first; questionnaire appears as a large modal on desktop and a full-screen sheet on mobile.
- Stepper and overall progress remain visible while scrolling.
- **Save progress** persists an incomplete record without synchronizing the tracker; closing a dirty modal still requires confirmation.
- A clearly styled, dedicated notice at the top of the questionnaire whenever a record is being viewed read-only (§7B), naming whose record it is.
- Clear loading, empty, success, warning, and error states.
- Keyboard-operable combobox, checkboxes, modal focus trap, visible focus states, sufficient contrast, and semantic labels.
- No color-only status communication — every status chip carries a text label, not only a color.

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
- Administrator status is configuration-only and cannot be granted through any in-app screen (§5.4).

### Reliability

- Lock concurrent writes.
- Idempotent submission retries, including natural-key duplicate-draft adoption (§7A).
- Revalidate asset eligibility immediately before append.
- Revalidate required Infra evidence before completion and again before tracker synchronization.
- Return a stable record ID only after the row is confirmed.
- Log server errors with correlation IDs.
- Existing asset and dashboard tabs remain untouched if the new-record append fails.
- Every destructive administrator operation (§9B) requires an explicit typed confirmation and, where data leaves the workbook permanently, an enforced downloadable backup first.

### Performance

- Load only the signed-in user's section asset list.
- Filter already-completed picker items against the year/cycle derived from the selected maintenance date.
- Cache read-only asset lists and summary metrics briefly, then invalidate after a successful submission or any administrative change.
- Search asset options locally after the scoped list is returned.
- Target initial dashboard load under three seconds on a normal corporate connection, subject to Apps Script cold starts; defer expensive administrator-only computations (rollover status, ticket badge counts) until after first paint.

### Time zone

The workbook remains on its existing time zone. The application logic and Apps Script manifest use `Asia/Manila`, making the business boundary for dates, trimester derivation, and the daily reminder trigger's fire time explicit.

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
- Duplicate submit caused by retry/double-click, page reload, or a second "new record" attempt against an asset with an existing open draft → adopted into the same draft or resolved by idempotency, never a second row (§7A).
- Prior completion for the same asset/cycle → reinspection; no double count.
- An assessment of `Follow-up required` or `PMS not performed` with no ticket yet filed → completion blocked with `TICKET_REQUIRED` until one is filed.
- An edit attempted against an already-completed record, by anyone → silently absorbed as a no-op response, but recorded in a best-effort audit event (§7B).
- Backdated record in the current tracker year → accepted and synchronized to its derived cycle.
- Backdated record older than the tracker year → accepted as historical `COMPLETED` with `HISTORICAL_NO_TRACKER_WRITE`; no wrong-year tracker status is changed.
- Record dated ahead of the tracker year → retained as `SYNC REQUIRED` until that tracker year is opened.
- Future maintenance date → rejected.
- No eligible assets → dashboard empty state, not an error.
- Partial checklist → may be saved as `INCOMPLETE`; no tracker status or remarks cell is changed.
- Infra asset type does not match a known tag prefix → reject; an asset type with no prefix mapping at all → allow with a data-quality flag.
- Missing, moved, trashed, changed, oversized, or unsafe Infra evidence → refuse completion and leave the tracker unchanged, at initial completion and again at any later reconciliation.
- Year Purge attempted on the currently open tracker year, or on a year with an unresolved ticket → blocked with `YEAR_PURGE_BLOCKED`.
- An administrator attempts to deactivate their own account via Manage Users → blocked, to prevent a lockout.

## 15. Acceptance criteria

1. A signed-in allowed-domain user on the `PMS Users` roster is identified without entering an email, a code, or any second factor.
2. A YDC user who is not on the roster is refused with a clear provisioning message and creates no profile row.
3. A first-time rostered user can register exactly one IT section.
4. A registered Service Desk user cannot retrieve or submit an Infrastructure & Security asset, and vice versa.
5. The asset combobox contains only nonblank tags whose current column-B status is `INPROD`.
6. Status and master location come from the authoritative PMS tab and cannot be edited directly from the questionnaire (though an Asset Manager or administrator may edit them from the Manage Assets screen, §11.3).
7. Maintenance date accepts valid past dates, rejects future dates, and derives the correct year/cycle at boundary dates.
8. Every listed peripheral field and checklist item is represented in the response schema.
9. An item is answered — ticked, or explicitly left unticked with a reason — for completion; below 100% answered saves as `INCOMPLETE`, while completion requires 100% of applicable items answered.
10. Assessment result, findings, action, and recommendation follow the stated conditional rules, and a result requiring a ticket cannot complete without one.
11. A saved draft creates or updates exactly one validated response row and sets the last column to an `INCOMPLETE` progress status, and appears in the owner's Drafts list.
12. Only a 100% valid record, with a findings ticket filed where required, can become `COMPLETED`.
13. Completion writes the full Findings, Action Taken, and Recommendation block to the correct cycle Remarks cell, preserving existing content.
14. Completion then sets the paired T1/T2/T3 status to `COMPLETED`, or to the mapped repair status of any open linked ticket, on the asset's exact section row.
15. A normal completion modifies no existing workbook cell other than that matched status and paired remarks cell; annual rollover, Year Purge, and Reset each require their own separate, explicit administrator confirmation (§9B).
16. A tracker synchronization failure cannot leave the response row marked `COMPLETED`.
17. Dashboard counts unique eligible assets rather than rows or total inventory, with Deferred tracked as its own bucket.
18. Repeat maintenance does not inflate compliance or duplicate the same remarks block.
19. Modal, searchable dropdown, and checklist are usable by keyboard and on mobile, including every dashboard list/filter modal.
20. The existing `Code.js` file remains unchanged.
21. A maintenance date of January 1 of a new year derives that year's T1 without a deployment or code change.
22. A new-year completion submitted before rollover is safely stored as `SYNC REQUIRED` and never changes the prior year's tracker.
23. The administrator rollover preserves prior-year history, archives an exact tracker snapshot, updates the tracker year, resets only D:I term cells, and reconciles waiting new-year records without further manual action for a batch within Apps Script's execution limits.
24. Repeating an already completed rollover is rejected and cannot clear the active year twice.
25. An Infrastructure & Security user receives the Infra form only, selects one of the six approved asset types, and can select only `INPROD` tags from `IT-IS PMS`; known prefixes must match the selected type and prefix-less types are flagged, not blocked.
26. An Infra draft is stored in `PMS Records - Infra & Security`; Service Desk records remain in `PMS Records`, and combined dashboards aggregate both without cross-section exposure.
27. Infra progress reaches 100% only at `6/6`: four required checks and two authenticated evidence files.
28. Each Infra evidence file is 10 MiB or smaller, passes the server allowlist/content-sniffing checks, is stored in its configured folder without an ACL change, and remains verifiable by signed metadata and SHA-256 before completion and at any later reconciliation.
29. Asset availability is evaluated for the cycle derived from the selected maintenance date, so a T1 completion does not hide an asset from T2 or T3.
30. `Session.getEffectiveUser()` is never used to identify a visitor. Temporary-key continuity cannot register or elevate a user, and administrator actions require a live `ActiveUser` email.
31. A completed record can never be edited again by anyone, including its own technician; any attempt is absorbed without error and recorded in an audit event.
32. A findings ticket's status change is visible in that ticket's permanent history with actor, timestamp, and a mandatory remark, and correctly updates the asset's tracker cell.
33. Year Purge cannot run against the open tracker year or a year with an unresolved ticket, and cannot execute without a backup token issued from a matching preview.
34. Manage Users can change a user's section, role, and active status, but cannot grant or revoke administrator status under any input.
35. The daily cycle-deadline reminder sends nothing outside its configured day-count window and reaches every active registered user once the window opens.

## 16. Implemented decisions

1. **Application storage:** `PMS Records` stores Service Desk history, `PMS Records - Infra & Security` stores Infra history and evidence metadata, `PMS Tickets`/`PMS Ticket Log` store the repair-tracking workflow, `PMS Users` stores persistent registration profiles, and `PMS Notification Recipients` stores event-email opt-ins; pre-existing workbook tabs remain otherwise unchanged.
2. **Full name source:** one-time user-confirmed display name, initially derived from email, with the validated Google-account email as the authoritative identity.
3. **Historical denominator:** live current-`INPROD` compliance; cycle-scope snapshots remain a later enhancement.
4. **Tracker-year mismatch:** complete archived past-year records in the appropriate section response tab without changing D:I; retain ahead-of-tracker records as `SYNC REQUIRED` until rollover. Never write to the wrong tracker year.
5. **Blank locations:** require observed location without changing the asset master.
6. **Peripheral validation:** capture normalized peripheral tags as technician-entered evidence; they are not used to determine main-asset eligibility.
7. **Legacy progress:** batch-import pre-existing tracker flags once, then use the response tabs as the sole completion authority.
8. **Annual rollover:** treat D:I as the current-year operational view, archive an exact snapshot of the closing year's tracker before resetting it, and preserve multi-year history in the response tabs. Year Purge and Reset are separate, narrower-scoped, more destructive tools with their own confirmation and (for Purge) mandatory backup.
9. **Infra completion:** require four section-specific checks plus two verified Drive evidence files (`6/6`) before synchronization, re-verified again at any later reconciliation.
10. **Asset picker scope:** apply existing T1/T2/T3 completion flags to the cycle and year derived from the technician's selected maintenance date.
11. **Identity continuity:** use only `ActiveUser` as live identity; a server-hashed temporary key may restore one active returning profile but can never register a user or authorize an administrator.
12. **Repair tracking:** a finding requiring follow-up must be tracked by a ticket before its record can complete; ticket status, not the maintenance record, drives the tracker's post-completion cycle-status text, and any rostered user may advance any ticket, with a mandatory audited remark on every change.
13. **Record permanence:** a completed record is locked forever, viewable read-only by any registered user, with edit attempts absorbed silently but logged.
14. **Delegated asset administration:** an Asset Manager grant, set only by an administrator, allows write access to the asset master through the app; view access to that same screen is open to every registered user for their own section.
15. **Delegated user administration:** an administrator can manage section, role, and active status for any user in-app; administrator status itself remains a configuration-only fact, never editable through any screen.
16. **Proactive reminders:** a daily, unattended, threshold-gated email reminder is in scope, sourced from the live roster rather than an opt-in list, specifically because it must reach everyone with outstanding work rather than only those who chose to be notified.
