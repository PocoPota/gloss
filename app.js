// gloss — static frontend: PDF viewer + on-selection translation.
// No backend. Provider APIs are called directly from the browser using a
// per-user API key that stays in this device.

import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
import { protect, restore, normalizeSelection } from "./protect.js";
import { providers, providerOrder } from "./translate.js";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

// ---------- Storage ----------
// All keys are prefixed `gloss:` and scoped to this origin.
const ENGINE_PREF_KEY = "gloss:engine:v1";
const SAVE_PREF_KEY   = "gloss:save-keys:v1";
const KEY_PREFIX      = "gloss:key:";

function savePrefEnabled() {
  try { return localStorage.getItem(SAVE_PREF_KEY) === "1"; } catch { return false; }
}

// Keys: always in memory; optionally mirrored to localStorage.
const memKeys = new Map();

function loadKeysFromStorage() {
  if (!savePrefEnabled()) return;
  for (const name of providerOrder) {
    try {
      const v = localStorage.getItem(KEY_PREFIX + name);
      if (v) memKeys.set(name, v);
    } catch { /* ignore */ }
  }
}

function setSavePref(enabled) {
  try {
    localStorage.setItem(SAVE_PREF_KEY, enabled ? "1" : "0");
    if (enabled) {
      // Mirror current in-memory keys to storage.
      for (const [name, val] of memKeys) {
        localStorage.setItem(KEY_PREFIX + name, val);
      }
    } else {
      // Wipe persisted keys; memory keys remain for this session.
      for (const name of providerOrder) localStorage.removeItem(KEY_PREFIX + name);
    }
  } catch { /* ignore */ }
}

function setKey(name, value) {
  memKeys.set(name, value);
  if (savePrefEnabled()) {
    try { localStorage.setItem(KEY_PREFIX + name, value); } catch { /* ignore */ }
  }
}

function getKey(name) { return memKeys.get(name) || null; }

function deleteKey(name) {
  memKeys.delete(name);
  try { localStorage.removeItem(KEY_PREFIX + name); } catch { /* ignore */ }
}

function keySource(name) {
  if (!memKeys.has(name)) return null;
  try {
    if (savePrefEnabled() && localStorage.getItem(KEY_PREFIX + name)) return "storage";
  } catch { /* ignore */ }
  return "memory";
}

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const fileInput         = $("file");
const engineSel         = $("engine");
const zoomSel           = $("zoom");
const pagesEl           = $("pages");
const viewerEl          = $("viewer");
const dropHint          = $("drop-hint");
const docMeta           = $("doc-meta");
const currentEl         = $("current");
const historyEl         = $("history");
const cacheStat         = $("cache-stat");
const clearHistoryBtn   = $("clear-history");
const openSettingsBtn   = $("open-settings");
const settingsBackdrop  = $("settings-backdrop");
const closeSettingsBtn  = $("close-settings");
const settingsForm      = $("settings-form");
const settingsStatus    = $("settings-status");
const savePrefCheckbox  = $("save-pref");
const wipeAllBtn        = $("wipe-all");

// ---------- State ----------
let currentPdf = null;
let currentEngine = "echo";
let selectionSeq = 0;
let currentAborter = null;
let currentLoadingEntry = null;
const translationCache = new Map(); // memory only — wiped on reload

const cacheKey = (engine, text) => `${engine}\0${text}`;

function updateCacheStat() {
  cacheStat.textContent = translationCache.size ? `このセッション ${translationCache.size}件` : "";
}

// ---------- Engines ----------
function computeDefaultEngine() {
  for (const n of providerOrder) {
    if (n === "echo") continue;
    if (getKey(n)) return n;
  }
  return "echo";
}

function renderEngineSelect() {
  engineSel.innerHTML = "";
  for (const name of providerOrder) {
    const p = providers[name];
    const opt = document.createElement("option");
    opt.value = name;
    const ready = !p.needsKey || getKey(name) != null;
    opt.textContent = ready ? p.label : `${p.label} (未設定)`;
    opt.disabled = !ready && name !== "echo";
    engineSel.appendChild(opt);
  }
  const saved = safeLocalGet(ENGINE_PREF_KEY);
  const usable = (n) => {
    const p = providers[n];
    return p && (!p.needsKey || getKey(n) != null);
  };
  const pick = (saved && usable(saved)) ? saved : computeDefaultEngine();
  engineSel.value = pick;
  currentEngine = engineSel.value;
}

function safeLocalGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeLocalSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

engineSel.addEventListener("change", () => {
  currentEngine = engineSel.value;
  safeLocalSet(ENGINE_PREF_KEY, currentEngine);
});

// ---------- File input / drop ----------
fileInput.addEventListener("change", (ev) => {
  const f = ev.target.files?.[0];
  if (f) openPdf(f);
});

viewerEl.addEventListener("dragover", (ev) => {
  ev.preventDefault();
  viewerEl.classList.add("dragover");
});
viewerEl.addEventListener("dragleave", (ev) => {
  if (ev.target === viewerEl) viewerEl.classList.remove("dragover");
});
viewerEl.addEventListener("drop", (ev) => {
  ev.preventDefault();
  viewerEl.classList.remove("dragover");
  const f = ev.dataTransfer?.files?.[0];
  if (f && f.type === "application/pdf") openPdf(f);
});

async function openPdf(file) {
  docMeta.textContent = `${file.name} — 読込中…`;
  pagesEl.innerHTML = "";
  dropHint.hidden = true;
  try {
    const buf = await file.arrayBuffer();
    currentPdf = await pdfjsLib.getDocument({ data: buf }).promise;
    docMeta.textContent = `${file.name} — ${currentPdf.numPages}ページ`;
    await renderAllPages();
  } catch (e) {
    console.error(e);
    docMeta.textContent = `エラー: ${e.message}`;
    dropHint.hidden = false;
  }
}

async function renderAllPages() {
  pagesEl.innerHTML = "";
  const scale = parseFloat(zoomSel.value);
  for (let i = 1; i <= currentPdf.numPages; i++) {
    const pageEl = await renderPage(i, scale);
    pagesEl.appendChild(pageEl);
  }
}

zoomSel.addEventListener("change", () => { if (currentPdf) renderAllPages(); });

async function renderPage(pageNum, scale) {
  const page = await currentPdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const container = document.createElement("div");
  container.className = "page";
  container.style.width = `${viewport.width}px`;
  container.style.height = `${viewport.height}px`;

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  container.appendChild(canvas);

  const textLayerDiv = document.createElement("div");
  textLayerDiv.className = "textLayer";
  textLayerDiv.style.width = `${viewport.width}px`;
  textLayerDiv.style.height = `${viewport.height}px`;
  textLayerDiv.style.setProperty("--scale-factor", String(scale));
  container.appendChild(textLayerDiv);

  const ctx = canvas.getContext("2d");
  const renderTask = page.render({ canvasContext: ctx, viewport });
  const [, textContent] = await Promise.all([
    renderTask.promise,
    page.getTextContent(),
  ]);

  const textLayer = new pdfjsLib.TextLayer({
    textContentSource: textContent,
    container: textLayerDiv,
    viewport,
  });
  await textLayer.render();

  return container;
}

// ---------- Selection → translate ----------
let selTimer = null;
let lastDispatchedText = "";

function scheduleSelectionCheck() {
  clearTimeout(selTimer);
  selTimer = setTimeout(handleSelection, 120);
}

document.addEventListener("mouseup", scheduleSelectionCheck);
document.addEventListener("keyup", (ev) => {
  if (ev.shiftKey || ev.key === "Shift" || ev.key.startsWith("Arrow") || ev.key === "Home" || ev.key === "End") {
    scheduleSelectionCheck();
  }
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && settingsBackdrop.hidden) {
    cancelPending();
    window.getSelection()?.removeAllRanges();
  }
});

function cancelInFlight() {
  if (currentAborter) { currentAborter.abort(); currentAborter = null; }
  if (currentLoadingEntry) { removeHistoryEntry(currentLoadingEntry); currentLoadingEntry = null; }
  setCurrent("", false);
}
function cancelPending() {
  clearTimeout(selTimer); selTimer = null;
  cancelInFlight();
  lastDispatchedText = "";
}

function selectionInsideViewer(sel) {
  if (!sel.rangeCount) return false;
  const inside = (n) => {
    for (let el = n; el; el = el.parentNode) {
      if (el.classList && el.classList.contains("textLayer")) return true;
    }
    return false;
  };
  return inside(sel.anchorNode) && inside(sel.focusNode);
}

async function handleSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return;
  if (!selectionInsideViewer(sel)) return;
  const rawText = sel.toString();
  const text = normalizeSelection(rawText);
  if (text.length < 2) return;
  if (text === lastDispatchedText) return;
  lastDispatchedText = text;

  const myId = ++selectionSeq;
  const engine = currentEngine;
  await translateAndRecord(text, engine, myId);
}

async function translateAndRecord(text, engine, id) {
  cancelInFlight();
  const provider = providers[engine];
  if (!provider) return;

  const key = cacheKey(engine, text);
  setCurrent(`翻訳中: ${truncate(text, 80)}  (Escで解除)`, true);

  if (translationCache.has(key)) {
    const tr = translationCache.get(key);
    if (id !== selectionSeq) return;
    pushHistory({ text, translated: tr, engine, cached: true });
    setCurrent("", false);
    return;
  }

  const entry = pushHistory({ text, translated: "", engine, loading: true });
  currentLoadingEntry = entry;
  const aborter = new AbortController();
  currentAborter = aborter;

  const t0 = performance.now();
  try {
    if (provider.needsKey && !getKey(engine)) {
      throw new Error(`${provider.label} のAPIキーが未設定です (⚙から設定)`);
    }
    const pr = protect(text);
    const translatedRaw = await provider.translate({
      text: pr.text,
      apiKey: getKey(engine),
      signal: aborter.signal,
    });
    const translated = restore(translatedRaw, pr.tokens);
    if (id !== selectionSeq) {
      translationCache.set(key, translated);
      updateCacheStat();
      removeHistoryEntry(entry);
      return;
    }
    const ms = Math.round(performance.now() - t0);
    updateHistoryEntry(entry, { translated, loading: false, elapsedMs: ms });
    translationCache.set(key, translated);
    updateCacheStat();
  } catch (err) {
    if (err.name === "AbortError") return;
    updateHistoryEntry(entry, {
      translated: `翻訳エラー: ${err.message}`,
      loading: false,
      error: true,
    });
  } finally {
    if (currentAborter === aborter) {
      currentAborter = null;
      currentLoadingEntry = null;
    }
    if (id === selectionSeq) setCurrent("", false);
  }
}

// ---------- UI helpers ----------
function setCurrent(msg, active) {
  currentEl.textContent = msg;
  currentEl.classList.toggle("active", !!active);
}
function truncate(s, n) { return s.length > n ? s.slice(0, n) + "…" : s; }

function pushHistory({ text, translated, engine, cached = false, loading = false, error = false, elapsedMs }) {
  const li = document.createElement("li");
  if (loading) li.classList.add("loading");
  li.dataset.engine = engine;

  const head = document.createElement("div");
  head.className = "head";
  const timeEl = document.createElement("span");
  timeEl.className = "time";
  timeEl.textContent = new Date().toLocaleTimeString();
  const badge = document.createElement("span");
  badge.className = "badge" + (cached ? " cache" : "") + (error ? " err" : "");
  badge.textContent = error
    ? "ERR"
    : cached
    ? `cache · ${engine}`
    : engine + (elapsedMs != null ? ` · ${elapsedMs}ms` : "");
  head.appendChild(timeEl);
  head.appendChild(badge);

  const src = document.createElement("div");
  src.className = "src";
  src.textContent = text;
  src.title = "クリックで全文表示";
  src.addEventListener("click", () => src.classList.toggle("expanded"));

  const tr = document.createElement("div");
  tr.className = "tr";
  tr.textContent = translated;

  li.appendChild(head);
  li.appendChild(src);
  li.appendChild(tr);
  historyEl.prepend(li);
  return li;
}

function updateHistoryEntry(li, { translated, loading, error, elapsedMs }) {
  if (!li) return;
  const tr = li.querySelector(".tr");
  const badge = li.querySelector(".badge");
  if (translated != null) tr.textContent = translated;
  li.classList.toggle("loading", !!loading);
  if (error) { badge.classList.add("err"); badge.textContent = "ERR"; }
  else if (elapsedMs != null) {
    badge.textContent = `${li.dataset.engine} · ${elapsedMs}ms`;
  }
}
function removeHistoryEntry(li) { li?.parentNode?.removeChild(li); }

// ---------- Clear history ----------
clearHistoryBtn.addEventListener("click", () => {
  if (!historyEl.children.length && translationCache.size === 0) return;
  if (!confirm("履歴をクリアします。よろしいですか？")) return;
  historyEl.innerHTML = "";
  translationCache.clear();
  updateCacheStat();
  setCurrent("", false);
});

// ---------- Settings modal ----------
openSettingsBtn.addEventListener("click", openSettings);
closeSettingsBtn.addEventListener("click", closeSettings);
settingsBackdrop.addEventListener("click", (ev) => {
  if (ev.target === settingsBackdrop) closeSettings();
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !settingsBackdrop.hidden) {
    closeSettings();
    ev.stopImmediatePropagation();
  }
});

function openSettings() {
  settingsBackdrop.hidden = false;
  setSettingsStatus("");
  savePrefCheckbox.checked = savePrefEnabled();
  renderSettings();
}
function closeSettings() { settingsBackdrop.hidden = true; }
function setSettingsStatus(msg, cls = "") {
  settingsStatus.textContent = msg;
  settingsStatus.className = "muted " + cls;
}

savePrefCheckbox.addEventListener("change", () => {
  setSavePref(savePrefCheckbox.checked);
  renderSettings();
  setSettingsStatus(
    savePrefCheckbox.checked
      ? "保存を有効化しました。キーはこのブラウザに残ります。"
      : "保存を無効化しました。保存済みキーを削除しました (メモリ上のキーは維持)。",
    "ok"
  );
});

wipeAllBtn.addEventListener("click", () => {
  if (!confirm("すべてのAPIキーをメモリとブラウザ保存の両方から削除します。続けますか？")) return;
  for (const name of providerOrder) deleteKey(name);
  renderSettings();
  renderEngineSelect();
  setSettingsStatus("すべてのキーを削除しました。", "ok");
});

function renderSettings() {
  settingsForm.innerHTML = "";
  for (const name of providerOrder) {
    const p = providers[name];
    if (!p.needsKey) continue;
    settingsForm.appendChild(renderEngineRow(p));
  }
}

function renderEngineRow(p) {
  const wrap = document.createElement("div");
  wrap.className = "setting";

  const head = document.createElement("div");
  head.className = "setting-head";
  const title = document.createElement("div");
  title.className = "setting-title";
  title.textContent = p.label;
  head.appendChild(title);

  const source = keySource(p.name);
  const status = document.createElement("span");
  status.className = "setting-status " + (source ? "ok" : "off");
  status.textContent = source === "storage"
    ? "保存済み"
    : source === "memory"
    ? "このセッション"
    : "未設定";
  head.appendChild(status);
  wrap.appendChild(head);

  const row = document.createElement("div");
  row.className = "setting-row";
  const input = document.createElement("input");
  input.type = "password";
  input.placeholder = source ? "新しいキーで上書き…" : `${p.envVar} を入力`;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); onSave(); }
  });
  row.appendChild(input);

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "primary";
  saveBtn.textContent = "保存";
  saveBtn.addEventListener("click", onSave);
  row.appendChild(saveBtn);

  if (source) {
    const del = document.createElement("button");
    del.type = "button";
    del.className = "ghost danger";
    del.textContent = "削除";
    del.addEventListener("click", () => {
      if (!confirm(`${p.label} のキーを削除しますか？`)) return;
      deleteKey(p.name);
      renderSettings();
      renderEngineSelect();
      setSettingsStatus(`${p.name}: 削除しました`, "ok");
    });
    row.appendChild(del);
  }
  wrap.appendChild(row);

  if (p.helpUrl) {
    const link = document.createElement("a");
    link.href = p.helpUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.className = "setting-link";
    link.textContent = "APIキーを取得 →";
    wrap.appendChild(link);
  }

  function onSave() {
    const key = (input.value || "").trim();
    if (!key) { setSettingsStatus(`${p.name}: キーを入力してください`, "err"); return; }
    setKey(p.name, key);
    input.value = "";
    renderSettings();
    renderEngineSelect();
    setSettingsStatus(
      savePrefEnabled()
        ? `${p.name}: 保存しました (このブラウザに残ります)`
        : `${p.name}: 設定しました (このセッションのみ)`,
      "ok"
    );
  }

  return wrap;
}

// ---------- Init ----------
loadKeysFromStorage();
updateCacheStat();
renderEngineSelect();
