/* UBC Finance — fully offline. All data stored in localStorage on this device.
   Item lists below mirror the church's original Excel workbook exactly. */

const APP_VERSION = "1.5";

const INCOME_ITEMS = [
  "BEGINNING THE MONTH","MIDWEEK","SUNDAY SCHOOL","OFFERING 1","OFFERING 2","TITHE",
  "DEPARTMENT THANKSGIVING","GENERAL THANKSGIVING","DONATION","SPECIAL OFFERING",
  "ASSOCIATION OFFERING","CONFERENCE OFFERING","CONVENTION OFFERING","SEED",
  "SPECIAL PROGRAMME 1","HOLY HABITATION","BURIAL SUPPORT","SPECIAL PROGRAMME 4",
  "SPECIAL PROGRAMME 5","PASTOR'S FELLOWSHIP OFFERING"
];

const EXPENDITURE_ITEMS = [
  "FUEL","GEN MAINTENANCE","MIC BATTERY","MIC REPAIR","REFRESHMENT","WELFARE",
  "TRANSPORTATION","BULLETIN PRINT","CASH BANKED","STATIONARIES","HONOURARIUM",
  "PRINTER MAINTENANCE","CCN OGBIA CHAPTER","BBC (CONFERENCE)","CONVENTION",
  "LITERATURES (CHILDREN & ADULT)","COMMUNION ELEMENT","CHURCH SANITATION",
  "DEPARTMENT","ASSOCIATION","GIFT","CHURCH MAINTENANCE","LAND CLEARING","BANNER",
  "SOLDERING IRON AND LED","EVANGELISM","PEN EXAM SUCCESS","COMMUNICATION/DATA",
  "BURIAL SUPPORT","PASTORIUM EXPENSES","EASTER PICNIC","HOLY HABITATION",
  "A4 PAPER","PASTOR'S FELLOWSHIP OFFERING REMITTED","OWE","FYB","HOLIDAY BIBLE SCHOOL"
];

// Items that feed the dues calculation (Sunday School + Offering 1 & 2 + Tithe)
const DUES_BASE_ITEMS = ["SUNDAY SCHOOL","OFFERING 1","OFFERING 2","TITHE"];

// Categories for the Bank tab's Income side. Only "Tithe/Offering" feeds dues.
const BANK_INCOME_CATEGORIES = ["Tithe/Offering","Thanksgiving","Donation","Support","Other"];

// Categories for the (separate, new) Bank Account tab.
const BANK_ACCT_INCOME_CATEGORIES = ["Offering","Tithe","Donation","Seed Offering","Cash Banked","Others"];
const BANK_ACCT_EXPENDITURE_CATEGORIES = ["Stipend","Association Due","Conference Due","Convention Due","Pension","Pastor's Children Education Support","Others"];
const NOTE_CATEGORIES = ["Outstanding Transaction/Debt","Proposed Expenditure","Other"];

// Monthly (or, for the last one, yearly) payments tracked as a simple paid/unpaid checklist.
const REMIT_TYPES = [
  {key:"Association", label:"Association Due", yearly:false},
  {key:"Conference", label:"Conference Due", yearly:false},
  {key:"Convention", label:"Convention Due", yearly:false},
  {key:"Stipend", label:"Pastor's Stipend", yearly:false},
  {key:"Pension", label:"Pastor's Pension", yearly:false},
  {key:"Education", label:"Pastor's Children Education Support", yearly:true},
];

const PAYMENT_METHODS = ["Cash","Bank"];

/* Password required before every Add, Edit, or Delete action (separate from the
   4-digit app-open PIN) — a deliberate-confirmation step to guard against
   accidental/unauthorized changes. Change this single line to update it. */
const EDIT_PASSWORD = "2";

function editPasswordEnabled(){ return DB.get("editPasswordEnabled", true); }
function setEditPasswordEnabled(v){ DB.set("editPasswordEnabled", !!v); }

function confirmEditPassword(actionLabel){
  if(!editPasswordEnabled()) return true; // protection turned off in settings
  const entered = prompt(`Enter password to ${actionLabel}:`);
  if(entered === null) return false; // cancelled
  if(entered !== EDIT_PASSWORD){
    toast("Incorrect password — action cancelled");
    return false;
  }
  return true;
}
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTH_ABBR = MONTH_NAMES.map(m=>m.slice(0,3));

/* ---------- Storage layer (localStorage — persists offline on-device) ---------- */
const DB = {
  get(key, fallback){
    try{
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    }catch(e){ return fallback; }
  },
  set(key, val){
    localStorage.setItem(key, JSON.stringify(val));
  }
};

function loadIncome(){ return DB.get("income", []); }
function saveIncome(v){ DB.set("income", v); writeBackupNow(); }
function loadExpenditure(){ return DB.get("expenditure", []); }
function saveExpenditure(v){ DB.set("expenditure", v); writeBackupNow(); }
function loadTransactions(){ return DB.get("transactions", []); }
function saveTransactions(v){ DB.set("transactions", v); writeBackupNow(); }

/* Bank tab — manually-entered bank statement transactions, categorized. Only
   direction:"in" entries with category "Tithe/Offering" feed the dues calculator;
   everything else here just builds the separate Bank account view/report. */
function loadBankEntries(){ return DB.get("bankEntries", []); }
function saveBankEntries(v){ DB.set("bankEntries", v); writeBackupNow(); }

/* Bank Account tab — a second, separate bank-side ledger with its own income and
   expenditure categories (distinct from the Bank A/C tab, kept separate per request). */
function loadBankAccountEntries(){ return DB.get("bankAccountEntries", []); }
function saveBankAccountEntries(v){ DB.set("bankAccountEntries", v); writeBackupNow(); }

/* Notes tab — outstanding debts, proposed expenditure, and general notes. Not
   part of any income/expenditure total; purely a record for reference. */
function loadNotes(){ return DB.get("notes", []); }
function saveNotes(v){ DB.set("notes", v); writeBackupNow(); }

/* Remittances tab — simple paid/unpaid checklist for Association/Conference/Convention
   dues, Pastor's Stipend, Pension (monthly), and Education Support (yearly). A record's
   mere presence means "marked paid" for that type+year+month; deleting it unmarks it. */
function loadRemittances(){ return DB.get("remittances", []); }
function saveRemittances(v){ DB.set("remittances", v); writeBackupNow(); }

/* Tombstones — records deletions so a sync merge knows "this was deleted"
   rather than mistaking it for "never existed on this device", which would
   otherwise cause a deleted entry to reappear after syncing with a device
   that still has it. */
function loadTombstones(){ return DB.get("tombstones", []); }
function recordTombstone(id){
  const list = loadTombstones();
  list.push({id, deletedAt: nowMs()});
  DB.set("tombstones", list);
}
function recordTombstones(ids){
  if(!ids.length) return;
  const list = loadTombstones();
  const t = nowMs();
  ids.forEach(id => list.push({id, deletedAt: t}));
  DB.set("tombstones", list);
}

/* Custom items — lets the user add brand new Income/Expenditure item names
   beyond the church's original fixed list, from the "+ Add New Item" option. */
function loadCustomItems(kind){ return DB.get(kind==="income" ? "customIncomeItems" : "customExpenditureItems", []); }
function saveCustomItems(kind, list){ DB.set(kind==="income" ? "customIncomeItems" : "customExpenditureItems", list); writeBackupNow(); }
const ADD_NEW_ITEM = "__add_new_item__";
let pendingItemSelection = {income:null, expenditure:null};

/* ================= BACKUP & SYNC ================= */
let backupFileHandle = null;   // set once the user picks a file via File System Access API
let lastBackupTime = null;

function collectBackupData(){
  return {
    app: "UBC Finance Backup",
    appVersion: APP_VERSION,
    church: "University Baptist Church, Otuoke",
    exportedAt: new Date().toISOString(),
    income: loadIncome(),
    expenditure: loadExpenditure(),
    transactions: loadTransactions(),
    bankEntries: loadBankEntries(),
    bankAccountEntries: loadBankAccountEntries(),
    notes: loadNotes(),
    remittances: loadRemittances(),
    customIncomeItems: loadCustomItems("income"),
    customExpenditureItems: loadCustomItems("expenditure")
  };
}
function backupText(){ return JSON.stringify(collectBackupData(), null, 2); }

async function writeBackupNow(){
  if(!backupFileHandle) return;
  try{
    const writable = await backupFileHandle.createWritable();
    await writable.write(backupText());
    await writable.close();
    lastBackupTime = new Date();
    const statusEl = document.getElementById("setup");
    if(statusEl && statusEl.classList.contains("active")) renderExport();
  }catch(e){ /* couldn't write this time — next change will retry */ }
}

async function enableLiveBackup(){
  if(!window.showSaveFilePicker){ toast("Live backup isn't supported in this browser"); return; }
  try{
    backupFileHandle = await window.showSaveFilePicker({
      suggestedName: "UBC_Finance_Backup.json",
      types: [{ description: "UBC Finance Backup (JSON)", accept: {"application/json": [".json"]} }]
    });
    await writeBackupNow();
    toast("Live backup enabled — this file now updates as you work");
    renderExport();
  }catch(e){ /* user cancelled the picker */ }
}

function downloadBackupNow(){
  const text = backupText();
  const base64 = btoa(unescape(encodeURIComponent(text)));
  const a = document.createElement("a");
  a.href = "data:application/json;base64," + base64;
  a.setAttribute("download", `UBC_Finance_Backup_${todayISO()}.json`);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  lastBackupTime = new Date();
  toast("Backup downloaded");
  renderExport();
}

function restoreFromBackupFile(file){
  const reader = new FileReader();
  reader.onload = async ()=>{
    let data;
    try{ data = JSON.parse(reader.result); }
    catch(e){ toast("That file isn't a valid backup"); return; }
    if(!confirm("This replaces ALL data currently on this device with this backup. Continue?")) return;
    if(!confirmEditPassword("restore this backup (replaces all current data)")) return;

    // With Sync on, first bring in anything other devices have, so that records which are
    // not in the backup are known locally and can be properly deleted (otherwise the next
    // sync would simply bring them back and the restore would appear to do nothing).
    const syncOn = (typeof Sync !== "undefined" && Sync.isConfigured());
    if(syncOn){
      toast("Syncing before restore…");
      while(Sync.isSyncing()) await new Promise(r=>setTimeout(r,200));
      await Sync.syncNow();
      while(Sync.isSyncing()) await new Promise(r=>setTimeout(r,200));
    }

    // Everything below runs synchronously (no sync can interleave).
    const stamp = nowMs();
    function restoreList(arr, loadFn, saveFn){
      if(!Array.isArray(arr)) return;
      const keep = new Set(arr.filter(r=>r && r.id).map(r=>r.id));
      // records on this device that the backup doesn't contain are deleted — via tombstones, so it sticks across sync
      recordTombstones(loadFn().filter(r=>r && r.id && !keep.has(r.id)).map(r=>r.id));
      // restored records get a fresh stamp so they win over older deletions / older copies on other devices
      saveFn(arr.map(r=> (r && r.id) ? {...r, modifiedAt: stamp} : r));
    }
    restoreList(data.income, loadIncome, saveIncome);
    restoreList(data.expenditure, loadExpenditure, saveExpenditure);
    restoreList(data.transactions, loadTransactions, saveTransactions);
    restoreList(data.bankEntries, loadBankEntries, saveBankEntries);
    restoreList(data.bankAccountEntries, loadBankAccountEntries, saveBankAccountEntries);
    restoreList(data.notes, loadNotes, saveNotes);
    restoreList(data.remittances, loadRemittances, saveRemittances);
    if(Array.isArray(data.customIncomeItems)) saveCustomItems("income", data.customIncomeItems);
    if(Array.isArray(data.customExpenditureItems)) saveCustomItems("expenditure", data.customExpenditureItems);
    toast("Backup restored");
    renderAll();
  };
  reader.readAsText(file);
}

/* ================= INSTALL (Add to Home Screen) =================
   Button lives in the header (always visible on every tab, not buried in a
   settings page) so it's actually discoverable — matches the working
   reference implementation. */
let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (e)=>{
  e.preventDefault();
  deferredInstallPrompt = e;
  const btn = document.getElementById("installAppBtn");
  if(btn) btn.style.display = "inline-block";
});

window.addEventListener("appinstalled", ()=>{
  deferredInstallPrompt = null;
  toast("App installed");
  const btn = document.getElementById("installAppBtn");
  if(btn) btn.style.display = "none";
});

function isStandaloneDisplay(){
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
function isIOSDevice(){
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
async function triggerInstall(){
  if(!deferredInstallPrompt){ toast("Install isn't available yet — try reloading the app"); return; }
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  const btn = document.getElementById("installAppBtn");
  if(btn) btn.style.display = "none";
}
{
  const btn = document.getElementById("installAppBtn");
  if(btn) btn.addEventListener("click", triggerInstall);
  // Hide immediately if already running as an installed app.
  if(isStandaloneDisplay() && btn) btn.style.display = "none";
}

/* Timestamp used to stamp edits/deletions. Corrected by the offset between this device's clock and the
   sync server's clock (learned on each sync), so a phone with a wrong clock can't make its edits look
   older/newer than they really are when records are merged. */
function nowMs(){ return Date.now() + (Number(DB.get("clockOffset", 0)) || 0); }
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }
function naira(n){ n = Number(n)||0; return "₦" + n.toLocaleString("en-NG",{maximumFractionDigits:0}); }
function esc(s){ return (s===undefined||s===null) ? "" : String(s).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }

function toast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._h);
  toast._h = setTimeout(()=>t.classList.remove("show"), 2200);
}

function todayISO(){
  const d = new Date();
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}

function monthKeyOf(dateStr){
  // "2026-03-14" -> "2026-03"
  return (dateStr||todayISO()).slice(0,7);
}

function monthLabel(monthKey){
  if(!monthKey) return "";
  const [y,m] = monthKey.split("-");
  return MONTH_NAMES[Number(m)-1] + " " + y;
}

/* ---------- Tab routing ---------- */
const DEFAULT_SETUP_PIN = "2222";
function getSetupPin(){ return DB.get("setupPin", DEFAULT_SETUP_PIN); }
let setupUnlocked = false;

function activateTab(tabId){
  if(tabId !== "setup") setupUnlocked = false;   // leaving Set-up locks it again
  document.querySelectorAll("nav button").forEach(b=>b.classList.toggle("active", b.dataset.tab===tabId));
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active", t.id===tabId));
  renderAll();
}

document.getElementById("tabs").addEventListener("click", (e)=>{
  const btn = e.target.closest("button[data-tab]");
  if(!btn) return;
  if(btn.dataset.tab === "setup" && !setupUnlocked){ openSetupLock(); return; }
  activateTab(btn.dataset.tab);
});

/* Set-up (Backup + Sync + PIN) is behind its own PIN — default 2222, changeable inside Set-up. */
(function(){
  const box = document.getElementById("setupLock");
  const dots = box.querySelectorAll(".lockDot");
  const err = document.getElementById("setupLockError");
  let entered = "";
  function refresh(){ dots.forEach((d,i)=>d.classList.toggle("filled", i<entered.length)); }
  function reset(){ entered = ""; err.textContent = ""; refresh(); }
  window.openSetupLock = function(){ reset(); box.classList.remove("hidden"); };
  window.closeSetupLock = function(){ reset(); box.classList.add("hidden"); };
  document.getElementById("setupKeypad").addEventListener("click", (e)=>{
    const btn = e.target.closest(".keyBtn");
    if(!btn) return;
    const k = btn.dataset.k;
    if(k === "cancel"){ closeSetupLock(); return; }
    if(k === "clear"){ reset(); return; }
    if(entered.length >= 4) return;
    entered += k; refresh();
    if(entered.length === 4){
      if(entered === String(getSetupPin())){
        setupUnlocked = true;
        closeSetupLock();
        activateTab("setup");
      }else{
        err.textContent = "Incorrect PIN — try again";
        box.classList.add("shake");
        setTimeout(()=>{ box.classList.remove("shake"); reset(); err.textContent = "Incorrect PIN — try again"; }, 400);
      }
    }
  });
  // Leaving the app locks Set-up again and moves off it.
  document.addEventListener("visibilitychange", ()=>{
    if(document.visibilityState === "hidden"){
      setupUnlocked = false;
      closeSetupLock();
      const t = document.getElementById("setup");
      if(t && t.classList.contains("active")) activateTab("dashboard");
    }
  });
})();

function renderSetupPinCard(){
  const el = document.getElementById("setupPinCard");
  if(!el || el.dataset.ready) return;     // built once, so typing isn't wiped by re-renders
  el.dataset.ready = "1";
  el.innerHTML = `
    <div class="card">
      <h2>Set-up PIN</h2>
      <p style="font-size:12.5px;color:var(--muted);">
        This 4-digit PIN protects the Set-up tab (Backup and Sync). The default is 2222 — change it here.
        Keep it somewhere safe: it can only be changed by someone who knows the current PIN.
      </p>
      <label>Current PIN</label>
      <input type="password" inputmode="numeric" maxlength="4" autocomplete="off" id="spCur">
      <label>New PIN (4 digits)</label>
      <input type="password" inputmode="numeric" maxlength="4" autocomplete="off" id="spNew">
      <label>Confirm new PIN</label>
      <input type="password" inputmode="numeric" maxlength="4" autocomplete="off" id="spNew2">
      <button class="btn" id="spSave">Change PIN</button>
    </div>`;
  document.getElementById("spSave").addEventListener("click", ()=>{
    const cur = document.getElementById("spCur"), n1 = document.getElementById("spNew"), n2 = document.getElementById("spNew2");
    if(cur.value !== String(getSetupPin())){ toast("Current PIN is incorrect"); return; }
    if(!/^\d{4}$/.test(n1.value)){ toast("New PIN must be exactly 4 digits"); return; }
    if(n1.value !== n2.value){ toast("The new PINs don't match"); return; }
    DB.set("setupPin", n1.value);
    cur.value = n1.value = n2.value = "";
    toast("Set-up PIN changed");
  });
}

function renderAll(){
  renderSummaryBar();
  renderDashboard();
  renderIncome();
  renderExpenditure();
  renderBankTab();
  renderBankAccountTab();
  renderNotesTab();
  renderRemittancesTab();
  renderDues();
  renderTransactions();
  renderReports();
  renderSetupPinCard();
  renderExport();
}

/* Fixed summary bar (Income / Expenditure / Balance) — sits above the tab row so
   entering data reflects immediately without needing to open the Dashboard tab. */
function renderSummaryBar(){
  const el = document.getElementById("summaryBar");
  if(!el) return;
  const income = loadIncome();
  const expenditure = loadExpenditure();
  const totalIncome = income.reduce((s,e)=>s+(Number(e.amount)||0),0);
  const totalExp = expenditure.reduce((s,e)=>s+(Number(e.amount)||0),0);
  const balance = totalIncome - totalExp;
  el.innerHTML = `
    <div class="sbItem"><div class="sbLabel">Income</div><div class="sbValue amt-in">${naira(totalIncome)}</div></div>
    <div class="sbItem"><div class="sbLabel">Expenditure</div><div class="sbValue amt-out">${naira(totalExp)}</div></div>
    <div class="sbItem"><div class="sbLabel">Balance</div><div class="sbValue" style="color:${balance>=0?'var(--in)':'var(--out)'}">${naira(balance)}</div></div>
  `;
}

/* ================= SHARED: entry list renderer (Income & Expenditure use the same pattern) ================= */
function renderEntryTab(containerEl, opts){
  // opts: { items, entries, saveFn, title, colorClass, filterMonth, setFilterMonth, searchTerm, setSearchTerm, editingId, setEditingId }
  const editing = opts.editingId ? opts.entries.find(e=>e.id===opts.editingId) : null;
  const months = [...new Set(opts.entries.map(e=>monthKeyOf(e.date)))].sort().reverse();
  // if the filtered month no longer has any entries (e.g. last one deleted), fall back to "All months"
  if(opts.filterMonth && !months.includes(opts.filterMonth)){ opts.filterMonth = ""; opts.setFilterMonth(""); }

  let filtered = opts.entries;
  if(opts.filterMonth) filtered = filtered.filter(e=>monthKeyOf(e.date)===opts.filterMonth);
  if(opts.searchTerm) filtered = filtered.filter(e=>(e.item+" "+(e.note||"")).toLowerCase().includes(opts.searchTerm.toLowerCase()));
  filtered = [...filtered].sort((a,b)=> (b.date||"").localeCompare(a.date||""));

  const total = filtered.reduce((s,e)=>s+(Number(e.amount)||0), 0);

  containerEl.innerHTML = `
    <div class="card">
      <h2>${editing ? "Edit Entry" : "Add " + opts.title}</h2>
      <form id="entryForm">
        <label>Date</label>
        <input type="date" name="date" required value="${esc(editing?.date || todayISO())}">
        <label>Item</label>
        <select name="item" id="itemSelect">
          ${opts.items.map(i=>`<option ${(editing?.item===i || (!editing && pendingItemSelection[opts.itemKind]===i))?"selected":""}>${esc(i)}</option>`).join("")}
          <option value="${ADD_NEW_ITEM}">+ Add New Item…</option>
        </select>
        <label>Amount (₦)</label>
        <input type="number" name="amount" required value="${editing?.amount||""}" placeholder="0">
        <label>Method</label>
        <select name="method">
          ${PAYMENT_METHODS.map(m=>`<option ${editing?.method===m?"selected":""}>${m}</option>`).join("")}
        </select>
        <label>Note (optional)</label>
        <input name="note" value="${esc(editing?.note)}" placeholder="e.g. who gave / what for">
        <button class="btn" type="submit">${editing ? "Save Changes" : "Add Entry"}</button>
        ${editing ? `<button class="btn secondary" type="button" id="cancelEdit">Cancel</button>` : ""}
      </form>
    </div>

    <div class="card">
      <h2>${opts.title} Records</h2>
      <div class="grid2">
        <div>
          <label>Filter by Month</label>
          <select id="monthFilter">
            <option value="">All months</option>
            ${months.map(m=>`<option value="${m}" ${opts.filterMonth===m?"selected":""}>${monthLabel(m)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>Search item/note</label>
          <input id="searchBox" value="${esc(opts.searchTerm)}" placeholder="Search...">
        </div>
      </div>
      <div class="stat" style="margin-top:10px;">Total shown <b class="${opts.colorClass}">${naira(total)}</b></div>
      <div id="entryList" style="margin-top:8px;">
        ${filtered.length===0 ? '<div class="empty">No entries found.</div>' :
          filtered.map(e=>`
            <div class="entrycard">
              <b>${esc(e.item)}</b> — <span class="${opts.colorClass}">${naira(e.amount)}</span>
              <div class="meta">${esc(e.date)} • ${esc(e.method)}${e.note ? " • "+esc(e.note) : ""}</div>
              <div style="margin-top:8px;display:flex;gap:8px;">
                <button class="btn small secondary" data-edit="${e.id}">Edit</button>
                <button class="btn small danger" data-del="${e.id}">Delete</button>
              </div>
            </div>
          `).join("")}
      </div>
    </div>
  `;

  if(opts.itemKind) pendingItemSelection[opts.itemKind] = null;

  const itemSelect = containerEl.querySelector("#itemSelect");
  if(itemSelect) itemSelect.addEventListener("change", (ev)=>{
    if(ev.target.value !== ADD_NEW_ITEM) return;
    const name = (prompt("Name of the new item:") || "").trim().toUpperCase();
    if(!name){ ev.target.value = opts.items[0] || ""; return; }
    const custom = loadCustomItems(opts.itemKind);
    if(![...opts.items].includes(name)){
      custom.push(name);
      saveCustomItems(opts.itemKind, custom);
      toast(`"${name}" added to ${opts.title} items`);
    }
    pendingItemSelection[opts.itemKind] = name;
    renderAll();
  });

  containerEl.querySelector("#entryForm").addEventListener("submit", (ev)=>{
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const data = Object.fromEntries(fd.entries());
    if(data.item === ADD_NEW_ITEM){ toast("Pick or add an item first"); return; }
    if(!confirmEditPassword(opts.editingId ? "save changes" : "add this entry")) return;
    data.amount = Number(data.amount)||0;
    data.modifiedAt = nowMs();
    let entries = opts.entries;
    if(opts.editingId){
      entries = entries.map(e => e.id===opts.editingId ? {...e, ...data} : e);
      toast("Entry updated");
    }else{
      entries = [...entries, {id: uid(), ...data}];
      toast("Entry added");
    }
    opts.saveFn(entries);
    opts.setEditingId(null);
    renderAll();
  });

  const cancelBtn = containerEl.querySelector("#cancelEdit");
  if(cancelBtn) cancelBtn.addEventListener("click", ()=>{ opts.setEditingId(null); renderAll(); });

  containerEl.querySelector("#monthFilter").addEventListener("change", (ev)=>{
    opts.setFilterMonth(ev.target.value); renderAll();
  });
  containerEl.querySelector("#searchBox").addEventListener("input", (ev)=>{
    // Re-render only this tab and put the cursor back — a full renderAll() here replaced the
    // search box after every keystroke, which dropped focus (and closed the phone keyboard).
    const caret = ev.target.selectionStart;
    opts.searchTerm = ev.target.value;
    opts.setSearchTerm(ev.target.value);
    renderEntryTab(containerEl, opts);
    const box = containerEl.querySelector("#searchBox");
    if(box){ box.focus(); try{ box.setSelectionRange(caret, caret); }catch(e){} }
  });

  containerEl.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click", ()=>{
    opts.setEditingId(b.dataset.edit);
    renderAll();
    containerEl.scrollIntoView({behavior:"smooth"});
  }));
  containerEl.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click", ()=>{
    if(!confirmEditPassword("delete this entry")) return;
    recordTombstone(b.dataset.del);
    opts.saveFn(opts.entries.filter(e=>e.id!==b.dataset.del));
    toast("Entry deleted");
    renderAll();
  }));
}

/* ================= INCOME TAB ================= */
let incomeFilterMonth = "";
let incomeSearchTerm = "";
let incomeEditingId = null;

function renderIncome(){
  renderEntryTab(document.getElementById("income"), {
    items: [...INCOME_ITEMS, ...loadCustomItems("income")],
    itemKind: "income",
    entries: loadIncome(),
    saveFn: saveIncome,
    title: "Income",
    colorClass: "amt-in",
    filterMonth: incomeFilterMonth,
    setFilterMonth: (v)=>incomeFilterMonth=v,
    searchTerm: incomeSearchTerm,
    setSearchTerm: (v)=>incomeSearchTerm=v,
    editingId: incomeEditingId,
    setEditingId: (v)=>incomeEditingId=v
  });
}

/* ================= EXPENDITURE TAB ================= */
let expFilterMonth = "";
let expSearchTerm = "";
let expEditingId = null;

function renderExpenditure(){
  renderEntryTab(document.getElementById("expenditure"), {
    items: [...EXPENDITURE_ITEMS, ...loadCustomItems("expenditure")],
    itemKind: "expenditure",
    entries: loadExpenditure(),
    saveFn: saveExpenditure,
    title: "Expenditure",
    colorClass: "amt-out",
    filterMonth: expFilterMonth,
    setFilterMonth: (v)=>expFilterMonth=v,
    searchTerm: expSearchTerm,
    setSearchTerm: (v)=>expSearchTerm=v,
    editingId: expEditingId,
    setEditingId: (v)=>expEditingId=v
  });
}

/* ================= BANK ACCOUNT TAB (manual bank-statement entries) =================
   Separate from the Cheque log (which is just a deposit/withdrawal ledger). This tab
   builds an actual Bank *account* — income by category + expenditure — straight from
   what you read off the bank statement. Only Income entries categorized
   "Tithe/Offering" feed the Dues Calculator; everything else here is for the record. */
let bankEditingId = null;
let bankFilterMonth = "";

/* ================= BANK ACCOUNT TAB (separate from Bank A/C, per request) ================= */
let bankAcct2EditingId = null;
let bankAcct2FilterMonth = "";
let bankAcct2ReportScope = "Month";
let bankAcct2ReportPeriod = "";

function renderBankAccountTab(){
  const el = document.getElementById("bankaccount");
  if(!el) return;
  const entries = loadBankAccountEntries();
  const editing = bankAcct2EditingId ? entries.find(b=>b.id===bankAcct2EditingId) : null;
  const months = [...new Set(entries.map(b=>monthKeyOf(b.date)))].sort().reverse();
  if(bankAcct2FilterMonth && !months.includes(bankAcct2FilterMonth)) bankAcct2FilterMonth = "";

  let filtered = bankAcct2FilterMonth ? entries.filter(b=>monthKeyOf(b.date)===bankAcct2FilterMonth) : entries;
  filtered = [...filtered].sort((a,b)=>(b.date||"").localeCompare(a.date||""));

  const totalIn = filtered.filter(b=>b.direction==="in").reduce((s,b)=>s+(Number(b.amount)||0),0);
  const totalOut = filtered.filter(b=>b.direction==="out").reduce((s,b)=>s+(Number(b.amount)||0),0);

  const dir = editing?.direction || "in";
  const cat = editing?.category || BANK_ACCT_INCOME_CATEGORIES[0];
  const categoriesFor = d => d==="in" ? BANK_ACCT_INCOME_CATEGORIES : BANK_ACCT_EXPENDITURE_CATEGORIES;

  el.innerHTML = `
    <div class="card">
      <h2>${editing ? "Edit Entry" : "Add Bank Account Entry"}</h2>
      <form id="bankAcct2Form">
        <label>Date</label>
        <input type="date" name="date" required value="${esc(editing?.date || todayISO())}">
        <label>Type</label>
        <select name="direction" id="bankAcct2DirectionSelect">
          <option value="in" ${dir==="in"?"selected":""}>Income (money in)</option>
          <option value="out" ${dir==="out"?"selected":""}>Expenditure (money out)</option>
        </select>
        <label>Category</label>
        <select name="category" id="bankAcct2CategorySelect">
          ${categoriesFor(dir).map(c=>`<option ${cat===c?"selected":""}>${c}</option>`).join("")}
        </select>
        <label id="bankAcct2OtherLabel" style="${cat==="Others"?"":"display:none;"}">Describe it</label>
        <input name="otherLabel" id="bankAcct2OtherInput" style="${cat==="Others"?"":"display:none;"}" value="${esc(editing?.otherLabel)}" placeholder="e.g. Building fund">
        <label>Amount (₦)</label>
        <input type="number" name="amount" required value="${editing?.amount||""}">
        <label>Note (optional)</label>
        <input name="note" value="${esc(editing?.note)}">
        <button class="btn" type="submit">${editing ? "Save Changes" : "Add Entry"}</button>
        ${editing ? `<button class="btn secondary" type="button" id="cancelBankAcct2Edit">Cancel</button>` : ""}
      </form>
    </div>

    <div class="card">
      <h2>Bank Account</h2>
      <label>Filter by Month</label>
      <select id="bankAcct2MonthFilter">
        <option value="">All months</option>
        ${months.map(m=>`<option value="${m}" ${bankAcct2FilterMonth===m?"selected":""}>${monthLabel(m)}</option>`).join("")}
      </select>
      <div class="stat" style="margin-top:10px;">Total Income <b class="amt-in">${naira(totalIn)}</b></div>
      <div class="stat">Total Expenditure <b class="amt-out">${naira(totalOut)}</b></div>
      <div class="stat">Balance <b class="${(totalIn-totalOut)>=0?'amt-in':'amt-out'}">${naira(totalIn-totalOut)}</b></div>
    </div>

    <div class="card">
      <h2>Entries</h2>
      <div style="margin-top:8px;">
        ${filtered.length===0 ? '<div class="empty">No entries yet.</div>' :
          filtered.map(b=>`
            <div class="entrycard">
              <b>${b.direction==="in"?"Income":"Expenditure"} — ${esc(bankAccountItemLabel(b))}</b>
              — <span class="${b.direction==="in"?"amt-in":"amt-out"}">${b.direction==="in"?"+":"-"}${naira(b.amount)}</span>
              <div class="meta">${esc(b.date)}${b.note ? " • "+esc(b.note) : ""}</div>
              <div style="margin-top:8px;display:flex;gap:8px;">
                <button class="btn small secondary" data-edit="${b.id}">Edit</button>
                <button class="btn small danger" data-del="${b.id}">Delete</button>
              </div>
            </div>
          `).join("")}
      </div>
    </div>

    ${renderBankAccountReportCard()}
  `;

  const dirSelect = document.getElementById("bankAcct2DirectionSelect");
  const catSelect = document.getElementById("bankAcct2CategorySelect");
  const otherLabel = document.getElementById("bankAcct2OtherLabel");
  const otherInput = document.getElementById("bankAcct2OtherInput");

  function refreshCategoryOptions(){
    catSelect.innerHTML = categoriesFor(dirSelect.value).map(c=>`<option>${esc(c)}</option>`).join("");
    syncOtherVisibility();
  }
  function syncOtherVisibility(){
    const isOther = catSelect.value === "Others";
    otherLabel.style.display = isOther ? "" : "none";
    otherInput.style.display = isOther ? "" : "none";
  }
  dirSelect.addEventListener("change", refreshCategoryOptions);
  catSelect.addEventListener("change", syncOtherVisibility);

  el.querySelector("#bankAcct2Form").addEventListener("submit", (ev)=>{
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const data = Object.fromEntries(fd.entries());
    if(!confirmEditPassword(bankAcct2EditingId ? "save changes" : "add this entry")) return;
    data.amount = Number(data.amount)||0;
    data.modifiedAt = nowMs();
    let list = loadBankAccountEntries();
    if(bankAcct2EditingId){
      list = list.map(b => b.id===bankAcct2EditingId ? {...b, ...data} : b);
      toast("Entry updated");
    }else{
      list = [...list, {id: uid(), ...data}];
      toast("Entry added");
    }
    saveBankAccountEntries(list);
    bankAcct2EditingId = null;
    renderAll();
  });

  const cancelBtn = el.querySelector("#cancelBankAcct2Edit");
  if(cancelBtn) cancelBtn.addEventListener("click", ()=>{ bankAcct2EditingId=null; renderAll(); });

  el.querySelector("#bankAcct2MonthFilter").addEventListener("change", (ev)=>{
    bankAcct2FilterMonth = ev.target.value; renderAll();
  });

  el.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click", ()=>{
    bankAcct2EditingId = b.dataset.edit; renderAll(); el.scrollIntoView({behavior:"smooth"});
  }));
  el.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click", ()=>{
    if(!confirmEditPassword("delete this entry")) return;
    recordTombstone(b.dataset.del);
    saveBankAccountEntries(loadBankAccountEntries().filter(x=>x.id!==b.dataset.del));
    toast("Entry deleted");
    renderAll();
  }));

  wireBankAccountReportCard(el);
}

function renderBankAccountReportCard(){
  const periods = availablePeriods(bankAcct2ReportScope, [...bankAccountIncomeAsEntries(), ...bankAccountExpenditureAsEntries()]);
  if(!bankAcct2ReportPeriod || !periods.includes(bankAcct2ReportPeriod)) bankAcct2ReportPeriod = periods[0] || "";

  if(periods.length===0){
    return `<div class="card"><h2>Bank Account Report</h2><div class="empty">Add some entries first — this report is built from those.</div></div>`;
  }

  const data = buildBankAccountReportData(bankAcct2ReportScope, bankAcct2ReportPeriod);

  return `
    <div class="card no-print">
      <h2>Bank Account Report</h2>
      <div class="grid2">
        <div><label>Report Type</label>
          <select id="bankAcct2ReportScopeSelect">
            <option ${bankAcct2ReportScope==="Month"?"selected":""}>Month</option>
            <option ${bankAcct2ReportScope==="Quarter"?"selected":""}>Quarter</option>
            <option ${bankAcct2ReportScope==="Year"?"selected":""}>Year</option>
          </select>
        </div>
        <div><label>Period</label>
          <select id="bankAcct2ReportPeriodSelect">
            ${periods.map(p=>`<option value="${p}" ${bankAcct2ReportPeriod===p?"selected":""}>${periodLabel(bankAcct2ReportScope,p)}</option>`).join("")}
          </select>
        </div>
      </div>
      <button class="btn" id="bankAcct2PreviewBtn">Preview &amp; Print</button>
      <button class="btn gold" id="bankAcct2PdfBtn">Download as PDF</button>
      <button class="btn secondary" id="bankAcct2DocxBtn">Download as Word (.docx)</button>
    </div>
    <div class="card" id="bankAcct2ReportPreview">
      ${renderReportHTML(data, bankAcct2ReportScope, bankAcct2ReportPeriod, "Bank Account Report")}
    </div>
  `;
}

function wireBankAccountReportCard(el){
  const scopeSel = document.getElementById("bankAcct2ReportScopeSelect");
  if(!scopeSel) return; // no data yet — report card shows an empty state instead
  scopeSel.addEventListener("change", (e)=>{
    bankAcct2ReportScope = e.target.value; bankAcct2ReportPeriod = ""; renderBankAccountTab();
  });
  document.getElementById("bankAcct2ReportPeriodSelect").addEventListener("change", (e)=>{
    bankAcct2ReportPeriod = e.target.value; renderBankAccountTab();
  });
  document.getElementById("bankAcct2PreviewBtn").addEventListener("click", ()=>{
    const data = buildBankAccountReportData(bankAcct2ReportScope, bankAcct2ReportPeriod);
    openReportPreview({data, scope:bankAcct2ReportScope, period:bankAcct2ReportPeriod, reportLabel:"Bank Account Report", filePrefix:"UBC_BankAccountReport"});
  });
  document.getElementById("bankAcct2PdfBtn").addEventListener("click", async ()=>{
    const data = buildBankAccountReportData(bankAcct2ReportScope, bankAcct2ReportPeriod);
    const bytes = await buildReportPDF(data, bankAcct2ReportScope, bankAcct2ReportPeriod, "Bank Account Report");
    const base64 = bytesToBase64(bytes);
    const a = document.createElement("a");
    a.href = "data:application/pdf;base64," + base64;
    a.setAttribute("download", `UBC_BankAccountReport_${bankAcct2ReportScope}_${bankAcct2ReportPeriod}.pdf`);
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
  document.getElementById("bankAcct2DocxBtn").addEventListener("click", async ()=>{
    const data = buildBankAccountReportData(bankAcct2ReportScope, bankAcct2ReportPeriod);
    const bytes = await buildReportDocx(data, bankAcct2ReportScope, bankAcct2ReportPeriod, "Bank Account Report");
    const base64 = bytesToBase64(bytes);
    const a = document.createElement("a");
    a.href = "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64," + base64;
    a.setAttribute("download", `UBC_BankAccountReport_${bankAcct2ReportScope}_${bankAcct2ReportPeriod}.docx`);
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
}

/* ================= BANK CALC TAB =================
   Quick-entry scratch pad, modelled on the Excel's "BANK TRANSACTIONS ENTRIES" area:
   only the figures needed for the bank dues are typed in (amounts only, no dates), they are
   summed per month, and the dues are worked out from that total. Dues tab (Bank / Combined)
   reads these figures automatically. Stored in bankEntries as {id, month:"YYYY-MM", amount,
   modifiedAt}. Older entries (date + direction + category) still work: only the income ones
   categorized "Tithe/Offering" ever fed dues, so only those are treated as figures; the rest
   are kept untouched but not used. The real bank ledger is the separate Bank A/C tab. */
let bankCalcMonth = "";
let bankCalcUnlockUntil = 0;

function bankFigureMonth(b){ return b.month || monthKeyOf(b.date); }
function isBankFigure(b){ return !b.direction || (b.direction==="in" && b.category==="Tithe/Offering"); }
function loadBankFigures(){ return loadBankEntries().filter(isBankFigure); }
function bankBaseForMonth(monthKey){
  return loadBankFigures().filter(b=>bankFigureMonth(b)===monthKey).reduce((s,b)=>s+(Number(b.amount)||0),0);
}
function duesBreakdown(base){
  const r = x => Math.round(x*100)/100;
  const association = r(base*0.05), conference = r(base*0.07), convention = r(base*0.20), pension = r(base*0.10);
  return {association, conference, convention, pension, total: association+conference+convention+pension};
}
// Asks for the edit password once, then stays unlocked for 5 minutes so figures can be typed in quickly.
function bankCalcAuth(label){
  if(Date.now() < bankCalcUnlockUntil) return true;
  if(!confirmEditPassword(label)) return false;
  bankCalcUnlockUntil = Date.now() + 5*60*1000;
  return true;
}
function parseAmounts(text){
  const out = [];
  String(text||"").replace(/\d[\d,]*(?:\.\d+)?/g, m=>{
    const n = Number(m.replace(/,/g,""));
    if(n > 0) out.push(n);
    return m;
  });
  return out;
}
function bankCalcAdd(amounts){
  if(!amounts.length){ toast("Enter a valid amount"); return false; }
  if(!bankCalcAuth("add bank figures")) return false;
  const t = nowMs();
  const list = loadBankEntries();
  amounts.forEach((a,i)=>list.push({id: uid(), month: bankCalcMonth, amount: a, modifiedAt: t+i}));
  saveBankEntries(list);
  return true;
}

function renderBankTab(){
  const el = document.getElementById("bankacct");
  if(!el) return;
  if(!bankCalcMonth) bankCalcMonth = todayISO().slice(0,7);
  const [yy, mm] = bankCalcMonth.split("-");
  const all = loadBankFigures();
  const figs = all.filter(b=>bankFigureMonth(b)===bankCalcMonth)
                  .sort((a,b)=>(a.modifiedAt||0)-(b.modifiedAt||0));
  const base = figs.reduce((s,b)=>s+(Number(b.amount)||0),0);
  const d = duesBreakdown(base);
  const hiddenOld = loadBankEntries().length - all.length;

  const thisYear = new Date().getFullYear();
  const years = [...new Set([...all.map(b=>bankFigureMonth(b).slice(0,4)), String(thisYear-1), String(thisYear), String(thisYear+1), yy])].sort();

  // Year table (like the Excel's month columns): base + dues for each month of the selected year
  let yrBase = 0, yrCount = 0;
  const yrDues = {association:0, conference:0, convention:0, pension:0, total:0};
  const rows = MONTH_ABBR.map((ab,i)=>{
    const key = yy + "-" + String(i+1).padStart(2,"0");
    const f = all.filter(b=>bankFigureMonth(b)===key);
    const bs = f.reduce((s,b)=>s+(Number(b.amount)||0),0);
    const x = duesBreakdown(bs);
    yrBase += bs; yrCount += f.length;
    Object.keys(yrDues).forEach(k=>yrDues[k]+=x[k]);
    return `<tr${key===bankCalcMonth?' style="background:rgba(232,195,74,.12);"':''}>
      <td>${ab}</td><td style="text-align:right;">${f.length||""}</td>
      <td style="text-align:right;">${bs?naira(bs):"–"}</td>
      <td style="text-align:right;">${bs?naira(x.association):"–"}</td>
      <td style="text-align:right;">${bs?naira(x.conference):"–"}</td>
      <td style="text-align:right;">${bs?naira(x.convention):"–"}</td>
      <td style="text-align:right;">${bs?naira(x.pension):"–"}</td>
      <td style="text-align:right;"><b>${bs?naira(x.total):"–"}</b></td></tr>`;
  }).join("");

  el.innerHTML = `
    <div class="card">
      <h2>Bank Calc</h2>
      <p style="font-size:12px;color:var(--muted);margin-top:-4px;">
        Type the figures you need for dues from the bank statement or SMS alerts — amounts only,
        no dates. They are added up for the month and the dues are worked out below. This feeds
        the Dues tab (Bank and Combined) automatically.
      </p>
      <label>Month</label>
      <div style="display:flex;gap:8px;">
        <select id="bcMonth" style="flex:2;">${MONTH_NAMES.map((n,i)=>`<option value="${String(i+1).padStart(2,"0")}" ${mm===String(i+1).padStart(2,"0")?"selected":""}>${n}</option>`).join("")}</select>
        <select id="bcYear" style="flex:1;">${years.map(y=>`<option ${y===yy?"selected":""}>${y}</option>`).join("")}</select>
      </div>
    </div>

    <div class="card">
      <h2>Add figures — ${monthLabel(bankCalcMonth)}</h2>
      <input id="bcAmount" type="number" inputmode="decimal" min="0" step="any" placeholder="Amount (₦), then press Enter / Add">
      <button class="btn" id="bcAddBtn">Add</button>
      <label>Or paste many amounts at once</label>
      <textarea id="bcPaste" rows="4" placeholder="One amount per line, e.g.&#10;10000&#10;500&#10;7,000"></textarea>
      <div id="bcPasteInfo" style="font-size:12px;color:var(--muted);margin:4px 0;"></div>
      <button class="btn secondary" id="bcPasteBtn">Add pasted amounts</button>
    </div>

    <div class="card">
      <h2>${monthLabel(bankCalcMonth)} — Bank Total</h2>
      <div class="stat">Figures entered <b>${figs.length}</b></div>
      <div class="stat">Total (dues base) <b>${naira(base)}</b></div>
      <div class="stat">Association (5%) <b>${naira(d.association)}</b></div>
      <div class="stat">Conference (7%) <b>${naira(d.conference)}</b></div>
      <div class="stat">Convention (20%) <b>${naira(d.convention)}</b></div>
      <div class="stat">Pension (10%) <b>${naira(d.pension)}</b></div>
      <div class="stat">Total Bank Dues <b class="amt-out">${naira(d.total)}</b></div>
    </div>

    <div class="card">
      <h2>Figures — ${monthLabel(bankCalcMonth)}</h2>
      ${figs.length===0 ? '<div class="empty">No figures for this month yet.</div>' : `
        <button class="btn small secondary" id="bcUndoBtn" style="margin-bottom:8px;">Undo last entry</button>
        ${figs.map((b,i)=>`
          <div class="stat" style="align-items:center;">
            <span>${i+1}. <b class="amt-in">${naira(b.amount)}</b></span>
            <span style="display:flex;gap:6px;">
              <button class="btn small secondary" data-bcedit="${b.id}">Edit</button>
              <button class="btn small danger" data-bcdel="${b.id}">Delete</button>
            </span>
          </div>`).join("")}`}
      ${hiddenOld>0 ? `<p style="font-size:11.5px;color:var(--muted);margin-top:10px;">${hiddenOld} older Bank Calc entr${hiddenOld===1?"y":"ies"} (expenditure or other categories) kept but not used here — they never fed dues. The dated bank ledger is the Bank A/C tab.</p>` : ""}
    </div>

    <div class="card">
      <h2>${yy} — All Months</h2>
      <div style="overflow-x:auto;">
        <table style="min-width:520px;">
          <tr><th style="text-align:left;">Mth</th><th>#</th><th>Base</th><th>5%</th><th>7%</th><th>20%</th><th>10%</th><th>Total</th></tr>
          ${rows}
          <tr style="border-top:2px solid var(--gold-dim);"><td><b>Total</b></td><td style="text-align:right;">${yrCount}</td>
            <td style="text-align:right;"><b>${naira(yrBase)}</b></td>
            <td style="text-align:right;"><b>${naira(yrDues.association)}</b></td>
            <td style="text-align:right;"><b>${naira(yrDues.conference)}</b></td>
            <td style="text-align:right;"><b>${naira(yrDues.convention)}</b></td>
            <td style="text-align:right;"><b>${naira(yrDues.pension)}</b></td>
            <td style="text-align:right;"><b>${naira(yrDues.total)}</b></td></tr>
        </table>
      </div>
    </div>
  `;

  function afterChange(refocus){
    renderAll();
    if(refocus){ const a = document.getElementById("bcAmount"); if(a) a.focus(); }
  }

  function setMonthFromSelects(){
    bankCalcMonth = document.getElementById("bcYear").value + "-" + document.getElementById("bcMonth").value;
    renderBankTab();
  }
  document.getElementById("bcMonth").addEventListener("change", setMonthFromSelects);
  document.getElementById("bcYear").addEventListener("change", setMonthFromSelects);

  const amtInput = document.getElementById("bcAmount");
  function addSingle(){
    const n = Number(amtInput.value);
    if(bankCalcAdd(n>0 ? [n] : [])){ afterChange(true); }
  }
  document.getElementById("bcAddBtn").addEventListener("click", addSingle);
  amtInput.addEventListener("keydown", (ev)=>{ if(ev.key==="Enter"){ ev.preventDefault(); addSingle(); } });

  const pasteBox = document.getElementById("bcPaste");
  const pasteInfo = document.getElementById("bcPasteInfo");
  pasteBox.addEventListener("input", ()=>{
    const a = parseAmounts(pasteBox.value);
    pasteInfo.textContent = a.length ? `Found ${a.length} amount${a.length===1?"":"s"} totalling ${naira(a.reduce((s,x)=>s+x,0))}` : "";
  });
  document.getElementById("bcPasteBtn").addEventListener("click", ()=>{
    const a = parseAmounts(pasteBox.value);
    if(bankCalcAdd(a)){ toast(`${a.length} figure${a.length===1?"":"s"} added`); afterChange(false); }
  });

  const undoBtn = document.getElementById("bcUndoBtn");
  if(undoBtn) undoBtn.addEventListener("click", ()=>{
    const last = figs[figs.length-1];
    if(!last || !bankCalcAuth("undo the last entry")) return;
    recordTombstone(last.id);
    saveBankEntries(loadBankEntries().filter(x=>x.id!==last.id));
    toast("Last entry removed");
    afterChange(false);
  });

  el.querySelectorAll("[data-bcedit]").forEach(b=>b.addEventListener("click", ()=>{
    const rec = figs.find(x=>x.id===b.dataset.bcedit);
    if(!rec) return;
    const entered = prompt("New amount (₦):", rec.amount);
    if(entered === null) return;
    const n = Number(String(entered).replace(/,/g,""));
    if(!(n > 0)){ toast("Enter a valid amount"); return; }
    if(!bankCalcAuth("edit this figure")) return;
    saveBankEntries(loadBankEntries().map(x=> x.id===rec.id ? {...x, amount:n, modifiedAt: nowMs()} : x));
    toast("Figure updated");
    afterChange(false);
  }));
  el.querySelectorAll("[data-bcdel]").forEach(b=>b.addEventListener("click", ()=>{
    if(!bankCalcAuth("delete this figure")) return;
    recordTombstone(b.dataset.bcdel);
    saveBankEntries(loadBankEntries().filter(x=>x.id!==b.dataset.bcdel));
    toast("Figure deleted");
    afterChange(false);
  }));
}

/* ================= NOTES TAB ================= */
let noteEditingId = null;
let noteFilterCategory = "";

function renderNotesTab(){
  const el = document.getElementById("notes");
  if(!el) return;
  const notes = loadNotes();
  const editing = noteEditingId ? notes.find(n=>n.id===noteEditingId) : null;

  let filtered = noteFilterCategory ? notes.filter(n=>n.category===noteFilterCategory) : notes;
  filtered = [...filtered].sort((a,b)=>(b.date||"").localeCompare(a.date||"") || (b.modifiedAt||0)-(a.modifiedAt||0));

  const openCount = notes.filter(n=>n.status!=="Resolved").length;
  const cat = editing?.category || NOTE_CATEGORIES[0];

  el.innerHTML = `
    <div class="card">
      <h2>${editing ? "Edit Note" : "Add Note"}</h2>
      <p style="font-size:12px;color:var(--muted);margin-top:-4px;">
        A place for outstanding transactions/debts, proposed expenditure, and any
        other note worth keeping on record — separate from actual Income/Expenditure
        entries, doesn't affect any totals.
      </p>
      <form id="noteForm">
        <label>Date</label>
        <input type="date" name="date" required value="${esc(editing?.date || todayISO())}">
        <label>Category</label>
        <select name="category" id="noteCategorySelect">
          ${NOTE_CATEGORIES.map(c=>`<option ${cat===c?"selected":""}>${c}</option>`).join("")}
        </select>
        <label id="noteOtherLabel" style="${cat==="Other"?"":"display:none;"}">Describe the category</label>
        <input name="otherLabel" id="noteOtherInput" style="${cat==="Other"?"":"display:none;"}" value="${esc(editing?.otherLabel)}" placeholder="e.g. Follow-up needed">
        <label>Description</label>
        <textarea name="description" rows="3" required placeholder="e.g. Bro. John to refund transport advance">${esc(editing?.description)}</textarea>
        <label>Amount (₦, optional)</label>
        <input type="number" name="amount" value="${editing?.amount||""}">
        <label>Status</label>
        <select name="status">
          <option ${(!editing || editing.status!=="Resolved")?"selected":""}>Open</option>
          <option ${editing?.status==="Resolved"?"selected":""}>Resolved</option>
        </select>
        <button class="btn" type="submit">${editing ? "Save Changes" : "Add Note"}</button>
        ${editing ? `<button class="btn secondary" type="button" id="cancelNoteEdit">Cancel</button>` : ""}
      </form>
    </div>

    <div class="card">
      <h2>Notes</h2>
      <div class="stat">Open items <b>${openCount}</b></div>
      <label>Filter by Category</label>
      <select id="noteCategoryFilter">
        <option value="">All categories</option>
        ${NOTE_CATEGORIES.map(c=>`<option value="${c}" ${noteFilterCategory===c?"selected":""}>${c}</option>`).join("")}
      </select>
      <div style="margin-top:10px;">
        ${filtered.length===0 ? '<div class="empty">No notes yet.</div>' :
          filtered.map(n=>`
            <div class="entrycard">
              <b>${esc(n.category==="Other" && n.otherLabel ? n.otherLabel : n.category)}</b>
              ${n.status==="Resolved" ? '<span style="color:var(--muted);font-size:11px;"> • Resolved</span>' : '<span style="color:var(--gold-bright);font-size:11px;"> • Open</span>'}
              ${n.amount ? ` — <b>${naira(n.amount)}</b>` : ""}
              <div class="meta">${esc(n.description)}</div>
              <div class="meta">${esc(n.date)}</div>
              <div style="margin-top:8px;display:flex;gap:8px;">
                <button class="btn small secondary" data-edit="${n.id}">Edit</button>
                <button class="btn small danger" data-del="${n.id}">Delete</button>
              </div>
            </div>
          `).join("")}
      </div>
    </div>
  `;

  const catSelect = document.getElementById("noteCategorySelect");
  const otherLabel = document.getElementById("noteOtherLabel");
  const otherInput = document.getElementById("noteOtherInput");
  catSelect.addEventListener("change", ()=>{
    const isOther = catSelect.value === "Other";
    otherLabel.style.display = isOther ? "" : "none";
    otherInput.style.display = isOther ? "" : "none";
  });

  el.querySelector("#noteForm").addEventListener("submit", (ev)=>{
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const data = Object.fromEntries(fd.entries());
    if(!confirmEditPassword(noteEditingId ? "save changes" : "add this note")) return;
    data.amount = data.amount ? Number(data.amount) : null;
    data.modifiedAt = nowMs();
    let list = loadNotes();
    if(noteEditingId){
      list = list.map(n => n.id===noteEditingId ? {...n, ...data} : n);
      toast("Note updated");
    }else{
      list = [...list, {id: uid(), ...data}];
      toast("Note added");
    }
    saveNotes(list);
    noteEditingId = null;
    renderAll();
  });

  const cancelBtn = el.querySelector("#cancelNoteEdit");
  if(cancelBtn) cancelBtn.addEventListener("click", ()=>{ noteEditingId=null; renderAll(); });

  el.querySelector("#noteCategoryFilter").addEventListener("change", (ev)=>{
    noteFilterCategory = ev.target.value; renderAll();
  });

  el.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click", ()=>{
    noteEditingId = b.dataset.edit; renderAll(); el.scrollIntoView({behavior:"smooth"});
  }));
  el.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click", ()=>{
    if(!confirmEditPassword("delete this note")) return;
    recordTombstone(b.dataset.del);
    saveNotes(loadNotes().filter(x=>x.id!==b.dataset.del));
    toast("Note deleted");
    renderAll();
  }));
}

/* ================= REMITTANCES TAB ================= */
let remitYear = new Date().getFullYear();

// Deterministic id — a remittance record's whole identity IS its (type, year, month)
// triple, so basing the id on that (instead of a random uid()) means two devices
// independently marking the same month paid, before ever syncing, converge to the
// SAME record on merge instead of creating two duplicate-content records with
// different ids (which would otherwise make "unmark" appear to silently fail, since
// only one of the two duplicates would get tombstoned).
function remitRecordId(typeKey, year, month){
  return `remit-${typeKey}-${year}-${month || "yearly"}`;
}

function isRemitPaid(typeKey, year, month){
  return loadRemittances().some(r=>r.type===typeKey && r.year===year && r.month===month);
}
function toggleRemittance(typeKey, year, month){
  const list = loadRemittances();
  const existing = list.find(r=>r.type===typeKey && r.year===year && r.month===month);
  if(!confirmEditPassword(existing ? "unmark this as paid" : "mark this as paid")) return;
  if(existing){
    recordTombstone(existing.id);
    saveRemittances(list.filter(r=>r.id!==existing.id));
  }else{
    saveRemittances([...list, {id:remitRecordId(typeKey,year,month), type:typeKey, year, month, modifiedAt:nowMs()}]);
  }
  renderAll();
}

// Marks every month from (startYear,startMonth) to (endYear,endMonth) inclusive as
// paid for typeKey, in one go — skips any already marked. Returns how many were newly
// added. For a yearly item, month args are ignored and every year in range is marked.
function bulkMarkRemittancePaid(typeKey, startYear, startMonth, endYear, endMonth, stamp){
  if(stamp === undefined) stamp = nowMs();
  const isYearly = (REMIT_TYPES.find(t=>t.key===typeKey)||{}).yearly;
  const list = loadRemittances();
  const existingKeys = new Set(list.filter(r=>r.type===typeKey).map(r=>`${r.year}-${r.month}`));
  const toAdd = [];
  if(isYearly){
    for(let y=startYear; y<=endYear; y++){
      const key = `${y}-null`;
      if(!existingKeys.has(key)) toAdd.push({id:remitRecordId(typeKey,y,null), type:typeKey, year:y, month:null, modifiedAt:stamp});
    }
  }else{
    let y = startYear, m = startMonth;
    while(y < endYear || (y===endYear && m<=endMonth)){
      const key = `${y}-${m}`;
      if(!existingKeys.has(key)) toAdd.push({id:remitRecordId(typeKey,y,m), type:typeKey, year:y, month:m, modifiedAt:stamp});
      m++; if(m>12){ m=1; y++; }
    }
  }
  if(toAdd.length) saveRemittances([...list, ...toAdd]);
  return toAdd.length;
}

function renderRemittancesTab(){
  const el = document.getElementById("remittances");
  if(!el) return;

  el.innerHTML = `
    <div class="card">
      <h2>Remittances</h2>
      <p style="font-size:12px;color:var(--muted);margin-top:-4px;">
        A simple paid/unpaid checklist for Association, Conference, and Convention
        dues, Pastor's Stipend, Pension, and (yearly) Children Education Support.
        Doesn't affect any totals — purely a record of what's been paid.
      </p>
      <label>Year</label>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn secondary small" type="button" id="remitYearPrev" style="margin-top:0;flex:0 0 auto;">‹</button>
        <input type="number" id="remitYearInput" value="${remitYear}" style="text-align:center;">
        <button class="btn secondary small" type="button" id="remitYearNext" style="margin-top:0;flex:0 0 auto;">›</button>
      </div>
    </div>

    ${REMIT_TYPES.map(t=>{
      if(t.yearly){
        const paid = isRemitPaid(t.key, remitYear, null);
        return `
          <div class="card">
            <h2>${esc(t.label)}</h2>
            <button class="btn ${paid?'gold':'secondary'} small" data-remit-toggle="${t.key}" data-remit-month="">
              ${paid ? `✓ Paid for ${remitYear}` : `Mark Paid for ${remitYear}`}
            </button>
          </div>`;
      }
      const paidMonths = MONTH_NAMES.filter((name,i)=> isRemitPaid(t.key, remitYear, i+1));
      return `
        <div class="card">
          <h2>${esc(t.label)}</h2>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">
            ${MONTH_ABBR.map((name,i)=>{
              const m = i+1;
              const paid = isRemitPaid(t.key, remitYear, m);
              return `<button class="btn ${paid?'gold':'secondary'} small" style="flex:0 0 auto;min-width:52px;margin-top:0;" data-remit-toggle="${t.key}" data-remit-month="${m}">${name}</button>`;
            }).join("")}
          </div>
          <p style="font-size:12px;color:var(--muted);margin-top:10px;">
            ${paidMonths.length ? `Paid: ${paidMonths.join(", ")}` : `None marked yet for ${remitYear}.`}
          </p>
        </div>`;
    }).join("")}

    <div class="card">
      <h2>Bulk Mark Paid</h2>
      <p style="font-size:12px;color:var(--muted);margin-top:-4px;">Mark a whole date range paid in one go — handy for backfilling history. One password confirms the whole range, not each month.</p>
      <label>Item</label>
      <select id="bulkRemitType">
        ${REMIT_TYPES.map(t=>`<option value="${t.key}">${esc(t.label)}</option>`).join("")}
      </select>
      <div class="grid2">
        <div><label>From (month)</label><input type="month" id="bulkRemitFrom"></div>
        <div><label>To (month)</label><input type="month" id="bulkRemitTo"></div>
      </div>
      <button class="btn secondary" id="bulkRemitBtn">Mark All Paid in Range</button>
    </div>
  `;

  document.getElementById("remitYearInput").addEventListener("change", (ev)=>{
    const v = parseInt(ev.target.value, 10);
    if(!isNaN(v)){ remitYear = v; renderAll(); }
  });
  document.getElementById("remitYearPrev").addEventListener("click", ()=>{ remitYear--; renderAll(); });
  document.getElementById("remitYearNext").addEventListener("click", ()=>{ remitYear++; renderAll(); });

  el.querySelectorAll("[data-remit-toggle]").forEach(b=>b.addEventListener("click", ()=>{
    const month = b.dataset.remitMonth ? Number(b.dataset.remitMonth) : null;
    toggleRemittance(b.dataset.remitToggle, remitYear, month);
  }));

  document.getElementById("bulkRemitBtn").addEventListener("click", ()=>{
    const typeKey = document.getElementById("bulkRemitType").value;
    const fromVal = document.getElementById("bulkRemitFrom").value; // "YYYY-MM"
    const toVal = document.getElementById("bulkRemitTo").value;
    if(!fromVal || !toVal){ toast("Pick a From and To month first"); return; }
    const [fy,fm] = fromVal.split("-").map(Number);
    const [ty,tm] = toVal.split("-").map(Number);
    if(ty < fy || (ty===fy && tm<fm)){ toast("'To' must be after 'From'"); return; }
    if(!confirmEditPassword(`mark ${(REMIT_TYPES.find(t=>t.key===typeKey)||{}).label} paid for this whole range`)) return;
    const count = bulkMarkRemittancePaid(typeKey, fy, fm, ty, tm);
    toast(count ? `Marked ${count} month(s) paid` : "Nothing new to mark — already all paid");
    renderAll();
  });
}

/* One-time backfill of specific historical remittance records, run once on first
   load of this app version. Uses deterministic ids (via remitRecordId), so even
   though this same code runs independently on every device, it converges to
   identical records everywhere instead of creating per-device duplicates. */
function applyRemittanceBackfillOnce(){
  if(localStorage.getItem("remitBackfill_2026_08") === "1") return;
  // stamp 0 = "oldest possible": any later unmark (deletion) on another device wins over this
  // backfill, so a brand-new device joining can't bring back a month someone deliberately unmarked.
  bulkMarkRemittancePaid("Association", 2015, 10, 2026, 5, 0);
  bulkMarkRemittancePaid("Conference", 2015, 10, 2026, 5, 0);
  bulkMarkRemittancePaid("Convention", 2015, 10, 2026, 1, 0);
  localStorage.setItem("remitBackfill_2026_08", "1");
}

/* ================= DUES CALCULATOR TAB ================= */
// Replicates the "CASH DUE" sheet: base = Sunday School + Offering 1 + Offering 2 + Tithe,
// split by payment method (Cash vs Bank), then Association 5%, Conference 7%, Convention 20%, Pension 10%.
// Bank-side base = Income-tab entries marked method "Bank" (matching the same 4 items) PLUS
// this church's Bank Account tab entries categorized "Tithe/Offering" — matching how the
// original Excel's "BANK TRANSACTIONS ENTRIES" scratch area fed the bank dues total.
let duesMonth = "";

function computeDuesForMonth(monthKey){
  const income = loadIncome().filter(e=>monthKeyOf(e.date)===monthKey && DUES_BASE_ITEMS.includes(e.item));
  const cashBase = income.filter(e=>e.method==="Cash").reduce((s,e)=>s+(Number(e.amount)||0),0);
  // Bank side comes only from the figures typed into the Bank Calc tab (like the Excel's
  // bank entries area), so nothing is counted twice.
  const bankBase = bankBaseForMonth(monthKey);
  const combinedBase = cashBase + bankBase;

  function breakdown(base){
    const association = Math.round(base*0.05*100)/100;
    const conference = Math.round(base*0.07*100)/100;
    const convention = Math.round(base*0.20*100)/100;
    const pension = Math.round(base*0.10*100)/100;
    return {association, conference, convention, pension, total: association+conference+convention+pension};
  }

  return {
    cashBase, bankBase, combinedBase,
    cash: breakdown(cashBase),
    bank: breakdown(bankBase),
    combined: breakdown(combinedBase)
  };
}

function renderDues(){
  const el = document.getElementById("duescalc");
  const income = loadIncome();
  const bankMonths = loadBankFigures().map(b=>bankFigureMonth(b));
  const months = [...new Set([...income.map(e=>monthKeyOf(e.date)), ...bankMonths])].sort().reverse();
  if(!duesMonth && months.length) duesMonth = months[0];

  if(months.length===0){
    el.innerHTML = `<div class="card"><div class="empty">Add Sunday School, Offering 1/2 or Tithe cash income entries, or bank figures in the Bank Calc tab, first — dues are calculated from those.</div></div>`;
    return;
  }

  const d = computeDuesForMonth(duesMonth);

  el.innerHTML = `
    <div class="card">
      <h2>Dues Calculator</h2>
      <p style="font-size:12px;color:var(--muted);margin-top:-4px;">
        Cash base: Sunday School + Offering 1 + Offering 2 + Tithe income entries paid by Cash.
        Bank base: the total of the figures entered for the month in the Bank Calc tab.
        Same formula as the church's original dues sheet: Association 5%, Conference 7%,
        Convention 20%, Pension 10%.
      </p>
      <label>Month</label>
      <select id="duesMonthSelect">
        ${months.map(m=>`<option value="${m}" ${duesMonth===m?"selected":""}>${monthLabel(m)}</option>`).join("")}
      </select>
    </div>

    <div class="card">
      <h2>Base Income — ${monthLabel(duesMonth)}</h2>
      <div class="stat">Cash <b>${naira(d.cashBase)}</b></div>
      <div class="stat">Bank <b>${naira(d.bankBase)}</b></div>
      <div class="stat">Combined <b>${naira(d.combinedBase)}</b></div>
    </div>

    <div class="card">
      <h2>Dues Owed (Cash)</h2>
      <div class="stat">Association (5%) <b>${naira(d.cash.association)}</b></div>
      <div class="stat">Conference (7%) <b>${naira(d.cash.conference)}</b></div>
      <div class="stat">Convention (20%) <b>${naira(d.cash.convention)}</b></div>
      <div class="stat">Pension (10%) <b>${naira(d.cash.pension)}</b></div>
      <div class="stat">Total <b class="amt-out">${naira(d.cash.total)}</b></div>
    </div>

    <div class="card">
      <h2>Dues Owed (Bank)</h2>
      <div class="stat">Association (5%) <b>${naira(d.bank.association)}</b></div>
      <div class="stat">Conference (7%) <b>${naira(d.bank.conference)}</b></div>
      <div class="stat">Convention (20%) <b>${naira(d.bank.convention)}</b></div>
      <div class="stat">Pension (10%) <b>${naira(d.bank.pension)}</b></div>
      <div class="stat">Total <b class="amt-out">${naira(d.bank.total)}</b></div>
    </div>

    <div class="card">
      <h2>Dues Owed (Combined)</h2>
      <div class="stat">Association (5%) <b>${naira(d.combined.association)}</b></div>
      <div class="stat">Conference (7%) <b>${naira(d.combined.conference)}</b></div>
      <div class="stat">Convention (20%) <b>${naira(d.combined.convention)}</b></div>
      <div class="stat">Pension (10%) <b>${naira(d.combined.pension)}</b></div>
      <div class="stat">Total <b class="amt-out">${naira(d.combined.total)}</b></div>
    </div>
  `;

  document.getElementById("duesMonthSelect").addEventListener("change", (e)=>{
    duesMonth = e.target.value; renderDues();
  });
}

/* ================= TRANSACTIONS (BANK LOG) TAB ================= */
let txnEditingId = null;
let txnFilterMonth = "";

function renderTransactions(){
  const el = document.getElementById("transactions");
  const txns = loadTransactions();
  const editing = txnEditingId ? txns.find(t=>t.id===txnEditingId) : null;
  const months = [...new Set(txns.map(t=>monthKeyOf(t.date)))].sort().reverse();
  if(txnFilterMonth && !months.includes(txnFilterMonth)) txnFilterMonth = "";

  let filtered = txnFilterMonth ? txns.filter(t=>monthKeyOf(t.date)===txnFilterMonth) : txns;
  filtered = [...filtered].sort((a,b)=>(b.date||"").localeCompare(a.date||""));

  el.innerHTML = `
    <div class="card">
      <h2>${editing ? "Edit Cheque Entry" : "Add Cheque Entry"}</h2>
      <form id="txnForm">
        <label>Date</label>
        <input type="date" name="date" required value="${esc(editing?.date || todayISO())}">
        <label>Particulars</label>
        <input name="particulars" required value="${esc(editing?.particulars)}" placeholder="e.g. Offering deposit">
        <label>Amount (₦)</label>
        <input type="number" name="amount" required value="${editing?.amount||""}">
        <div class="grid2">
          <div><label>Bank</label><input name="bank" value="${esc(editing?.bank)}"></div>
          <div><label>Account Name</label><input name="accountName" value="${esc(editing?.accountName)}"></div>
        </div>
        <label>Cheque No. (optional)</label>
        <input name="chequeNo" value="${esc(editing?.chequeNo)}">
        <button class="btn" type="submit">${editing ? "Save Changes" : "Add Transaction"}</button>
        ${editing ? `<button class="btn secondary" type="button" id="cancelTxnEdit">Cancel</button>` : ""}
      </form>
    </div>

    <div class="card">
      <h2>Cheque Log</h2>
      <label>Filter by Month</label>
      <select id="txnMonthFilter">
        <option value="">All months</option>
        ${months.map(m=>`<option value="${m}" ${txnFilterMonth===m?"selected":""}>${monthLabel(m)}</option>`).join("")}
      </select>
      <div class="stat" style="margin-top:10px;">Total shown <b>${naira(filtered.reduce((s,t)=>s+(Number(t.amount)||0),0))}</b></div>
      <div style="margin-top:8px;">
        ${filtered.length===0 ? '<div class="empty">No transactions found.</div>' :
          filtered.map(t=>`
            <div class="entrycard">
              <b>${esc(t.particulars)}</b> — ${naira(t.amount)}
              <div class="meta">${esc(t.date)} • ${esc(t.bank)||"—"} ${t.accountName ? "• "+esc(t.accountName) : ""} ${t.chequeNo ? "• Chq# "+esc(t.chequeNo) : ""}</div>
              <div style="margin-top:8px;display:flex;gap:8px;">
                <button class="btn small secondary" data-edit="${t.id}">Edit</button>
                <button class="btn small danger" data-del="${t.id}">Delete</button>
              </div>
            </div>
          `).join("")}
      </div>
    </div>
  `;

  el.querySelector("#txnForm").addEventListener("submit", (ev)=>{
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const data = Object.fromEntries(fd.entries());
    if(!confirmEditPassword(txnEditingId ? "save changes" : "add this transaction")) return;
    data.amount = Number(data.amount)||0;
    data.modifiedAt = nowMs();
    let txns2 = loadTransactions();
    if(txnEditingId){
      txns2 = txns2.map(t => t.id===txnEditingId ? {...t, ...data} : t);
      toast("Transaction updated");
    }else{
      txns2 = [...txns2, {id: uid(), ...data}];
      toast("Transaction added");
    }
    saveTransactions(txns2);
    txnEditingId = null;
    renderAll();
  });

  const cancelBtn = el.querySelector("#cancelTxnEdit");
  if(cancelBtn) cancelBtn.addEventListener("click", ()=>{ txnEditingId=null; renderAll(); });

  el.querySelector("#txnMonthFilter").addEventListener("change", (ev)=>{
    txnFilterMonth = ev.target.value; renderAll();
  });

  el.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click", ()=>{
    txnEditingId = b.dataset.edit; renderAll(); el.scrollIntoView({behavior:"smooth"});
  }));
  el.querySelectorAll("[data-del]").forEach(b=>b.addEventListener("click", ()=>{
    if(!confirmEditPassword("delete this transaction")) return;
    recordTombstone(b.dataset.del);
    saveTransactions(loadTransactions().filter(t=>t.id!==b.dataset.del));
    toast("Transaction deleted");
    renderAll();
  }));
}

/* ================= DASHBOARD TAB ================= */
function renderDashboard(){
  const el = document.getElementById("dashboard");
  const income = loadIncome();
  const expenditure = loadExpenditure();

  const months = [...new Set([...income, ...expenditure].map(e=>monthKeyOf(e.date)))].sort().reverse();

  const totalIncome = income.reduce((s,e)=>s+(Number(e.amount)||0),0);
  const totalExp = expenditure.reduce((s,e)=>s+(Number(e.amount)||0),0);
  const netBalance = totalIncome - totalExp;

  const byMonth = months.slice(0,6).map(m=>{
    const inc = income.filter(e=>monthKeyOf(e.date)===m).reduce((s,e)=>s+(Number(e.amount)||0),0);
    const exp = expenditure.filter(e=>monthKeyOf(e.date)===m).reduce((s,e)=>s+(Number(e.amount)||0),0);
    return {m, inc, exp, net: inc-exp};
  });

  // top income items overall
  const incomeByItem = {};
  income.forEach(e=>{ incomeByItem[e.item] = (incomeByItem[e.item]||0) + (Number(e.amount)||0); });
  const topIncome = Object.entries(incomeByItem).sort((a,b)=>b[1]-a[1]).slice(0,5);

  // top 5 expenditure items overall, for the bar chart
  const expByItem = {};
  expenditure.forEach(e=>{ expByItem[e.item] = (expByItem[e.item]||0) + (Number(e.amount)||0); });
  const topExp = Object.entries(expByItem).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const maxExp = topExp.length ? topExp[0][1] : 0;

  el.innerHTML = `
    <div class="card">
      <h2>Overview (All Time)</h2>
      <div class="stat">Total Income <b class="amt-in">${naira(totalIncome)}</b></div>
      <div class="stat">Total Expenditure <b class="amt-out">${naira(totalExp)}</b></div>
      <div class="stat">Net Balance <b class="${netBalance>=0?'amt-in':'amt-out'}">${naira(netBalance)}</b></div>
      <div class="stat">Income Entries <b>${income.length}</b></div>
      <div class="stat">Expenditure Entries <b>${expenditure.length}</b></div>
    </div>

    ${byMonth.length ? `
    <div class="card">
      <h2>Recent Months</h2>
      ${byMonth.map(x=>`
        <div class="entrycard">
          <b>${monthLabel(x.m)}</b>
          <div class="meta">Income: <span class="amt-in">${naira(x.inc)}</span> • Expenditure: <span class="amt-out">${naira(x.exp)}</span></div>
          <div class="meta">Net: <b class="${x.net>=0?'amt-in':'amt-out'}">${naira(x.net)}</b></div>
        </div>
      `).join("")}
    </div>` : ""}

    ${topExp.length ? `
    <div class="card">
      <h2>Top 5 Expenditures</h2>
      ${topExp.map(([item,amt])=>{
        const pct = maxExp ? Math.max(4, Math.round((amt/maxExp)*100)) : 0;
        return `
          <div style="margin:10px 0;">
            <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px;">
              <span>${esc(item)}</span><b class="amt-out">${naira(amt)}</b>
            </div>
            <div style="background:rgba(255,255,255,.06);border-radius:6px;overflow:hidden;height:10px;">
              <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#a3213f,var(--out));border-radius:6px;"></div>
            </div>
          </div>`;
      }).join("")}
    </div>` : ""}

    ${topIncome.length ? `
    <div class="card">
      <h2>Top Income Sources</h2>
      ${topIncome.map(([item,amt])=>`<div class="stat">${esc(item)} <b>${naira(amt)}</b></div>`).join("")}
    </div>` : `<div class="card"><div class="empty">Add income entries to see totals here.</div></div>`}
  `;
}

/* ================= EXPORT TAB ================= */
function toCSV(rows){
  return rows.map(row => row.map(v=>{
    let s = (v===undefined||v===null) ? "" : String(v);
    if(s.includes(",") || s.includes('"') || s.includes("\n")) s = '"' + s.replace(/"/g,'""') + '"';
    return s;
  }).join(",")).join("\r\n");
}

function downloadCSV(filename, csvText){
  const base64 = btoa(unescape(encodeURIComponent(csvText)));
  const a = document.createElement("a");
  a.href = "data:text/csv;base64," + base64;
  a.setAttribute("download", filename);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function renderExport(){
  const el = document.getElementById("exportdata");
  const liveSupported = !!window.showSaveFilePicker;
  const liveOn = !!backupFileHandle;
  const lastText = lastBackupTime
    ? `Last saved ${lastBackupTime.toLocaleDateString()} ${lastBackupTime.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`
    : "Not backed up yet this session";

  const installed = isStandaloneDisplay();
  const canPromptInstall = !!deferredInstallPrompt;
  const iOS = isIOSDevice();
  const editProtectionOn = editPasswordEnabled();

  el.innerHTML = `
    <div class="card">
      <h2>Edit Protection</h2>
      <p style="font-size:12.5px;color:var(--muted);">
        When ON, a password is required before every Add, Edit, or Delete on any tab.
        Turning this OFF also requires the current password (so it can't be switched
        off by accident or by someone who doesn't know it).
      </p>
      <div class="stat"><span>Status</span> <b class="${editProtectionOn?'amt-in':'amt-out'}">${editProtectionOn ? "ON" : "OFF"}</b></div>
      <button class="btn ${editProtectionOn?'secondary':'gold'} small" id="toggleEditProtectionBtn">${editProtectionOn ? "Turn OFF" : "Turn ON"}</button>
    </div>

    <div class="card">
      <h2>Install This App</h2>
      ${installed
        ? `<p style="font-size:12.5px;color:var(--muted);">Already installed — you're running it as an app.</p>`
        : canPromptInstall
          ? `<p style="font-size:12.5px;color:var(--muted);">Tap the <b>⬇ Install App</b> button at the top of the screen for a full-screen app icon on your home screen, no browser bar.</p>`
          : iOS
            ? `<p style="font-size:12.5px;color:var(--muted);">On iPhone/iPad: tap the Share icon in Safari, then "Add to Home Screen".</p>`
            : `<p style="font-size:12.5px;color:var(--muted);">Open the browser menu (⋮) and choose "Install app" or "Add to Home screen". If you don't see that option, reload the page first.</p>`
      }
    </div>

    <div class="card">
      <h2>Live Backup (syncs as you work)</h2>
      <p style="font-size:12.5px;color:var(--muted);">
        ${liveSupported
          ? `Choose a backup file once — every entry you add, edit, or delete is written to it automatically, so you always have an up-to-date, human-readable copy.`
          : `This browser can't keep a file open for automatic syncing. Use "Download Backup Now" below after you finish working, or open this app in Chrome for automatic live backup.`}
      </p>
      <div class="stat"><span>Status</span> <b class="${liveOn?'amt-in':''}">${liveOn ? "Live backup ON" : "Live backup off"}</b></div>
      <div class="stat"><span>Last save</span> <b>${esc(lastText)}</b></div>
      ${liveSupported ? `<button class="btn gold" id="enableLiveBackupBtn">${liveOn ? "Choose a Different Backup File" : "Choose Backup File & Enable"}</button>` : ""}
    </div>

    <div class="card">
      <h2>Manual Backup</h2>
      <p style="font-size:12.5px;color:var(--muted);">Downloads one readable backup file (.json) with every Income, Expenditure and Cheque entry — open it in any text editor to read it, or restore it below.</p>
      <button class="btn" id="downloadBackupBtn">Download Backup Now</button>
      <label style="margin-top:14px;">Restore From Backup</label>
      <input type="file" id="restoreFileInput" accept=".json,application/json">
      <p style="font-size:11.5px;color:var(--muted);margin-top:6px;">Restoring replaces all data currently on this device with what's in the backup file.</p>
    </div>

    <div class="card">
      <h2>Export as CSV</h2>
      <p style="font-size:12.5px;color:var(--muted);">Exports save as a CSV file — open with Excel or Google Sheets, or share it.</p>
      <button class="btn secondary" id="exportIncomeBtn">Export Income (CSV)</button>
      <button class="btn secondary" id="exportExpBtn">Export Expenditure (CSV)</button>
      <button class="btn secondary" id="exportTxnBtn">Export Cheque Log (CSV)</button>
      <button class="btn secondary" id="exportBankBtn">Export Bank Calc (CSV)</button>
      <button class="btn secondary" id="exportBankAcct2Btn">Export Bank Account (CSV)</button>
      <button class="btn secondary" id="exportNotesBtn">Export Notes (CSV)</button>
      <button class="btn secondary" id="exportRemitBtn">Export Remittances (CSV)</button>
    </div>

    <div class="card">
      <h2>About this data</h2>
      <div class="stat"><span>App version</span> <b>${APP_VERSION}</b></div>
      <p style="font-size:12.5px;color:var(--muted);">All data lives only on this device (offline) unless you enable Live Backup, download a backup file, or set up Sync (see the Sync tab). Nothing is uploaded anywhere on its own.</p>
    </div>
  `;

  const liveBtn = document.getElementById("enableLiveBackupBtn");
  if(liveBtn) liveBtn.addEventListener("click", enableLiveBackup);

  document.getElementById("toggleEditProtectionBtn").addEventListener("click", ()=>{
    const turningOff = editPasswordEnabled();
    // Require the CURRENT password to change this either way — otherwise the
    // switch itself would be an unprotected way around the whole feature.
    const entered = prompt(`Enter password to turn Edit Protection ${turningOff ? "OFF" : "ON"}:`);
    if(entered === null) return;
    if(entered !== EDIT_PASSWORD){ toast("Incorrect password"); return; }
    setEditPasswordEnabled(!turningOff);
    toast(`Edit Protection turned ${turningOff ? "OFF" : "ON"}`);
    renderExport();
  });

  document.getElementById("downloadBackupBtn").addEventListener("click", downloadBackupNow);
  document.getElementById("restoreFileInput").addEventListener("change", (ev)=>{
    const file = ev.target.files && ev.target.files[0];
    if(file) restoreFromBackupFile(file);
    ev.target.value = "";
  });

  document.getElementById("exportIncomeBtn").addEventListener("click", ()=>{
    const rows = [["Date","Item","Amount","Method","Note"], ...loadIncome().map(e=>[e.date,e.item,e.amount,e.method,e.note])];
    downloadCSV("UBC_Income.csv", toCSV(rows));
    toast("Income exported to Downloads");
  });
  document.getElementById("exportExpBtn").addEventListener("click", ()=>{
    const rows = [["Date","Item","Amount","Method","Note"], ...loadExpenditure().map(e=>[e.date,e.item,e.amount,e.method,e.note])];
    downloadCSV("UBC_Expenditure.csv", toCSV(rows));
    toast("Expenditure exported to Downloads");
  });
  document.getElementById("exportTxnBtn").addEventListener("click", ()=>{
    const rows = [["Date","Particulars","Amount","Bank","Account Name","Cheque No."], ...loadTransactions().map(t=>[t.date,t.particulars,t.amount,t.bank,t.accountName,t.chequeNo])];
    downloadCSV("UBC_BankTransactions.csv", toCSV(rows));
    toast("Cheque log exported to Downloads");
  });
  document.getElementById("exportBankBtn").addEventListener("click", ()=>{
    const rows = [["Month","Amount"], ...loadBankFigures().map(b=>[bankFigureMonth(b), b.amount])];
    downloadCSV("UBC_BankAC.csv", toCSV(rows));
    toast("Bank Calc figures exported to Downloads");
  });
  document.getElementById("exportBankAcct2Btn").addEventListener("click", ()=>{
    const rows = [["Date","Direction","Category","Description","Amount","Note"],
      ...loadBankAccountEntries().map(b=>[b.date, b.direction==="in"?"Income":"Expenditure", b.category, b.direction==="in"&&b.category!=="Others"?"":(b.otherLabel||""), b.amount, b.note])];
    downloadCSV("UBC_BankAccount.csv", toCSV(rows));
    toast("Bank Account exported to Downloads");
  });
  document.getElementById("exportNotesBtn").addEventListener("click", ()=>{
    const rows = [["Date","Category","Description","Amount","Status"],
      ...loadNotes().map(n=>[n.date, n.category==="Other" && n.otherLabel ? n.otherLabel : n.category, n.description, n.amount||"", n.status||"Open"])];
    downloadCSV("UBC_Notes.csv", toCSV(rows));
    toast("Notes exported to Downloads");
  });
  document.getElementById("exportRemitBtn").addEventListener("click", ()=>{
    const typeLabel = k => (REMIT_TYPES.find(t=>t.key===k)||{}).label || k;
    const rows = [["Type","Year","Month"],
      ...loadRemittances()
        .sort((a,b)=> a.type.localeCompare(b.type) || a.year-b.year || (a.month||0)-(b.month||0))
        .map(r=>[typeLabel(r.type), r.year, r.month ? MONTH_NAMES[r.month-1] : "(yearly)"])];
    downloadCSV("UBC_Remittances.csv", toCSV(rows));
    toast("Remittances exported to Downloads");
  });
}

/* ================= REPORTS TAB (Monthly / Quarterly / Annual — PDF + Word) ================= */
let reportScope = "Month"; // "Month" | "Quarter" | "Year"
let reportPeriod = ""; // e.g. "2026-03" for Month, "2026-Q1" for Quarter, "2026" for Year

function periodMatches(dateStr, scope, period){
  if(!dateStr || !period) return false;
  if(scope === "Month") return monthKeyOf(dateStr) === period;
  if(scope === "Year") return dateStr.slice(0,4) === period;
  if(scope === "Quarter"){
    const [y,q] = period.split("-Q");
    const month = Number(dateStr.slice(5,7));
    const qNum = Math.ceil(month/3);
    return dateStr.slice(0,4)===y && String(qNum)===q;
  }
  return false;
}

function periodLabel(scope, period){
  if(!period) return "";
  if(scope === "Month") return monthLabel(period);
  if(scope === "Year") return period;
  if(scope === "Quarter"){
    const [y,q] = period.split("-Q");
    return `Q${q} ${y} (${["Jan-Mar","Apr-Jun","Jul-Sep","Oct-Dec"][q-1]})`;
  }
  return period;
}

function availablePeriods(scope, entries){
  const all = entries || [...loadIncome(), ...loadExpenditure()];
  const set = new Set();
  all.forEach(e=>{
    if(!e.date) return;
    if(scope==="Month") set.add(monthKeyOf(e.date));
    else if(scope==="Year") set.add(e.date.slice(0,4));
    else if(scope==="Quarter"){
      const y = e.date.slice(0,4);
      const q = Math.ceil(Number(e.date.slice(5,7))/3);
      set.add(`${y}-Q${q}`);
    }
  });
  return [...set].sort().reverse();
}

function periodStartDate(scope, period){
  if(scope==="Month") return period + "-01";
  if(scope==="Year") return period + "-01-01";
  if(scope==="Quarter"){
    const [y,q] = period.split("-Q");
    const startMonth = (Number(q)-1)*3 + 1;
    return `${y}-${String(startMonth).padStart(2,"0")}-01`;
  }
  return "0000-01-01";
}

// Cumulative net balance (all income minus all expenditure) from every entry
// dated before this report's period — i.e. the opening balance for the period.
// incomeAll/expenditureAll default to the main Cash Income/Expenditure tabs, but
// can be any {date, amount} array (e.g. the Bank Account tab's own entries).
function balanceBroughtForward(scope, period, incomeAll, expenditureAll){
  const startDate = periodStartDate(scope, period);
  const incSrc = incomeAll || loadIncome();
  const expSrc = expenditureAll || loadExpenditure();
  const income = incSrc.filter(e=>e.date && e.date < startDate).reduce((s,e)=>s+(Number(e.amount)||0),0);
  const expenditure = expSrc.filter(e=>e.date && e.date < startDate).reduce((s,e)=>s+(Number(e.amount)||0),0);
  return income - expenditure;
}

function remittanceMonthsInScope(scope, period){
  if(scope === "Month"){
    const [y,m] = period.split("-");
    return [{year: Number(y), month: Number(m)}];
  }
  if(scope === "Quarter"){
    const [y,q] = period.split("-Q");
    const startMonth = (Number(q)-1)*3 + 1;
    return [0,1,2].map(i=>({year:Number(y), month:startMonth+i}));
  }
  if(scope === "Year"){
    const y = Number(period);
    return Array.from({length:12}, (_,i)=>({year:y, month:i+1}));
  }
  return [];
}

// Short "Association Due: Paid — Jan, Feb" style lines for the report, covering
// whichever months/year the report's scope+period spans.
function remittanceReportLines(scope, period){
  const monthsInScope = remittanceMonthsInScope(scope, period);
  const year = monthsInScope.length ? monthsInScope[0].year : Number(String(period).slice(0,4));
  const all = loadRemittances();
  return REMIT_TYPES.map(t=>{
    if(t.yearly){
      if(scope !== "Year") return null; // yearly item only meaningful in an annual report
      const paid = all.some(r=>r.type===t.key && r.year===year && r.month===null);
      return `${t.label}: ${paid ? `Paid for ${year}` : `Not paid for ${year}`}`;
    }
    const paidMonths = monthsInScope
      .filter(({year,month}) => all.some(r=>r.type===t.key && r.year===year && r.month===month))
      .map(({month}) => MONTH_NAMES[month-1]);
    return `${t.label}: ${paidMonths.length ? "Paid — " + paidMonths.join(", ") : "Not paid"}`;
  }).filter(Boolean);
}

function bankAccountItemLabel(entry){
  return (entry.category==="Others" && entry.otherLabel) ? entry.otherLabel : entry.category;
}
function bankAccountIncomeAsEntries(){
  return loadBankAccountEntries().filter(e=>e.direction==="in").map(e=>({date:e.date, item:bankAccountItemLabel(e), amount:e.amount}));
}
function bankAccountExpenditureAsEntries(){
  return loadBankAccountEntries().filter(e=>e.direction==="out").map(e=>({date:e.date, item:bankAccountItemLabel(e), amount:e.amount}));
}
function buildBankAccountReportData(scope, period){
  return buildReportData(scope, period, {
    incomeAll: bankAccountIncomeAsEntries(),
    expenditureAll: bankAccountExpenditureAsEntries(),
    includeRemittances: false,
  });
}

function buildReportData(scope, period, opts){
  opts = opts || {};
  const incomeAll = opts.incomeAll || loadIncome();
  const expenditureAll = opts.expenditureAll || loadExpenditure();
  const income = incomeAll.filter(e=>periodMatches(e.date, scope, period));
  const expenditure = expenditureAll.filter(e=>periodMatches(e.date, scope, period));

  function groupByItem(entries){
    const map = {};
    entries.forEach(e=>{ map[e.item] = (map[e.item]||0) + (Number(e.amount)||0); });
    return Object.entries(map).sort((a,b)=>b[1]-a[1]);
  }

  const incomeGrouped = groupByItem(income);
  const expGrouped = groupByItem(expenditure);
  const incomeTotal = incomeGrouped.reduce((s,[,v])=>s+v, 0);
  const expTotal = expGrouped.reduce((s,[,v])=>s+v, 0);
  const netBalance = incomeTotal - expTotal;
  const broughtForward = balanceBroughtForward(scope, period, incomeAll, expenditureAll);

  return {
    incomeGrouped, expGrouped, incomeTotal, expTotal, netBalance,
    broughtForward, carriedForward: broughtForward + netBalance,
    remittanceLines: opts.includeRemittances===false ? [] : remittanceReportLines(scope, period),
  };
}

function renderReports(){
  const el = document.getElementById("reports");
  const periods = availablePeriods(reportScope);
  if(!reportPeriod || !periods.includes(reportPeriod)) reportPeriod = periods[0] || "";

  if(periods.length===0){
    el.innerHTML = `<div class="card"><div class="empty">Add some income or expenditure entries first — reports are built from those.</div></div>`;
    return;
  }

  const data = buildReportData(reportScope, reportPeriod);

  el.innerHTML = `
    <div class="card no-print">
      <h2>Monthly / Quarterly / Annual Report</h2>
      <div class="grid2">
        <div><label>Report Type</label>
          <select id="reportScopeSelect">
            <option ${reportScope==="Month"?"selected":""}>Month</option>
            <option ${reportScope==="Quarter"?"selected":""}>Quarter</option>
            <option ${reportScope==="Year"?"selected":""}>Year</option>
          </select>
        </div>
        <div><label>Period</label>
          <select id="reportPeriodSelect">
            ${periods.map(p=>`<option value="${p}" ${reportPeriod===p?"selected":""}>${periodLabel(reportScope,p)}</option>`).join("")}
          </select>
        </div>
      </div>
      <button class="btn" id="previewReportBtn">Preview &amp; Print</button>
      <button class="btn gold" id="downloadPdfBtn">Download as PDF</button>
      <button class="btn secondary" id="downloadDocxBtn">Download as Word (.docx)</button>
    </div>

    <div class="card" id="reportPreview">
      ${renderReportHTML(data, reportScope, reportPeriod)}
    </div>
  `;

  document.getElementById("reportScopeSelect").addEventListener("change", (e)=>{
    reportScope = e.target.value; reportPeriod = ""; renderReports();
  });
  document.getElementById("reportPeriodSelect").addEventListener("change", (e)=>{
    reportPeriod = e.target.value; renderReports();
  });
  document.getElementById("previewReportBtn").addEventListener("click", ()=>{
    openReportPreview({data, scope:reportScope, period:reportPeriod, reportLabel:"Financial Report", filePrefix:"UBC_Report"});
  });
  document.getElementById("downloadPdfBtn").addEventListener("click", async ()=>{
    const bytes = await buildReportPDF(data, reportScope, reportPeriod);
    const base64 = bytesToBase64(bytes);
    const a = document.createElement("a");
    a.href = "data:application/pdf;base64," + base64;
    a.setAttribute("download", `UBC_Report_${reportScope}_${reportPeriod}.pdf`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast("PDF report saved");
  });

  document.getElementById("downloadDocxBtn").addEventListener("click", async ()=>{
    const bytes = await buildReportDocx(data, reportScope, reportPeriod);
    const base64 = bytesToBase64(bytes);
    const a = document.createElement("a");
    a.href = "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64," + base64;
    a.setAttribute("download", `UBC_Report_${reportScope}_${reportPeriod}.docx`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast("Word report saved to Downloads");
  });
}

function renderReportHTML(data, scope, period, reportLabel){
  reportLabel = reportLabel || "Financial Report";
  return `
    <div style="text-align:center;margin-bottom:14px;">
      <img src="img/logo.jpg" alt="Church logo" style="width:80px;height:80px;border-radius:50%;margin-bottom:8px;">
      <h2 style="margin:0;">UNIVERSITY BAPTIST CHURCH, OTUOKE</h2>
      <p style="color:var(--muted);margin:2px 0 0;font-size:12px;">Kingdom Citizens · Est. Oct. 2015</p>
      <p style="color:var(--muted);margin:6px 0 0;">${scope}ly ${esc(reportLabel)} — ${esc(periodLabel(scope, period))}</p>
    </div>

    <div class="stat" style="margin-bottom:10px;">Balance Brought Forward <b>${naira(data.broughtForward)}</b></div>

    <div class="section-title">Income</div>
    <table>
      <tr><th>Item</th><th style="text-align:right;">Amount</th></tr>
      ${data.incomeGrouped.length===0 ? '<tr><td colspan="2" class="empty">No income recorded</td></tr>' :
        data.incomeGrouped.map(([item,amt])=>`<tr><td>${esc(item)}</td><td style="text-align:right;">${naira(amt)}</td></tr>`).join("")}
    </table>
    <div class="stat" style="margin-top:6px;">Total Income <b class="amt-in">${naira(data.incomeTotal)}</b></div>

    <div class="section-title" style="margin-top:16px;">Expenditure</div>
    <table>
      <tr><th>Item</th><th style="text-align:right;">Amount</th></tr>
      ${data.expGrouped.length===0 ? '<tr><td colspan="2" class="empty">No expenditure recorded</td></tr>' :
        data.expGrouped.map(([item,amt])=>`<tr><td>${esc(item)}</td><td style="text-align:right;">${naira(amt)}</td></tr>`).join("")}
    </table>
    <div class="stat" style="margin-top:6px;">Total Expenditure <b class="amt-out">${naira(data.expTotal)}</b></div>

    ${data.remittanceLines.length ? `
    <p style="font-size:11.5px;color:var(--muted);margin-top:10px;line-height:1.7;">
      ${data.remittanceLines.map(l=>esc(l)).join("<br>")}
    </p>` : ""}

    <div class="stat" style="margin-top:14px;font-size:16px;">Net Balance (this period) <b class="${data.netBalance>=0?'amt-in':'amt-out'}">${naira(data.netBalance)}</b></div>
    <div class="stat" style="margin-top:6px;font-size:16px;">Balance Carried Forward <b class="${data.carriedForward>=0?'amt-in':'amt-out'}">${naira(data.carriedForward)}</b></div>
  `;
}

const fmtN = v => Number(v).toLocaleString("en-NG"); // same thousands separators as the PDF/on-screen report
async function buildReportDocx(data, scope, period, reportLabel){
  reportLabel = reportLabel || "Financial Report";
  const incomeRows = data.incomeGrouped.length ? data.incomeGrouped.map(([item,amt])=>[item, fmtN(amt)]) : [["No income recorded",""]];
  const expRows = data.expGrouped.length ? data.expGrouped.map(([item,amt])=>[item, fmtN(amt)]) : [["No expenditure recorded",""]];
  return await buildDocx({
    title: "UNIVERSITY BAPTIST CHURCH, OTUOKE",
    subtitle: `Kingdom Citizens · Est. Oct. 2015 — ${scope}ly ${reportLabel} — ${periodLabel(scope, period)}`,
    broughtForward: fmtN(data.broughtForward),
    incomeRows, incomeTotal: fmtN(data.incomeTotal),
    expRows, expTotal: fmtN(data.expTotal),
    remittanceLines: data.remittanceLines,
    netBalance: fmtN(data.netBalance),
    carriedForward: fmtN(data.carriedForward),
  });
}

async function buildReportPDF(data, scope, period, reportLabel){
  reportLabel = reportLabel || "Financial Report";
  const logoBytes = await fetchLogoBytes();
  const doc = new PDFDoc({logoBytes, logoW: 640, logoH: 640});

  if(logoBytes) doc.logoImage(64, 64);
  doc.centerText("UNIVERSITY BAPTIST CHURCH, OTUOKE", {bold:true, size:16});
  doc.centerText("Kingdom Citizens - Est. Oct. 2015", {size:10});
  doc.centerText(`${scope}ly ${reportLabel} - ${periodLabel(scope, period)}`, {size:11});
  doc.space(10);
  doc.row("Balance Brought Forward", "NGN " + Number(data.broughtForward).toLocaleString("en-NG"), {bold:true});
  doc.space(10);

  doc.text(doc.marginX, "INCOME", {bold:true, size:13});
  doc.hr();
  if(data.incomeGrouped.length===0){
    doc.text(doc.marginX, "No income recorded", {size:10.5});
  }else{
    data.incomeGrouped.forEach(([item,amt])=> doc.row(item, "NGN " + Number(amt).toLocaleString("en-NG")));
  }
  doc.hr();
  doc.row("Total Income", "NGN " + Number(data.incomeTotal).toLocaleString("en-NG"), {bold:true});
  doc.space(14);

  doc.text(doc.marginX, "EXPENDITURE", {bold:true, size:13});
  doc.hr();
  if(data.expGrouped.length===0){
    doc.text(doc.marginX, "No expenditure recorded", {size:10.5});
  }else{
    data.expGrouped.forEach(([item,amt])=> doc.row(item, "NGN " + Number(amt).toLocaleString("en-NG")));
  }
  doc.hr();
  doc.row("Total Expenditure", "NGN " + Number(data.expTotal).toLocaleString("en-NG"), {bold:true});

  if(data.remittanceLines.length){
    doc.space(10);
    data.remittanceLines.forEach(line => doc.wrapText(line, {size:9}));
  }

  doc.space(16);
  doc.row("NET BALANCE (this period)", "NGN " + Number(data.netBalance).toLocaleString("en-NG"), {bold:true, size:12});
  doc.row("BALANCE CARRIED FORWARD", "NGN " + Number(data.carriedForward).toLocaleString("en-NG"), {bold:true, size:13});

  return doc.build();
}

/* ---------- Word (.docx) generation — pure JS, offline, no libraries (see zip-writer.js) ---------- */
function escXml(s){
  return String(s===undefined||s===null?"":s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]));
}
function docxParagraph(text, opts){
  opts = opts || {};
  const bold = opts.bold ? '<w:b/>' : '';
  const size = opts.size ? `<w:sz w:val="${opts.size}"/>` : '';
  const align = opts.center ? '<w:jc w:val="center"/>' : '';
  return `<w:p><w:pPr>${align}</w:pPr><w:r><w:rPr>${bold}${size}</w:rPr><w:t xml:space="preserve">${escXml(text)}</w:t></w:r></w:p>`;
}
function docxTable(headerRow, rows){
  const cellWidth = Math.floor(9000 / headerRow.length);
  function row(cells, bold){
    return `<w:tr>` + cells.map(c=>`<w:tc><w:tcPr><w:tcW w:w="${cellWidth}" w:type="dxa"/></w:tcPr><w:p><w:r>${bold?'<w:rPr><w:b/></w:rPr>':''}<w:t xml:space="preserve">${escXml(c)}</w:t></w:r></w:p></w:tc>`).join('') + `</w:tr>`;
  }
  let xml = `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders>
    <w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>
    <w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>
    <w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>
    <w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>
    <w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>
    <w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>
  </w:tblBorders></w:tblPr>`;
  xml += row(headerRow, true);
  rows.forEach(r => xml += row(r, false));
  xml += `</w:tbl>`;
  return xml;
}
function docxImageParagraph(relId, widthEmu, heightEmu){
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing>
    <wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">
      <wp:extent cx="${widthEmu}" cy="${heightEmu}"/>
      <wp:docPr id="1" name="Logo"/>
      <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:nvPicPr>
              <pic:cNvPr id="1" name="Logo"/>
              <pic:cNvPicPr/>
            </pic:nvPicPr>
            <pic:blipFill>
              <a:blip r:embed="${relId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
              <a:stretch><a:fillRect/></a:stretch>
            </pic:blipFill>
            <pic:spPr>
              <a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm>
              <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            </pic:spPr>
          </pic:pic>
        </a:graphicData>
      </a:graphic>
    </wp:inline>
  </w:drawing></w:r></w:p>`;
}

let _logoBytesCache = null;
async function fetchLogoBytes(){
  if(_logoBytesCache) return _logoBytesCache;
  try{
    const resp = await fetch("img/logo.jpg");
    const buf = await resp.arrayBuffer();
    _logoBytesCache = new Uint8Array(buf);
  }catch(e){
    _logoBytesCache = null; // report still generates fine without the logo if this fails
  }
  return _logoBytesCache;
}

async function buildDocx(opts){
  const {title, subtitle, broughtForward, incomeRows, incomeTotal, expRows, expTotal, remittanceLines, netBalance, carriedForward} = opts;
  const logoBytes = await fetchLogoBytes();
  const EMU_PER_INCH = 914400;
  const logoSize = Math.round(1.1 * EMU_PER_INCH);

  const bodyParts = [];
  if(logoBytes) bodyParts.push(docxImageParagraph("rId100", logoSize, logoSize));
  bodyParts.push(
    docxParagraph(title, {bold:true, size:32, center:true}),
    docxParagraph(subtitle, {center:true, size:22}),
    docxParagraph("", {}),
    docxParagraph(`Balance Brought Forward: NGN ${broughtForward}`, {bold:true}),
    docxParagraph("", {}),
    docxParagraph("INCOME", {bold:true, size:26}),
    docxTable(["Item","Amount (NGN)"], incomeRows),
    docxParagraph(`Total Income: NGN ${incomeTotal}`, {bold:true}),
    docxParagraph("", {}),
    docxParagraph("EXPENDITURE", {bold:true, size:26}),
    docxTable(["Item","Amount (NGN)"], expRows),
    docxParagraph(`Total Expenditure: NGN ${expTotal}`, {bold:true})
  );
  if(remittanceLines && remittanceLines.length){
    bodyParts.push(docxParagraph("", {}));
    remittanceLines.forEach(line => bodyParts.push(docxParagraph(line, {size:18})));
  }
  bodyParts.push(
    docxParagraph("", {}),
    docxParagraph(`NET BALANCE (this period): NGN ${netBalance}`, {bold:true, size:24}),
    docxParagraph(`BALANCE CARRIED FORWARD: NGN ${carriedForward}`, {bold:true, size:28})
  );
  const body = bodyParts.join("");

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body>
</w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${logoBytes ? '<Default Extension="jpeg" ContentType="image/jpeg"/>' : ''}
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const files = [
    {name: "[Content_Types].xml", content: contentTypes},
    {name: "_rels/.rels", content: rootRels},
    {name: "word/document.xml", content: documentXml}
  ];

  if(logoBytes){
    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId100" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.jpeg"/>
</Relationships>`;
    files.push({name: "word/_rels/document.xml.rels", content: docRels});
    files.push({name: "word/media/logo.jpeg", content: logoBytes});
  }

  return buildZip(files);
}

/* ================= FLOATING QUICK-ADD BUTTON =================
   Lets you log an Income or Expenditure entry from any tab without leaving
   it — opens a small modal, saves through the same functions the Income/
   Expenditure tabs use, so everything (Summary bar, Dashboard, Dues, Sync)
   updates immediately, same as adding it the normal way. */
function quickAddItemsFor(kind){
  const fixed = kind==="income" ? INCOME_ITEMS : EXPENDITURE_ITEMS;
  const custom = loadCustomItems(kind);
  return [...fixed, ...custom];
}

function refreshQuickAddItemOptions(){
  const kind = document.getElementById("quickAddKind").value;
  const itemSelect = document.getElementById("quickAddItem");
  itemSelect.innerHTML = quickAddItemsFor(kind).map(i=>`<option>${esc(i)}</option>`).join("");
}

function openQuickAdd(){
  const overlay = document.getElementById("quickAddOverlay");
  document.getElementById("quickAddDate").value = todayISO();
  document.getElementById("quickAddKind").value = "income";
  refreshQuickAddItemOptions();
  overlay.style.display = "flex";
}
function closeQuickAdd(){
  document.getElementById("quickAddOverlay").style.display = "none";
  document.getElementById("quickAddForm").reset();
}

function initQuickAdd(){
  const btn = document.getElementById("quickAddBtn");
  const overlay = document.getElementById("quickAddOverlay");
  const form = document.getElementById("quickAddForm");
  if(!btn || !overlay || !form) return;

  btn.addEventListener("click", openQuickAdd);
  document.getElementById("quickAddCancel").addEventListener("click", closeQuickAdd);
  overlay.addEventListener("click", (ev)=>{ if(ev.target===overlay) closeQuickAdd(); });
  document.getElementById("quickAddKind").addEventListener("change", refreshQuickAddItemOptions);

  form.addEventListener("submit", (ev)=>{
    ev.preventDefault();
    const fd = new FormData(form);
    const data = Object.fromEntries(fd.entries());
    if(!confirmEditPassword("add this entry")) return;
    const kind = data.kind;
    delete data.kind;
    data.amount = Number(data.amount)||0;
    data.modifiedAt = nowMs();
    const entry = {id: uid(), ...data};
    if(kind==="income"){
      saveIncome([...loadIncome(), entry]);
    }else{
      saveExpenditure([...loadExpenditure(), entry]);
    }
    toast(`${kind==="income"?"Income":"Expenditure"} entry added`);
    closeQuickAdd();
    renderAll();
  });
}

/* ================= REPORT PREVIEW =================
   A white "paper" view of the report, laid out like the PDF, shown BEFORE printing or saving.
   Used by every report (the main Financial Report and the Bank Account Report). Printing from
   here prints exactly this sheet and nothing else (see the @media print rules in index.html). */
let pvCurrent = null;

function renderPaperReportHTML(data, scope, period, reportLabel){
  const n = v => "NGN " + Number(v).toLocaleString("en-NG");
  const row = (label, value, bold) => `<div class="pv-row${bold?" pv-bold":""}"><span>${esc(label)}</span><span>${esc(value)}</span></div>`;
  const list = (pairs, emptyText) => pairs.length
    ? pairs.map(([item,amt]) => row(item, n(amt))).join("")
    : `<div class="pv-empty">${emptyText}</div>`;
  return `
    <div class="pv-head">
      <img src="img/logo.jpg" alt="">
      <div class="pv-name">UNIVERSITY BAPTIST CHURCH, OTUOKE</div>
      <div class="pv-est">Kingdom Citizens · Est. Oct. 2015</div>
      <div class="pv-sub">${esc(scope)}ly ${esc(reportLabel)} — ${esc(periodLabel(scope, period))}</div>
    </div>
    ${row("Balance Brought Forward", n(data.broughtForward), true)}

    <div class="pv-h">INCOME</div>
    ${list(data.incomeGrouped, "No income recorded")}
    <div class="pv-rule"></div>
    ${row("Total Income", n(data.incomeTotal), true)}

    <div class="pv-h">EXPENDITURE</div>
    ${list(data.expGrouped, "No expenditure recorded")}
    <div class="pv-rule"></div>
    ${row("Total Expenditure", n(data.expTotal), true)}

    ${data.remittanceLines.length ? `<div class="pv-note">${data.remittanceLines.map(l=>esc(l)).join("<br>")}</div>` : ""}

    <div class="pv-final">
      ${row("NET BALANCE (this period)", n(data.netBalance), true)}
      ${row("BALANCE CARRIED FORWARD", n(data.carriedForward), true)}
    </div>
  `;
}

function openReportPreview(cfg){
  pvCurrent = cfg;
  document.getElementById("pvTitle").textContent = "Preview — " + cfg.scope + "ly " + cfg.reportLabel + " — " + periodLabel(cfg.scope, cfg.period);
  document.getElementById("pvPaper").innerHTML = renderPaperReportHTML(cfg.data, cfg.scope, cfg.period, cfg.reportLabel);
  document.getElementById("pvOverlay").classList.add("show");
  document.body.classList.add("pv-open");
  document.querySelector("#pvOverlay .pv-scroll").scrollTop = 0;
  // so the phone's Back button closes the preview instead of leaving the app
  try{ history.pushState({pv:1}, ""); }catch(e){}
}
function hideReportPreview(){
  document.getElementById("pvOverlay").classList.remove("show");
  document.body.classList.remove("pv-open");
  pvCurrent = null;
}
function closeReportPreview(){
  if(history.state && history.state.pv){ history.back(); } // popstate handler hides it
  else hideReportPreview();
}
function pvDownload(bytes, mime, filename){
  const a = document.createElement("a");
  a.href = "data:" + mime + ";base64," + bytesToBase64(bytes);
  a.setAttribute("download", filename);
  document.body.appendChild(a);
  a.click();
  a.remove();
}
function initReportPreview(){
  document.getElementById("pvClose").addEventListener("click", closeReportPreview);
  window.addEventListener("popstate", hideReportPreview);
  document.addEventListener("keydown", (ev)=>{ if(ev.key==="Escape" && pvCurrent) closeReportPreview(); });
  document.getElementById("pvPrint").addEventListener("click", ()=>{
    if(!pvCurrent) return;
    if(window.AndroidPrint && window.AndroidPrint.print){
      window.AndroidPrint.print(pvCurrent.filePrefix + "_" + pvCurrent.scope + "_" + pvCurrent.period);
    }else{
      window.print(); // browser's print dialog — choose "Save as PDF" there if you prefer
    }
  });
  document.getElementById("pvPdf").addEventListener("click", async ()=>{
    if(!pvCurrent) return;
    const c = pvCurrent;
    const bytes = await buildReportPDF(c.data, c.scope, c.period, c.reportLabel);
    pvDownload(bytes, "application/pdf", `${c.filePrefix}_${c.scope}_${c.period}.pdf`);
    toast("PDF report saved");
  });
  document.getElementById("pvDocx").addEventListener("click", async ()=>{
    if(!pvCurrent) return;
    const c = pvCurrent;
    const bytes = await buildReportDocx(c.data, c.scope, c.period, c.reportLabel);
    pvDownload(bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", `${c.filePrefix}_${c.scope}_${c.period}.docx`);
    toast("Word report saved to Downloads");
  });
}

/* ---------- Boot ---------- */
applyRemittanceBackfillOnce();
renderAll();
initQuickAdd();
initReportPreview();
