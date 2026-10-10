/* UBC Finance — Cross-device Sync
   Talks to a small Cloudflare Worker (backed by Workers KV) — see
   backend/worker.js. Any device with the URL can push/pull data — no
   account needed on that device, and no PIN (removed by explicit
   request — anyone with this URL can read/write the data; see
   README for that trade-off).
   See README.md for setup.

   IMPORTANT: this does a real per-record MERGE, not "whichever device saved
   last wins". Each record carries its own modifiedAt; deletions are tracked
   as tombstones. This means entries added independently on two devices both
   survive a sync (an all-or-nothing version could silently drop one
   device's new entries if the other device synced around the same time —
   this avoids that). */

// Not baked in — paste your own Worker URL into the Sync tab after deploying
// it (see README). Left blank here since every deployment needs its own.
const DEFAULT_SYNC_URL = "";

const Sync = (function () {
  const CONFIG_KEY = "syncConfig"; // { url }

  let syncing = false;
  let pushTimer = null;
  let pollTimer = null;
  let statusListeners = [];
  let lastSyncedAt = null;

  function getConfig() {
    const c = DB.get(CONFIG_KEY, null);
    if (c && c.url) return c;
    return { url: DEFAULT_SYNC_URL };
  }
  function setConfig(cfg) { DB.set(CONFIG_KEY, cfg); }
  function isConfigured() { const c = getConfig(); return !!(c && c.url); }

  function collectLocalState() {
    return {
      income: loadIncome(),
      expenditure: loadExpenditure(),
      transactions: loadTransactions(),
      bankEntries: loadBankEntries(),
      bankAccountEntries: loadBankAccountEntries(),
      notes: loadNotes(),
      remittances: loadRemittances(),
      customIncomeItems: loadCustomItems("income"),
      customExpenditureItems: loadCustomItems("expenditure"),
      tombstones: loadTombstones(),
    };
  }

  function setStatus(text) {
    statusListeners.forEach((fn) => { try { fn(text); } catch (e) {} });
  }
  function onStatus(fn) { statusListeners.push(fn); }

  function sleep(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }

  // A short automatic retry papers over ordinary network hiccups (a dropped
  // wifi packet, a device waking from sleep mid-request) so a single blip
  // doesn't surface as a scary "Sync failed" message.
  async function fetchWithRetry(url, options, attempts){
    attempts = attempts || 3;
    let lastErr;
    for(let i=0; i<attempts; i++){
      try{
        return await fetch(url, options);
      }catch(err){
        lastErr = err;
        if(i < attempts-1) await sleep(1000 * (i+1)); // 1s, then 2s
      }
    }
    throw lastErr;
  }

  async function pull(cfg) {
    const t0 = Date.now();
    const res = await fetchWithRetry(cfg.url + "?_=" + Date.now());
    if (!res.ok) throw new Error("Server error " + res.status);
    const data = await res.json();
    const t1 = Date.now();
    // Learn how far this device's clock is from the server's, so edit/delete stamps are
    // comparable across devices (nowMs() in app.js applies it). Needs the updated worker.js;
    // with an older Worker there's no serverTime and the offset simply stays as it was.
    if (data && typeof data.serverTime === "number") {
      DB.set("clockOffset", Math.round(data.serverTime - (t0 + t1) / 2));
    }
    return data;
  }

  async function push(cfg, state) {
    const payload = Object.assign({}, state, { updatedAt: Date.now() });
    const res = await fetchWithRetry(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Server error " + res.status);
    return res.json();
  }

  /* ---------- Merge logic ---------- */

  // Union two record arrays by id. On a conflicting id, keep whichever copy
  // has the newer modifiedAt (missing modifiedAt counts as 0 — oldest).
  function mergeRecords(localArr, remoteArr) {
    const map = new Map();
    (localArr || []).forEach(r => { if (r && r.id) map.set(r.id, r); });
    (remoteArr || []).forEach(r => {
      if (!r || !r.id) return;
      const cur = map.get(r.id);
      if (!cur || (r.modifiedAt || 0) > (cur.modifiedAt || 0)) map.set(r.id, r);
    });
    return map;
  }

  // Merge tombstone lists, keeping the newest deletedAt per id.
  function mergeTombstones(localTs, remoteTs) {
    const map = new Map();
    [...(localTs || []), ...(remoteTs || [])].forEach(t => {
      if (!t || !t.id) return;
      const cur = map.get(t.id);
      if (!cur || t.deletedAt > cur.deletedAt) map.set(t.id, t);
    });
    return map;
  }

  // Merge two records arrays, then drop anything a newer tombstone deleted.
  function mergeCollection(localArr, remoteArr, tombstoneMap) {
    const merged = mergeRecords(localArr, remoteArr);
    const result = [];
    merged.forEach((rec, id) => {
      const tomb = tombstoneMap.get(id);
      if (tomb && tomb.deletedAt >= (rec.modifiedAt || 0)) return; // deletion wins
      result.push(rec);
    });
    return result;
  }

  // Simple set-union for plain string lists (custom item names) — order doesn't matter here.
  function mergeStringList(localList, remoteList) {
    return Array.from(new Set([...(localList || []), ...(remoteList || [])]));
  }

  function sameJSON(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  async function syncNow() {
    const cfg = getConfig();
    if (!cfg || !cfg.url) { setStatus("Sync not set up yet"); return; }
    if (!navigator.onLine) { setStatus("Offline — changes saved on this device, will sync when online"); return; }
    if (syncing) return;
    syncing = true;
    setStatus("Syncing…");
    try {
      const remote = await pull(cfg);
      if (remote.ok === false) {
        setStatus("Sync error: " + (remote.error || "check the URL"));
        return;
      }
      const local = collectLocalState();
      const tombstoneMap = mergeTombstones(local.tombstones, remote.tombstones);
      const mergedTombstones = Array.from(tombstoneMap.values());

      const mergedIncome = mergeCollection(local.income, remote.income, tombstoneMap);
      const mergedExpenditure = mergeCollection(local.expenditure, remote.expenditure, tombstoneMap);
      const mergedTransactions = mergeCollection(local.transactions, remote.transactions, tombstoneMap);
      const mergedBankEntries = mergeCollection(local.bankEntries, remote.bankEntries, tombstoneMap);
      const mergedBankAccountEntries = mergeCollection(local.bankAccountEntries, remote.bankAccountEntries, tombstoneMap);
      const mergedNotes = mergeCollection(local.notes, remote.notes, tombstoneMap);
      const mergedRemittances = mergeCollection(local.remittances, remote.remittances, tombstoneMap);
      const mergedCustomIncomeItems = mergeStringList(local.customIncomeItems, remote.customIncomeItems);
      const mergedCustomExpenditureItems = mergeStringList(local.customExpenditureItems, remote.customExpenditureItems);

      const localChanged =
        !sameJSON(mergedIncome, local.income) ||
        !sameJSON(mergedExpenditure, local.expenditure) ||
        !sameJSON(mergedTransactions, local.transactions) ||
        !sameJSON(mergedBankEntries, local.bankEntries) ||
        !sameJSON(mergedBankAccountEntries, local.bankAccountEntries) ||
        !sameJSON(mergedNotes, local.notes) ||
        !sameJSON(mergedRemittances, local.remittances) ||
        !sameJSON(mergedCustomIncomeItems, local.customIncomeItems) ||
        !sameJSON(mergedCustomExpenditureItems, local.customExpenditureItems) ||
        !sameJSON(mergedTombstones, local.tombstones);

      if (localChanged) {
        saveIncome(mergedIncome);
        saveExpenditure(mergedExpenditure);
        saveTransactions(mergedTransactions);
        saveBankEntries(mergedBankEntries);
        saveBankAccountEntries(mergedBankAccountEntries);
        saveNotes(mergedNotes);
        saveRemittances(mergedRemittances);
        saveCustomItems("income", mergedCustomIncomeItems);
        saveCustomItems("expenditure", mergedCustomExpenditureItems);
        DB.set("tombstones", mergedTombstones);
        if (typeof renderAllPreservingInput === "function") renderAllPreservingInput();
      }

      const remoteChanged =
        !sameJSON(mergedIncome, remote.income) ||
        !sameJSON(mergedExpenditure, remote.expenditure) ||
        !sameJSON(mergedTransactions, remote.transactions) ||
        !sameJSON(mergedBankEntries, remote.bankEntries) ||
        !sameJSON(mergedBankAccountEntries, remote.bankAccountEntries) ||
        !sameJSON(mergedNotes, remote.notes) ||
        !sameJSON(mergedRemittances, remote.remittances) ||
        !sameJSON(mergedCustomIncomeItems, remote.customIncomeItems) ||
        !sameJSON(mergedCustomExpenditureItems, remote.customExpenditureItems) ||
        !sameJSON(mergedTombstones, remote.tombstones);

      if (remoteChanged) {
        await push(cfg, {
          income: mergedIncome,
          expenditure: mergedExpenditure,
          transactions: mergedTransactions,
          bankEntries: mergedBankEntries,
          bankAccountEntries: mergedBankAccountEntries,
          notes: mergedNotes,
          remittances: mergedRemittances,
          customIncomeItems: mergedCustomIncomeItems,
          customExpenditureItems: mergedCustomExpenditureItems,
          tombstones: mergedTombstones,
        });
      }

      lastSyncedAt = new Date();
      setStatus(
        (localChanged || remoteChanged)
          ? "Synced — up to date as of " + lastSyncedAt.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})
          : "Already up to date"
      );
    } catch (err) {
      setStatus("Sync failed: " + err.message);
    } finally {
      syncing = false;
    }
  }

  // Call this right after any local save (income/expenditure/transactions change)
  function notifyLocalChange() {
    if (!isConfigured()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(syncNow, 800); // debounce rapid edits
  }

  function startBackgroundSync() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (isConfigured() && navigator.onLine) syncNow();
    }, 9000); // poll every 9s for changes made on other devices
    window.addEventListener("online", () => { if (isConfigured()) syncNow(); });
    window.addEventListener("focus", () => { if (isConfigured()) syncNow(); });
  }

  function isSyncing() { return syncing; }

  return {
    getConfig, setConfig, isConfigured, isSyncing,
    syncNow, notifyLocalChange, onStatus, startBackgroundSync,
  };
})();

/* Hook into the existing save functions so every local change queues a sync. */
(function patchSaves() {
  const _saveIncome = saveIncome;
  saveIncome = function (v) { _saveIncome(v); Sync.notifyLocalChange(); };

  const _saveExpenditure = saveExpenditure;
  saveExpenditure = function (v) { _saveExpenditure(v); Sync.notifyLocalChange(); };

  const _saveTransactions = saveTransactions;
  saveTransactions = function (v) { _saveTransactions(v); Sync.notifyLocalChange(); };

  const _saveBankEntries = saveBankEntries;
  saveBankEntries = function (v) { _saveBankEntries(v); Sync.notifyLocalChange(); };

  const _saveBankAccountEntries = saveBankAccountEntries;
  saveBankAccountEntries = function (v) { _saveBankAccountEntries(v); Sync.notifyLocalChange(); };

  const _saveNotes = saveNotes;
  saveNotes = function (v) { _saveNotes(v); Sync.notifyLocalChange(); };

  const _saveRemittances = saveRemittances;
  saveRemittances = function (v) { _saveRemittances(v); Sync.notifyLocalChange(); };

  const _saveCustomItems = saveCustomItems;
  saveCustomItems = function (kind, list) { _saveCustomItems(kind, list); Sync.notifyLocalChange(); };

  const _renderAll = renderAll;
  renderAll = function () { _renderAll(); renderSyncTab(); };
})();

/* A sync that brings in changes from another device re-renders every tab. Doing that blindly
   rebuilt the forms and wiped whatever the person was halfway through typing. This wrapper
   snapshots every field, re-renders, then puts values, focus, caret and scroll position back. */
function renderAllPreservingInput() {
  const fieldKey = (el) => {
    const tab = el.closest(".tab");
    const form = el.closest("form");
    return (tab ? tab.id : "") + "|" + (form ? form.id : "") + "/" + (el.id || el.name);
  };
  const isField = (el) => (el.id || el.name) && el.type !== "file" && el.type !== "password";
  const collect = () => Array.from(document.querySelectorAll("input, select, textarea")).filter(isField);

  const snap = new Map();
  collect().forEach(el => snap.set(fieldKey(el), el.type === "checkbox" ? el.checked : el.value));

  const active = document.activeElement;
  const activeKey = (active && active.matches && active.matches("input, select, textarea") && isField(active)) ? fieldKey(active) : null;
  let selStart = null, selEnd = null;
  try { selStart = active.selectionStart; selEnd = active.selectionEnd; } catch (e) {}
  const scrollY = window.scrollY;

  renderAll();

  // document order, so a form's "type" select is restored (and its dependent options rebuilt) before its "category" select
  collect().forEach(el => {
    const key = fieldKey(el);
    if (!snap.has(key)) return;
    const v = snap.get(key);
    if (el.type === "checkbox") { el.checked = v; return; }
    if (el.value === v) return;
    if (el.tagName === "SELECT") {
      if (!Array.from(el.options).some(o => o.value === v || o.text === v)) return; // option no longer exists
      el.value = v;
      // inside a form, fire "change" so dependent fields (category list, "Describe it" box) update; never for the add-new-item option, which opens a prompt
      if (el.closest("form") && v !== "__add_new_item__") el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      el.value = v;
    }
  });

  if (activeKey) {
    const el = collect().find(e => fieldKey(e) === activeKey);
    if (el) {
      try { el.focus({ preventScroll: true }); } catch (e) {}
      try { if (selStart !== null) el.setSelectionRange(selStart, selEnd); } catch (e) {}
    }
  }
  window.scrollTo(0, scrollY);
}

/* ================= SYNC TAB UI ================= */
function renderSyncTab() {
  const el = document.getElementById("syncdata");
  if (!el) return;
  const cfg = Sync.getConfig();
  el.innerHTML = `
    <div class="card">
      <h2>Sync Across Devices</h2>
      <p style="font-size:12.5px;color:var(--muted);">
        Connects this device to your church's shared online data store, so
        entries made here and on other devices (e.g. the treasurer's phone)
        stay in sync automatically whenever both are online. Also doubles as
        an off-device backup. One-time setup — see README for how to deploy
        the free Cloudflare Worker this talks to, then paste its URL below.
      </p>
      <label>Sync URL (from your Cloudflare Worker deployment)</label>
      <input id="syncUrlInput" type="text" placeholder="https://your-worker.your-subdomain.workers.dev" value="${esc(cfg.url)}">
      <button class="btn gold" id="saveSyncBtn">Save & Connect</button>
      <button class="btn secondary" id="syncNowBtn">Sync Now</button>
      <p id="syncStatusText" style="font-size:12.5px;color:var(--muted);margin-top:10px;"></p>
      <p style="font-size:11px;color:var(--muted);margin-top:4px;">No PIN — anyone with this URL can read or write this data. Only share it with people you trust with the church's financial records.</p>
    </div>
  `;
  document.getElementById("saveSyncBtn").addEventListener("click", () => {
    const url = document.getElementById("syncUrlInput").value.trim();
    Sync.setConfig({ url });
    toast("Sync settings saved");
    Sync.syncNow();
  });
  document.getElementById("syncNowBtn").addEventListener("click", () => Sync.syncNow());
}

Sync.onStatus((text) => {
  const elx = document.getElementById("syncStatusText");
  if (elx) elx.textContent = text;
  const badge = document.getElementById("syncStatusBadge");
  if (badge) badge.textContent = text;
});

document.addEventListener("DOMContentLoaded", () => {
  renderSyncTab();
  Sync.startBackgroundSync();
  if (Sync.isConfigured()) Sync.syncNow();
});
