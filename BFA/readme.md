# UBC Finance — Progressive Web App (PWA) — Version 1.3

Redesigned version of the same app (Income, Expenditure, Bank A/C, Bank Account, Notes,
Remittances, Dues calculator, Bank Transactions, Reports) — dark purple/gold theme
pulled from your church logo, a 3D spinning globe logo, a 4-digit PIN lock, editable
item lists, live backup-as-you-work, cross-device Sync, and PDF + Word report exports.
Fully offline once opened the first time — no folder structure to preserve, just these
flat files.

Your existing records (148 income entries, 148 expenditure entries) are still built in
and load automatically the first time you open it, on a device with no saved data yet.

## What's new in this version

- **Version 1.3 — Report preview.** Every report (Financial Report and Bank Account Report) now has a
  **Preview & Print** button that opens a white "paper" view of the report, laid out like the PDF,
  before anything is printed or saved. Print, PDF and Word buttons sit inside the preview; the phone's
  Back button closes it. Printing from the preview prints only that sheet. (This also fixes the Bank
  Account Report's old print button, which printed the wrong tab.)
- **Version 1.2 — bug-fix pass** — PIN and password unchanged.
  - Restore from backup now sticks when Sync is on: records not in the backup are deleted
    properly (tombstones) and restored records win over older copies on other devices.
  - Remittance backfill can no longer bring back a month someone unmarked when a new device joins.
  - Income/Expenditure search box keeps focus while typing.
  - A background sync no longer wipes a half-typed entry (form values, focus and scroll are kept).
  - Month filters fall back to "All months" when the filtered month has no entries left.
  - PDF reports: em dashes and accented characters print correctly; long remittance lines wrap.
  - Bank A/C: editing an entry from Income to Expenditure no longer keeps the old category.
  - Clock-skew protection: edits/deletes are stamped using the sync server's clock. **Redeploy
    `backend/worker.js` (it now returns `serverTime`) to turn this on**; the app still works
    with the old Worker, just without this protection.

- **Sync backend switched from Google Apps Script to a Cloudflare Worker** — same
  cross-device sync behavior as before (real per-record merge, automatic background
  polling, retry-on-failure), just running on a free Cloudflare Worker + KV namespace
  instead of a Google Sheet. See "Sync — one-time setup" below for what changed and
  how to deploy it. **Nothing is pre-connected in this build** — unlike the previous
  Google-based version, there's no default URL baked in, since a Cloudflare Worker has
  to be deployed under your own free Cloudflare account first; paste the URL into the
  Sync tab once that's done.

- **New "Bank Account" tab** — a full second ledger, separate from Bank A/C: its own
  Income dropdown (Offering, Tithe, Donation, Seed Offering, Cash Banked, Others —
  free text) and Expenditure dropdown (Stipend, Association Due, Conference Due,
  Convention Due, Pension, Pastor's Children Education Support, Others), running
  Income/Expenditure/Balance totals, and its own full Print/PDF/Word report section
  (labeled "Bank Account Report" so it's never confused with the Cash reports).
  Deliberately kept fully separate from the Remittances checklist, per your call — an
  expenditure entry here does not auto-mark anything there. Synced, backed up, and
  CSV-exportable the same as every other tab. Verified with an automated test
  confirming the report's totals and category grouping come out exactly right and
  both the PDF and Word files actually build successfully.
- **"Bank Log" renamed to "Bank Transactions"** throughout the app (nav label, Backup
  tab text, CSV filename).
- **Faster sync** — background poll every 9s.
- **Edit Protection can now be turned on/off** — a new switch (Backup tab) toggles
  whether the password is required at all for Add/Edit/Delete. Turning it off (or
  back on) itself requires the current password, so the switch can't be used to get
  around the protection. Verified with an automated test: wrong password blocks an
  action while ON, the switch only flips with the correct password, and once OFF no
  password is asked at all.

- **Remittances: open-ended year navigation** — the year picker is now a free-typed
  number with ‹/› buttons instead of a fixed 2023–2027 dropdown, so it works for any
  year, indefinitely.
- **Remittances: Bulk Mark Paid** — a new card on the Remittances tab lets you mark a
  whole date range paid in one action (pick the item, a From month and To month) —
  useful for backfilling history instead of tapping month-by-month. One password
  confirms the whole range, not each month.
- **Historical remittances backfilled** — Association Due and Conference Due are now
  marked paid from October 2015 through May 2026, and Convention Due from October 2015
  through January 2026, per your instruction. This runs automatically, once, the first
  time each device opens this version — nothing for you to click. Verified with an
  automated test: exactly 128 months for Association/Conference, 124 for Convention,
  confirmed idempotent (opening the app twice doesn't double it up).
- **Remittances data now uses deterministic IDs** — a technical fix alongside the
  above: a remittance record's identity is really just its (item, year, month), so
  IDs are now derived from that instead of being random, which prevents duplicate
  records for the same month ever existing side by side. Fully covered by the
  automated tests above.
- **Reports now show Balance Brought Forward / Carried Forward, and a Remittances
  note** — every Monthly/Quarterly/Annual report (on-screen, print, PDF, and Word) now
  opens with "Balance Brought Forward" (the running total from everything dated before
  that period), and closes with "Balance Carried Forward" (brought forward + this
  period's net) alongside the existing "Net Balance." A short note also appears right
  below the Expenditure section listing which months each Remittance item (Association,
  Conference, Convention, Stipend, Pension, Education) was paid for, in the same "Paid —
  Jan, Feb, Mar" format as the Remittances tab. Bank A/C and Notes were deliberately
  left out of reports per your call — kept as separate records. Verified with an
  automated test using known income/expenditure figures across two months, confirming
  the brought-forward/carried-forward math and remittance lines come out exactly right.
- **Password required for every Add, Edit, and Delete** — separate from the 4-digit
  app-open PIN. Anyone can open the app and view everything (Dashboard, Reports, Dues),
  but adding, editing, or deleting anything — on every tab, including Remittances
  mark/unmark and restoring a backup — now asks for a password first, every single
  time. **Currently set to `2`** (you asked for something fast to type). To change it,
  open `app.js`, find the line `const EDIT_PASSWORD = "2";` near the top, and change
  the value in quotes. Worth being clear-eyed about: like the PIN, this is a
  deliberate-confirmation step implemented in the app's own code, not a
  cryptographically secure lock — it stops accidental taps and casual unauthorized use
  effectively, but wouldn't stop someone with real technical skill and access to the
  device. Verified with an automated test: a wrong password (or cancelling the prompt)
  correctly blocks the action, and the correct password lets it through.

- **Remittances tab** — a simple paid/unpaid checklist for Association Due, Conference
  Due, Convention Due, Pastor's Stipend, and Pastor's Pension (all monthly), plus
  Pastor's Children Education Support (yearly). Pick a year, tap a month to mark it
  paid or unpaid — each item shows a plain summary line like "Paid: Jan, Feb, Mar".
  Deliberately kept separate from the Dues Calculator's computed amounts — this tab is
  purely a record of what's actually been paid, not a calculation. Syncs the same as
  everything else; verified with an automated test covering marking paid, the yearly
  item, and un-marking, all propagating correctly across devices.
- **Notes tab** — a place for outstanding transactions/debts, proposed expenditure, and
  general notes, separate from actual Income/Expenditure (doesn't affect any totals).
  Each note has a category (Outstanding Transaction/Debt, Proposed Expenditure, Other),
  description, optional amount, and an Open/Resolved status so you can track things
  without deleting them. Syncs across devices the same as everything else — verified
  with an automated test covering add, edit, and delete all propagating correctly.
- **Fixed summary bar** — Income / Expenditure / Balance now shows permanently above
  the tab row, updating immediately as you enter data, without needing to open the
  Dashboard.
- **Tab row no longer scrolls away** — header, summary bar, and tabs are now pinned
  together at the top; only the tab content underneath scrolls.
- **Top 5 Expenditures chart** — added to the Dashboard, a simple bar chart of your
  five biggest expenditure items.
- **Church logo watermark** — a faint watermark of the church logo now shows in the
  app background, on printed reports, and on the downloaded PDF report.
- **Floating "+" quick-entry button** — a translucent "+" button on every tab lets you
  log an Income or Expenditure entry without leaving whatever tab you're on. The
  existing Income/Expenditure tabs are unchanged — this is an additional shortcut.
- **Round icon, white background** — the home-screen/app icon is now a round white
  disc with the church logo centered in it, instead of the old square icon.
- **App re-locks every time you leave it** — instead of an "update your accounts"
  reminder (which we removed — a real background notification needs server
  infrastructure this offline app doesn't have, so an in-app-only banner wasn't worth
  the clutter), the PIN lock now re-engages the instant the app is minimized, switched
  away from, or closed — not just on a fresh cold start. There's no way for any
  website to literally block someone from closing it (browsers deliberately disallow
  that), so this is the closest real equivalent: nobody gets back in without the PIN,
  every time. Your data is never at risk from closing either way — every entry saves
  to the device instantly when you tap Save, there's no "unsaved draft" state.

## Previously added

- **Bank A/C tab — manual bank-statement entries, feeding dues** — a new tab for
  entering figures straight off the bank statement, separate from the existing "Bank
  Log" tab (which is just a deposit/withdrawal ledger). Each entry is Income or
  Expenditure; Income entries pick a category — **Tithe/Offering, Thanksgiving,
  Donation, Support, or Other** (free text). This builds its own Bank account summary
  (total income, total expenditure, balance), and — matching the original Excel's
  "BANK TRANSACTIONS ENTRIES" scratch area — **only entries categorized
  Tithe/Offering feed the Dues Calculator's bank-side total.** Thanksgiving, Donation,
  Support, and Other are recorded for the record but excluded from dues.
- **Dark theme from your logo** — deep purple and gold pulled directly from the church
  logo's own colors, replacing the old plain green/white look.
- **3D spinning globe logo** — the church logo in the header (and on the lock screen)
  spins continuously with a shaded, sphere-like effect.
- **Touch feedback everywhere** — every button, tab, and entry card gives a visible
  ripple/press response when tapped.
- **PIN lock (1111)** — the app opens to a lock screen; enter the 4-digit PIN to get in.
  It stays unlocked for the rest of that browsing session, then locks again next time
  the app is opened fresh.
- **Add new items on the fly** — the Item dropdown on Income and Expenditure now has a
  "+ Add New Item…" option. Type a new item name and it's saved permanently to that
  list for future entries — no need to edit the app itself.
- **Install App button (header, every tab)** — on Android/Chrome/Edge, a real
  "⬇ Install App" button now sits in the header, visible no matter which tab you're
  on, and installs it to your home screen directly — no menu-digging, no hunting
  through a settings tab. On iPhone (Safari never allows this programmatically) the
  Backup tab shows the manual steps instead: Share icon → "Add to Home Screen".
- **Sync tab — real cross-device sync** — a dedicated "Sync" tab connects this device
  to a small backend in the background: it automatically pulls changes made on other
  devices (e.g. the treasurer's phone) and pushes changes made here, checking every
  ~9 seconds and whenever you come back online or reopen the app — no manual
  "restore" step needed. Also doubles as an off-device backup. Requires a one-time,
  ~5 minute setup — see below.
- **Live Backup (Backup tab)** — on Chrome (Android or desktop), tap "Choose Backup
  File & Enable" once, pick where to save it, and every entry you add/edit/delete from
  then on is written to that file automatically — a running *local* backup as you
  work. Safari/iOS doesn't support this, so use "Download Backup Now" there instead.
- **Human-readable backup file** — the backup is a clearly-labelled, indented `.json`
  file — open it in any text/notes app and read every entry (date, item, amount,
  method). The same file can be re-uploaded under "Restore From Backup" to bring all
  the data back onto any device.
- **PDF export** — Reports tab now has a genuine "Download as PDF" button (a real,
  standalone PDF file, generated on-device, with the logo and full income/expenditure
  breakdown) in addition to the existing browser print dialog and Word download.

## How to deploy on Netlify (from your phone)

1. Go to **app.netlify.com** in your phone's browser and log in (or sign up free).
2. Tap **Add new site** → **Deploy manually** (sometimes labelled "Deploy without Git").
3. You'll see an upload area. Tap it to open your phone's file picker — **do not** try
   to drag-and-drop on mobile, use the tap-to-browse option instead.
4. **Important:** first zip these files together on your phone (most phones' Files app
   has a "Compress" or "Zip" option — select all the files/folders in this download,
   long-press, choose Compress/Zip), then select that single zip file in the upload
   picker. Netlify accepts a zip and unpacks it automatically.
5. Netlify deploys it in a few seconds and gives you a live URL
   (something like `random-name-123.netlify.app`).
6. Open that URL in your phone's browser. Enter PIN **1111** to unlock.

## Sync — one-time setup (Cloudflare Worker, free, not Google)

This version's sync backend runs on **Cloudflare Workers** instead of Google Apps
Script — same real per-record sync behavior as before, just on a different free
platform. **Nothing is pre-connected in this download** — you deploy your own free
Worker once, then paste its URL into the app's Sync tab, on any one device (every
device that opens the Sync tab afterward will see it, since the URL is just saved in
each device's own settings — there's still nothing to "push" to other devices beyond
sharing the URL with them once).

**There is no PIN.** This is the same trade-off as before, just worth repeating:
anyone who has this Worker's URL can read or write this data (it's visible in the
app's own source code if someone inspects it, so treat the URL as effectively
public). If you want that protection back, ask for it to be re-added — it's a code
change either way, not something you can toggle in the app itself.

### Setting it up (all from a phone/desktop browser, no coding tools needed)

1. Go to **dash.cloudflare.com** and sign up for a free account (just an email and
   password — no card required for the free tier).
2. In the sidebar, go to **Workers & Pages** → **Create** → **Create Worker**.
3. Give it a name (e.g. `ubc-finance-sync`) → **Deploy** (it deploys a placeholder
   "Hello World" first — that's expected).
4. Once created, open it and tap **Edit code** (sometimes labelled "Quick edit" or
   the `</>` icon). Delete everything in the editor, then paste in the full contents
   of `backend/worker.js` from this download. Tap **Deploy** / **Save and deploy**.
5. Now bind the storage it needs: in the Worker's **Settings** tab, find **Bindings**
   → **Add binding** → **KV Namespace**. If you don't have a KV namespace yet, create
   one right there (any name, e.g. `ubc-finance-kv`). For **Variable name**, type
   exactly `STATE_KV` (this must match `env.STATE_KV` in `worker.js`). Save.
6. Your Worker's URL is shown at the top of its page — it looks like
   `https://ubc-finance-sync.YOUR-SUBDOMAIN.workers.dev`. Copy it.
7. Open the app → **Sync** tab → paste that URL into **Sync URL** → **Save & Connect**.
   Do this once on each device you want connected (or share the URL with whoever sets
   up the other phones).

That's it — no phone number, no card, no per-message cost. The free plan covers
100,000 requests/day and 1,000 KV writes/day, which a handful of church devices
polling every 9 seconds won't come close to.

**Worth knowing — Workers KV is "eventually consistent":** a write from one device
can take up to about a minute to be visible to a device polling from a different part
of the world. In practice, for a handful of devices in the same country, this is
rarely noticeable, and the periodic re-poll means everything still converges — it's
just not instant the way a single in-memory server would be.

### If you ever need to update the Worker's code later

Open the Worker in the Cloudflare dashboard → **Edit code** → replace the contents
with the new `backend/worker.js` → **Deploy**. No redeploy is needed on the app side
— the Worker's URL doesn't change from a code update alone.

## Updating later

If you ever want to change something, edit the files and re-zip, then on Netlify go to
your site → **Deploys** → drag/upload the new zip again (or ask me to make the change
and re-package it for you).

## Notes

- Data lives only in this browser/device's storage unless you enable Live Backup, set
  up Sync, or download a backup file yourself. Nothing is uploaded on its own.
- The PIN (1111) only protects against casual access on this device/browser — anyone
  with access to the device's storage directly could still see the data. Treat it as a
  screen lock, not encryption. (This is separate from the Sync URL, which protects
  your shared Cloudflare Worker.)
- If you ever change the app's files yourself, bump `CACHE_NAME` in `sw.js` again
  (it's currently `ubc-finance-v17`) so the new version replaces the old cached one.
