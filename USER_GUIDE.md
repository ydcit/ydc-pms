# YDC Preventive Maintenance — User Guide

**Version:** 2.0
**Date:** 2026-08-22

This guide explains how to use the YDC Preventive Maintenance (PMS) web app. It's written for the people who use the app day to day — technicians, asset managers, and administrators — not for developers. If you're looking for technical detail instead, see `SOLUTION.md`; for the full list of rules the system enforces, see `PRD.md`.

## Contents

1. [Getting started](#1-getting-started)
2. [Your first sign-in](#2-your-first-sign-in)
3. [The dashboard](#3-the-dashboard)
4. [Completing a PMS record — Service Desk](#4-completing-a-pms-record--service-desk)
5. [Completing a PMS record — Infrastructure & Security](#5-completing-a-pms-record--infrastructure--security)
6. [Saving progress and resuming a draft](#6-saving-progress-and-resuming-a-draft)
7. [Viewing a completed record](#7-viewing-a-completed-record)
8. [Findings tickets — tracking a repair](#8-findings-tickets--tracking-a-repair)
9. [Deferred assets](#9-deferred-assets)
10. [Manage Assets (Asset Managers and administrators)](#10-manage-assets-asset-managers-and-administrators)
11. [Manage Users (administrators)](#11-manage-users-administrators)
12. [Legacy Import — backfilling old PMS work](#12-legacy-import--backfilling-old-pms-work)
13. [Administrator tools: Rollover, Year Purge, Reset](#13-administrator-tools-rollover-year-purge-reset)
14. [Email notifications](#14-email-notifications)
15. [Troubleshooting](#15-troubleshooting)

---

## 1. Getting started

You'll need:

- A YDC Google account (`@ydc.com.ph`).
- The PMS web app link, provided by your IT administrator.

Open the link in any browser, on a desktop or a phone. If you're not already signed in to your YDC Google account, your browser will ask you to sign in first.

If you see a message saying your account isn't recognized, it means an administrator hasn't added you to the system yet — ask them to add your email, then try again.

## 2. Your first sign-in

The first time you open the app, you'll be asked to:

1. Confirm your display name (pre-filled from your email — correct it if it's wrong).
2. Choose your IT section: **Service Desk** or **Infrastructure & Security**.

Choose carefully — once you register a section, you can't change it yourself. If you picked the wrong one, ask an administrator to correct it (§11).

After this, you'll go straight to your dashboard every time you sign in.

## 3. The dashboard

Your dashboard shows:

- Your current PMS cycle (T1, T2, or T3) and how many days remain until its deadline.
- How many assets in your section are eligible, completed, deferred, and pending this cycle.
- Your overall progress toward 100% compliance.
- A row of buttons across the top for everything else you can do.

The buttons you see depend on your role. Everyone sees **Findings**, **Deferred Assets**, **Completed Assets**, **My Drafts**, and **New PMS**. **Manage Assets** and **Manage Users** only appear if you have that permission (§10, §11). **Legacy Import** is available to everyone.

## 4. Completing a PMS record — Service Desk

1. Click **New PMS** on your dashboard.
2. **Step 1 — Asset and date:** Pick the date you actually performed the maintenance (not necessarily today). Then search for and select the asset tag — only assets currently in production, in your section, appear in the list. If the location shown looks wrong, or is blank, you'll be asked to enter what you actually observed.
   - If the asset already has an open findings ticket from an earlier visit, you'll see it here before you continue — it's worth reading before you start your inspection.
   - If you already have an unfinished record for this asset this cycle, the app will tell you and point you to **My Drafts** (§6) instead of letting you start over.
3. **Step 2 — Peripherals:** Record the tag of any peripheral attached to the asset (monitor, keyboard, UPS, etc.) — all optional, and you can add more than one tag per type if there's more than one attached.
4. **Step 3 — Checklist:** Go through each item in every category (hardware, system health, security, network, applications, cleaning). For each one, either tick it done or leave it unticked and give a short reason (or mark it "not applicable" where that option is offered). You need to address every item — ticked or explained — to reach 100%.
5. **Step 4 — Assessment:** Choose the overall result:
   - **No findings** — nothing wrong. Write "No findings" in the findings box.
   - **Findings resolved** — you found something and already fixed it during this visit.
   - **Follow-up required** — you found something that needs more work later.
   - **PMS not performed** — you weren't actually able to do the maintenance (asset unavailable, access denied, etc.).
   - If you choose **Follow-up required** or **PMS not performed**, you'll be prompted to file a findings ticket right there before you can finish (§8) — the app pre-fills it from what you just wrote.
6. Review the summary, then click **Complete PMS**. You'll get a record ID — that's your confirmation the record is saved and locked in.

If you're not ready to finish, click **Save progress** instead at any point — see §6.

## 5. Completing a PMS record — Infrastructure & Security

The Infra & Security form works the same way, with these differences:

1. **Step 1** additionally asks for the **asset type** (Switch, Firewall, Access Point, OMADA Controller, Server, or FortiAnalyzer) before you pick the asset tag.
2. **Step 3 — Checklist** has only four items (power cables, data cables, power supply/UPS, firmware up to date) — but you must also **upload two evidence files**:
   - **Latest Firmware Version Evidence** — proof of the current firmware version.
   - **Configurations / Backup / Checkpoints Evidence** — proof of a current config backup.
   - Each file must be under 10 MB, and it needs to be a real document/image/config file — the system will reject anything that looks like an executable, script, or webpage disguised as a document.
   - Your progress is shown as a fraction out of 6 (4 checklist items + 2 evidence files), not a percentage of 20 like Service Desk.
   - If you save a draft and come back later, evidence you already uploaded is still there — you don't need to re-upload it.
3. Once you complete an Infra record, **the evidence is locked too** — you can't swap it out afterward, even if you realize you uploaded the wrong file. If that happens, contact an administrator.

## 6. Saving progress and resuming a draft

You don't have to finish a record in one sitting.

- Click **Save progress** at any point below 100% completion. Nothing is sent to the tracker sheet yet — it's just saved for you to come back to.
- Find it again under **My Drafts** on your dashboard. Each draft shows the asset, cycle, and how far along it is.
- Click a draft to pick up exactly where you left off, including any Infra evidence you already uploaded.

You don't need to worry about accidentally creating a second draft for the same asset — the app will warn you and point you to the existing one instead.

## 7. Viewing a completed record

Once a record is marked **Complete**, it's locked forever — nobody can go back and change it, including the person who submitted it. You can still look at it:

1. Open **Completed Assets** from your dashboard.
2. Find the record (search by asset tag, or filter/sort by cycle, date, etc.).
3. Click it to open it. You'll see a clear notice at the top telling you it's read-only and whose record it is — this works even if it isn't your own record, so you (or anyone) can review a colleague's completed work.

If you spot a mistake on a completed record, you can't correct it in the app — the system is designed that way on purpose, so the record stays trustworthy. Talk to an administrator about how to handle it.

## 8. Findings tickets — tracking a repair

A findings ticket exists because "I found a problem" and "the problem is actually fixed" are two different things, and the second one can take days or weeks and involve someone else entirely.

**Filing a ticket:**

- The easiest way is from inside a PMS record's assessment step (§4, §5) — if your result requires it, the app walks you through filing it using what you already wrote.
- You can also file one directly from the **Findings** dashboard button, or from an already-completed record in **Completed Assets** (look for a "File ticket" button), for anything that doesn't already have one.

**Working a ticket:**

- Open **Findings** from your dashboard to see every ticket — yours and everyone else's, in any section. This is deliberate: fixing something is often a team effort, and anyone might be the one who ends up doing the repair.
- Use the tabs to filter by status: **Needs attention**, **In progress**, **Deferred**, **Closed**, or **All**.
- Open a ticket to see the full finding, what action is needed, and its complete history.
- To move it along, pick a new status (or leave the status as-is to just add a progress note) and write a short remark explaining what you did. A remark is required every time — that's what makes the history useful later.

**What the statuses mean:**

| Status | Meaning |
| --- | --- |
| In Progress | Someone's actively working on it |
| Deferred | Nothing could be done yet (usually because the asset wasn't accessible at all) |
| Closed | Fixed |

A ticket's status also shows up on the asset's tracker cell for that cycle, so anyone glancing at the tracker sheet (or the Manage Assets screen's PMS status column) can see at a glance whether an asset that looks "done" actually still has open work.

## 9. Deferred assets

Sometimes a completed record's finding is still open — the maintenance visit happened, but the follow-up ticket hasn't closed yet. These show up separately from your regular "pending" count, in **Deferred Assets**:

1. Click **Deferred Assets** on your dashboard.
2. You'll see each asset, its location, the reason it's deferred, and a link straight into its ticket.

An asset drops off this list automatically once its ticket moves out of "Deferred" — you don't need to do anything else to clear it.

## 10. Manage Assets (Asset Managers and administrators)

Everyone can **view** the asset list for their own section without opening the spreadsheet:

1. Click **Manage Assets**.
2. Search or browse the list — asset tag, status, location, and this cycle's PMS status (a color-coded chip) are all shown.

If you've been given the **Asset Manager** permission (or you're an administrator), you can also:

- **Add asset** — enter a tag, status, and location directly.
- **Edit** — click Edit on any row to change its status or location.
- **Bulk upload** — download the current list as a CSV, edit it in Excel or Sheets (change statuses/locations, add new rows at the bottom for new assets), then upload the same file. Existing assets are matched by their exact tag; nothing already on the list is ever removed by an upload — you'd need to do that separately.

If you don't have this permission, the Add/Edit/Bulk upload buttons simply won't appear — ask an administrator to grant it if you need it (§11).

## 11. Manage Users (administrators)

Administrator-only. This is where you handle day-to-day roster changes without touching the spreadsheet directly.

1. Click **Manage Users**.
2. You'll see every registered user, their section, role, and whether they're active.

**Adding a new user:** Click **Add user** and enter their `@ydc.com.ph` email. This is the same as adding a bare row to the roster by hand — the new person can now sign in and register their own section themselves.

**Editing an existing user:** Click **Edit** on their row. You can change:
- **IT section** — Service Desk or Infrastructure & Security.
- **Role** — Technician or Asset Manager (§10). If the person is already an administrator, this shows as read-only, since an administrator already has every permission Asset Manager grants.
- **Active** — uncheck this to block someone's sign-in without deleting anything they've ever done. You can't deactivate your own account this way, on purpose, so you can't accidentally lock yourself out.

Note: **you cannot grant or remove administrator access from this screen, for anyone, including yourself.** That's deliberate — it's the one thing this screen is not allowed to touch. If you need to add another administrator, that has to be done outside the app.

## 12. Legacy Import — backfilling old PMS work

If maintenance genuinely happened before this system existed (or before someone got around to logging it), you can backfill it instead of it being lost from the compliance record.

1. Click **Legacy Import**.
2. **Prepare:** Choose your section, a date (or upload a CSV/TXT file with a tag in the first column and, optionally, that specific tag's own date in a second column), and paste or upload the list of asset tags.
3. **Review:** The system checks every tag and shows you what's ready, what's already completed, what's a duplicate, and what's invalid (with a reason) — nothing is written yet. Read the exception counts before continuing.
4. Tick the confirmation box and type the exact phrase shown (something like `IMPORT 42`) to confirm.
5. **Results:** The import runs and shows you what happened to each tag.

As a regular technician, you can only import into your own section and the currently open year. Administrators can import into any section and into a past (already-closed) year too — useful for catching up records that predate the system by more than one cycle.

Imported records are clearly marked as legacy in the record itself, and don't count as "your" completed work — they're attributed to the import, not to whoever ran it.

## 13. Administrator tools: Rollover, Year Purge, Reset

These live at the bottom of the dashboard and only appear for administrators. They're powerful and each has its own safety checks — read the on-screen summary carefully before confirming any of them.

### Rollover — starting a new PMS year

Use this once, at the start of a new year, to move the operational tracker forward.

1. Click **Run safety check** to see a dry-run report — nothing is changed yet.
2. Review it. If any records from the closing year still need to finish syncing, resolve those first (there's a "Retry pending sync" button for that).
3. Type `START <year>` (e.g. `START 2027`) and click **Start new PMS year**.

What happens: the closing year's tracker is saved as a permanent snapshot sheet, the live tracker is reset for the new year, and every past record stays exactly where it is — rollover never deletes history.

### Year Purge — permanently deleting a closed year

Use this only when a specific old year's data is no longer needed live in the workbook, to keep it fast and manageable. **This permanently deletes data** — records, tickets, and that year's archived tracker snapshot.

1. Pick the year and click to preview what would be deleted.
2. Click **Download backup first** — this is required; you can't proceed without it. Keep the downloaded file somewhere safe.
3. Tick the confirmation box, type `DELETE <year>` exactly, and confirm.

You cannot purge the currently open year, and you cannot purge a year that still has an unresolved findings ticket — close it first.

### Reset — clearing test/pilot data

Use this only to wipe out test or pilot data before a real rollout — **not** for closing a year (use Rollover for that). It clears every maintenance record, ticket, and tracker cell, for every year at once, but keeps your users, your asset list, your email recipients, and all your sheet formatting exactly as they are.

1. Click to preview what would be cleared.
2. Tick the confirmation box, type `RESET`, and confirm.

## 14. Email notifications

You don't need to do anything to receive these — an administrator manages who's on the list.

- **Cycle deadline reminder** — once a day, once your cycle's deadline is within about 50 days, every active user gets an email stating how many days are left and a reminder to finish PMS on every asset in their section.
- **PMS completed / ticket update emails** — sent to whoever an administrator has opted in on the notification recipients list, whenever a record completes or a ticket changes.

If you're not receiving an email you think you should be, or you're getting ones you don't need, ask an administrator to check the recipients list.

## 15. Troubleshooting

**"Your account is not on the PMS access list."**
An administrator hasn't added your email yet. Ask them to add you (§11), then reload the page.

**"Your PMS account is inactive."**
An administrator has deactivated your account. Ask them to reactivate it if this is unexpected.

**I can't find a draft I know I started.**
Check **My Drafts** — it only shows your own unfinished records. If it's genuinely gone, ask an administrator to check for you.

**I made a mistake on a record I already completed.**
You can't fix it yourself — completed records are permanently locked, on purpose. Tell an administrator what's wrong and how it should read; they'll decide how to handle it.

**The evidence upload for Infra & Security keeps failing.**
Check the file is under 10 MB and is an actual document, image, or config/backup file — not a webpage, a script, or an executable, even if it has a document-looking name. If it still fails, try a different file format or contact an administrator.

**I don't see the Manage Assets or Manage Users button.**
Manage Assets only appears if it's relevant to your section; the Add/Edit/Bulk-upload actions inside it only appear if you've been given the Asset Manager role. Manage Users only appears for administrators. Ask an administrator if you believe you should have access.

**The page looks broken on my phone.**
Make sure you're on a reasonably current version of your phone's browser. If a specific screen still looks wrong, tell an administrator which screen and what device/browser you're using.
