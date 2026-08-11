# PMS Web App Deployment Runbook

## Created deployment

- Isolated Apps Script project: `1CcLoopM4WSkJFV7SlVOJ7QZkCdVOhLW6YeQxUatFXrLL9OAkXBTUNx3V`
- Current deployment: version 6, `AKfycbwLz_VBuTj_ats0vqlhQ_9VBMtfC_cLpwFDl7T07wrXa1Y0fQLeZQZcKNu0cF8PpWkrCA`
- Web app: `https://script.google.com/macros/s/AKfycbwLz_VBuTj_ats0vqlhQ_9VBMtfC_cLpwFDl7T07wrXa1Y0fQLeZQZcKNu0cF8PpWkrCA/exec`

HEAD contains the verified-email fallback and is waiting for owner MailApp authorization plus the next versioned deployment. Version 6 does not yet include that fallback.

The endpoint has been verified to require Google sign-in. The isolated project intentionally contains no legacy `Code.js`, so its public `updateDropdown()` function is not exposed by this web app.

`PMS Users` must remain a normal cell range, not a native Google Sheets Table with typed columns. The app applies classic dropdown, checkbox, and text-format rules through `SpreadsheetApp`; typed table columns reject those cell-level operations. Version 6 also allocates new profiles from the first blank Email row so placeholder or manually formatted rows cannot force registrations to the bottom of the sheet.

## One-time owner setup

1. Open the Apps Script project as the intended deployment owner.
2. Run `PMS_setupDeployment` from the editor and approve every requested scope, including **Send email as you**. This guarded entry point writes the configured `@ydc.com.ph` deployment administrator to the private `PMS_ADMIN_EMAILS` Script Property, initializes the OTP secret, reports the remaining MailApp quota, verifies `PMS Users`, and migrates any legacy Script Property profiles.
3. Deploy a test web app that **executes as the deployment owner** and is accessible **only to users in the YDC Workspace organization**.
4. Open the deployment as the owner, confirm the display name, register the owner's actual IT section once, and confirm later visits open the dashboard without registration. The first authorized bootstrap creates the one-time legacy baseline in `PMS Records`; it does not change an existing tracker tab.

## Required identity and authorization pilot

Test with at least two non-owner `@ydc.com.ph` accounts, one from each IT section:

- when Google exposes the active visitor email, it is used directly;
- when Google returns a blank email, the user receives and verifies a six-digit code at the entered `@ydc.com.ph` mailbox;
- each user can register only once and sees only the registered section's current `INPROD` assets;
- manually changing a browser payload cannot select the other section or a non-`INPROD` asset;
- neither technician sees administrator rollover controls;
- the configured owner is the only administrator unless another email is explicitly added to the `PMS_ADMIN_EMAILS` Script Property.

The email-code fallback binds only the current server-derived temporary Google user key. Codes expire after ten minutes, are single-use, and do not grant administrator access. Returning users normally open the saved profile directly; Google rotates temporary keys periodically, so a user may need to verify the mailbox again without repeating section registration. Administrator actions still require a live Google email.

Current product policy allows any verified `@ydc.com.ph` mailbox that can open the domain deployment to self-register and choose one IT section. If access must be limited to an IT-only roster, add a pre-approved email/group check before wider rollout.

## Controlled functional pilot

Use an approved pilot asset. Verify Save Progress creates one `INCOMPLETE` row and changes no tracker cell. Then complete all applicable checklist items and the assessment; verify the response becomes `COMPLETED`, the correct T1/T2/T3 remarks block is present, and only the paired checkbox is checked.

## Annual rollover

At the year boundary, the administrator uses **Start a new PMS year**. The dry run must succeed before confirmation. Rollover is blocked while any closing-year record is `SYNCING`, `SYNC FAILED`, or `SYNC REQUIRED`; use **Retry pending sync** and resolve permanent data errors first. The confirmed action writes year-close/year-open audit rows, updates D2, resets only D:I, verifies the reset, and resumes waiting new-year synchronization in bounded batches.

Never manually clear D:I before a successful dry run: `PMS Records` is the permanent multi-year history, while D:I is only the current-year operational projection.
