# PMS Web App Deployment Runbook

## Created deployment

- Isolated Apps Script project: `1CcLoopM4WSkJFV7SlVOJ7QZkCdVOhLW6YeQxUatFXrLL9OAkXBTUNx3V`
- Current deployment: version 6, `AKfycbwLz_VBuTj_ats0vqlhQ_9VBMtfC_cLpwFDl7T07wrXa1Y0fQLeZQZcKNu0cF8PpWkrCA`
- Web app: `https://script.google.com/macros/s/AKfycbwLz_VBuTj_ats0vqlhQ_9VBMtfC_cLpwFDl7T07wrXa1Y0fQLeZQZcKNu0cF8PpWkrCA/exec`

HEAD replaces the email-code fallback with Google-account-only sign-in and needs a new versioned deployment plus one re-authorization, because the manifest now declares OAuth scopes explicitly. The `MailApp` scope is no longer requested, so "Send email as you" is no longer part of consent.

The endpoint has been verified to require Google sign-in. The isolated project intentionally contains no legacy `Code.js`, so its public `updateDropdown()` function is not exposed by this web app.

`PMS Users` must remain a normal cell range, not a native Google Sheets Table with typed columns. The app applies classic dropdown, checkbox, and text-format rules through `SpreadsheetApp`; typed table columns reject those cell-level operations. Version 6 also allocates new profiles from the first blank Email row so placeholder or manually formatted rows cannot force registrations to the bottom of the sheet.

## Sign-in model

A user is allowed in when all three are true:

1. they are signed in to a `@ydc.com.ph` Google account;
2. they can open the domain-restricted deployment;
3. their email exists as a row in the `PMS Users` sheet and is not explicitly marked `Active = FALSE`.

There is no verification code, one-time password, or second factor. Provisioning a technician means adding their email to `PMS Users`; leaving `Active` blank counts as active. The technician picks their IT section once on first sign-in.

Configured administrators in `PMS_ADMIN_EMAILS` are always allowed even when absent from the roster, so the owner cannot be locked out of an empty or damaged sheet.

To let any domain account self-register instead of requiring a roster row, set `REQUIRE_DIRECTORY_ENTRY: false` in `PmsConfig.js`.

## One-time owner setup

1. Open the Apps Script project as the intended deployment owner.
2. Run `PMS_setupDeployment` from the editor and approve the requested scopes. Consent must include **See your primary Google Account email address** — that is the `userinfo.email` scope that makes `Session.getActiveUser().getEmail()` return a value instead of an empty string. This guarded entry point writes the configured `@ydc.com.ph` deployment administrator to the private `PMS_ADMIN_EMAILS` Script Property, verifies `PMS Users`, migrates any legacy Script Property profiles, and reports identity diagnostics.
3. Deploy a **new version** of the web app that **executes as the deployment owner** and is accessible **only to users in the YDC Workspace organization**. A new version is required for the manifest scope change to take effect.
4. Open the deployment as the owner, confirm the display name, register the owner's actual IT section once, and confirm later visits open the dashboard without registration. The first authorized bootstrap creates the one-time legacy baseline in `PMS Records`; it does not change an existing tracker tab.

## Troubleshooting sign-in

Run `PMS_diagnoseSignIn` from the Apps Script editor. It changes no data and reports:

- `activeUserEmail` / `effectiveUserEmail` — what Google actually exposes. If `activeUserEmail` is empty for a domain user, the `userinfo.email` scope was not granted, or the running deployment predates the manifest change; re-authorize and deploy a new version.
- `onRoster` / `rosterActive` / `rosterSection` — whether the resolved email is provisioned in `PMS Users`.
- `isConfiguredAdmin` / `administrators` — the effective administrator allowlist.

Error codes surfaced to the browser map directly to a cause: `IDENTITY_UNAVAILABLE` (Google gave no email), `ACCESS_DENIED` (wrong domain), `ACCESS_NOT_PROVISIONED` (not on the roster), `ACCOUNT_DISABLED` (`Active = FALSE`).

## Required identity and authorization pilot

Test with at least two non-owner `@ydc.com.ph` accounts, one from each IT section:

- each account is added to `PMS Users` first, then signs in with no code prompt;
- each user can register a section only once and sees only that section's current `INPROD` assets;
- a YDC account that is not on the roster is refused with the provisioning message;
- manually changing a browser payload cannot select the other section or a non-`INPROD` asset;
- neither technician sees administrator rollover controls;
- the configured owner is the only administrator unless another email is explicitly added to the `PMS_ADMIN_EMAILS` Script Property.

## Controlled functional pilot

Use an approved pilot asset. Verify Save Progress creates one `INCOMPLETE` row and changes no tracker cell. Then complete all applicable checklist items and the assessment; verify the response becomes `COMPLETED`, the correct T1/T2/T3 remarks block is present, and only the paired checkbox is checked.

## Annual rollover

At the year boundary, the administrator uses **Start a new PMS year**. The dry run must succeed before confirmation. Rollover is blocked while any closing-year record is `SYNCING`, `SYNC FAILED`, or `SYNC REQUIRED`; use **Retry pending sync** and resolve permanent data errors first. The confirmed action writes year-close/year-open audit rows, updates D2, resets only D:I, verifies the reset, and resumes waiting new-year synchronization in bounded batches.

Never manually clear D:I before a successful dry run: `PMS Records` is the permanent multi-year history, while D:I is only the current-year operational projection.
