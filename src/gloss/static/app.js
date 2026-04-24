// gloss frontend: PDF.js viewer + on-selection translation.

import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const fileInput = $("file");
const engineSel = $("engine");
const zoomSel = $("zoom");
const pagesEl = $("pages");
const viewerEl = $("viewer");
const dropHint = $("drop-hint");
const docMeta = $("doc-meta");
const currentEl = $("current");
const historyEl = $("history");
const cacheStat = $("cache-stat");
const clearHistoryBtn = $("clear-history");
const openSettingsBtn = $("open-settings");
const settingsBackdrop = $("settings-backdrop");
const closeSettingsBtn = $("close-settings");
const settingsForm = $("settings-form");
const settingsStatus = $("settings-status");

// ---------- State ----------
let currentPdf = null;            // pdfjs document proxy
let currentDocName = "";
let currentEngine = "echo";
let selectionSeq = 0;             // monotonic id for inflight selection translations
let currentAborter = null;        // AbortController for the currently-active fetch
let currentLoadingEntry = null;   // <li> of the in-progress history card
const translationCache = new Map(); // key = `${engine}\0${text}` → translated

// ---------- Local persistence keys ----------
const CACHE_KEY = "gloss:cache:v1";
const ENGINE_PREF_KEY = "gloss:engine:v1";
const CACHE_MAX = 500;

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    for (const [k, v] of Object.entries(obj)) translationCache.set(k, v);
  } catch (e) {
    console.warn("cache load failed", e);
  }
  updateCacheStat();
}

function saveCache() {
  // Trim to CACHE_MAX most recent entries (insertion order).
  const entries = Array.from(translationCache.entries());
  const trimmed = entries.slice(-CACHE_MAX);
  const obj = Object.fromEntries(trimmed);
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
  } catch (e) {
    console.warn("cache save failed", e);
  }
}

function cacheKey(engine, text) { return `${engine}\0${text}`; }

function updateCacheStat() {
  cacheStat.textContent = `キャッシュ ${translationCache.size}件`;
}

// ---------- Engines ----------
async function loadEngines() {
  try {
    const res = await fetch("/api/engines");
    const data = await res.json();
    engineSel.innerHTML = "";
    for (const e of data.engines) {
      const opt = document.createElement("option");
      opt.value = e.name;
      opt.textContent = e.ready ? e.name : `${e.name} (未設定: ${e.reason})`;
      opt.disabled = !e.ready && e.name !== "echo";
      engineSel.appendChild(opt);
    }
    // Prefer the user's last choice if still usable; otherwise fall back to
    // the server-computed default (first configured engine → echo).
    const saved = localStorage.getItem(ENGINE_PREF_KEY);
    const usable = (name) => {
      const e = data.engines.find((x) => x.name === name);
      return e && (e.ready || e.name === "echo");
    };
    const pick = (saved && usable(saved)) ? saved : data.default;
    engineSel.value = pick;
    currentEngine = engineSel.value;
  } catch (err) {
    console.error(err);
  }
}

engineSel.addEventListener("change", () => {
  currentEngine = engineSel.value;
  localStorage.setItem(ENGINE_PREF_KEY, currentEngine);
});

// ---------- File input / drop ----------
fileInput.addEventListener("change", (ev) => {
  const f = ev.target.files?.[0];
  if (f) openPdf(f);
});

// Highlight the whole viewer on dragover (works with or without drop-hint visible).
viewerEl.addEventListener("dragover", (ev) => {
  ev.preventDefault();
  viewerEl.classList.add("dragover");
});
viewerEl.addEventListener("dragleave", (ev) => {
  // dragleave fires on child elements too — only clear when leaving the viewer itself.
  if (ev.target === viewerEl) viewerEl.classList.remove("dragover");
});
viewerEl.addEventListener("drop", (ev) => {
  ev.preventDefault();
  viewerEl.classList.remove("dragover");
  const f = ev.dataTransfer?.files?.[0];
  if (f && f.type === "application/pdf") openPdf(f);
});

async function openPdf(file) {
  currentDocName = file.name;
  docMeta.textContent = `${file.name} — 読込中…`;
  pagesEl.innerHTML = "";
  dropHint.hidden = true;
  try {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    currentPdf = pdf;
    docMeta.textContent = `${file.name} — ${pdf.numPages}ページ`;
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

zoomSel.addEventListener("change", () => {
  if (currentPdf) renderAllPages();
});

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
  // Required by PDF.js v4 TextLayer — positions are computed relative to this.
  textLayerDiv.style.setProperty("--scale-factor", String(scale));
  container.appendChild(textLayerDiv);

  const ctx = canvas.getContext("2d");
  const renderTask = page.render({ canvasContext: ctx, viewport });
  const [_render, textContent] = await Promise.all([
    renderTask.promise,
    page.getTextContent(),
  ]);

  // PDF.js v4+: TextLayer class replaces the removed renderTextLayer() helper.
  const textLayer = new pdfjsLib.TextLayer({
    textContentSource: textContent,
    container: textLayerDiv,
    viewport,
  });
  await textLayer.render();

  return container;
}

// ---------- Selection handler ----------
//
// Fire translation only when the user COMMITS the selection — i.e. releases
// the mouse / lifts the key. `selectionchange` fires continuously while
// dragging (even when the user pauses to think), which caused premature
// translations of half-complete selections.
//
// We debounce lightly (120ms) to collapse bursts of events (e.g. shift+click
// that emits both keyup and mouseup).
let selTimer = null;
let lastDispatchedText = "";

function scheduleSelectionCheck() {
  clearTimeout(selTimer);
  selTimer = setTimeout(handleSelection, 120);
}

document.addEventListener("mouseup", scheduleSelectionCheck);
document.addEventListener("keyup", (ev) => {
  // Only care about keys that can modify a selection.
  if (ev.shiftKey || ev.key === "Shift" || ev.key.startsWith("Arrow") || ev.key === "Home" || ev.key === "End") {
    scheduleSelectionCheck();
  }
});

// Esc → cancel pending/in-flight translation and clear selection.
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    cancelPending();
    window.getSelection()?.removeAllRanges();
  }
});

function cancelInFlight() {
  if (currentAborter) {
    currentAborter.abort();
    currentAborter = null;
  }
  if (currentLoadingEntry) {
    removeHistoryEntry(currentLoadingEntry);
    currentLoadingEntry = null;
  }
  setCurrent("", false);
}

function cancelPending() {
  clearTimeout(selTimer);
  selTimer = null;
  cancelInFlight();
  lastDispatchedText = "";
}

// Only translate selections that started inside a text layer.
function selectionInsideViewer(sel) {
  if (!sel.rangeCount) return false;
  const anchor = sel.anchorNode;
  const focus = sel.focusNode;
  const inside = (n) => {
    for (let el = n; el; el = el.parentNode) {
      if (el.classList && el.classList.contains("textLayer")) return true;
    }
    return false;
  };
  return inside(anchor) && inside(focus);
}

async function handleSelection() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return;
  if (!selectionInsideViewer(sel)) return;
  const text = sel.toString().trim();
  if (text.length < 2) return;
  // Skip if this exact text was just dispatched (e.g. mouseup after a keyup on same range).
  if (text === lastDispatchedText) return;
  lastDispatchedText = text;

  const myId = ++selectionSeq;
  const engine = currentEngine;
  await translateAndRecord(text, engine, myId);
}

async function translateAndRecord(text, engine, id) {
  // A newer selection arrives — cancel anything currently in flight.
  cancelInFlight();

  const key = cacheKey(engine, text);
  setCurrent(`翻訳中: ${truncate(text, 80)}  (Escで解除)`, true);

  // Cache hit: instant.
  if (translationCache.has(key)) {
    const tr = translationCache.get(key);
    if (id !== selectionSeq) return;
    pushHistory({ text, translated: tr, engine, cached: true });
    setCurrent("", false);
    return;
  }

  // Provisional history entry (loading state).
  const entry = pushHistory({ text, translated: "", engine, loading: true });
  currentLoadingEntry = entry;
  const aborter = new AbortController();
  currentAborter = aborter;

  try {
    const res = await fetch("/api/translate-text", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, engine }),
      signal: aborter.signal,
    });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (id !== selectionSeq) {
      // A newer selection superseded this one — still cache the result.
      translationCache.set(key, data.translated);
      updateCacheStat();
      saveCache();
      removeHistoryEntry(entry);
      return;
    }
    updateHistoryEntry(entry, {
      translated: data.translated,
      loading: false,
      elapsedMs: data.elapsed_ms,
    });
    translationCache.set(key, data.translated);
    updateCacheStat();
    saveCache();
  } catch (err) {
    if (err.name === "AbortError") {
      // User pressed Esc or a newer selection aborted us — card already removed.
      return;
    }
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

function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function pushHistory({ text, translated, engine, cached = false, loading = false, error = false, elapsedMs }) {
  const li = document.createElement("li");
  if (loading) li.classList.add("loading");
  li.dataset.text = text;
  li.dataset.engine = engine;

  const head = document.createElement("div");
  head.className = "head";
  const timeEl = document.createElement("span");
  timeEl.className = "time";
  timeEl.textContent = new Date().toLocaleTimeString();
  const badge = document.createElement("span");
  badge.className = "badge" + (cached ? " cache" : "") + (error ? " err" : "");
  badge.textContent = error ? "ERR" : cached ? `cache · ${engine}` : engine + (elapsedMs != null ? ` · ${elapsedMs}ms` : "");
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
  if (error) badge.classList.add("err");
  if (elapsedMs != null && !error) {
    badge.textContent = `${li.dataset.engine} · ${elapsedMs}ms`;
  }
  if (error) badge.textContent = "ERR";
}

function removeHistoryEntry(li) {
  if (li && li.parentNode) li.parentNode.removeChild(li);
}

// ---------- Clear history ----------
clearHistoryBtn.addEventListener("click", () => {
  if (!confirm("履歴とキャッシュをクリアします。よろしいですか？")) return;
  historyEl.innerHTML = "";
  translationCache.clear();
  localStorage.removeItem(CACHE_KEY);
  updateCacheStat();
  setCurrent("", false);
});

// ---------- Settings modal ----------
openSettingsBtn.addEventListener("click", () => openSettings());
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

async function openSettings() {
  settingsBackdrop.hidden = false;
  setSettingsStatus("");
  await renderSettings();
}
function closeSettings() {
  settingsBackdrop.hidden = true;
}
function setSettingsStatus(msg, cls = "") {
  settingsStatus.textContent = msg;
  settingsStatus.className = "muted " + cls;
}

async function renderSettings() {
  settingsForm.innerHTML = "<div class='muted'>読み込み中…</div>";
  try {
    const res = await fetch("/api/config");
    const data = await res.json();
    settingsForm.innerHTML = "";
    for (const eng of data.engines) {
      settingsForm.appendChild(renderEngineRow(eng));
    }
  } catch (err) {
    settingsForm.innerHTML = `<div class='err-msg'>設定の読み込みに失敗しました: ${err.message}</div>`;
  }
}

function renderEngineRow(eng) {
  const wrap = document.createElement("div");
  wrap.className = "setting";

  const head = document.createElement("div");
  head.className = "setting-head";
  const title = document.createElement("div");
  title.className = "setting-title";
  title.textContent = eng.label;
  head.appendChild(title);

  const status = document.createElement("span");
  status.className = "setting-status " + (eng.configured ? "ok" : "off");
  status.textContent = eng.configured
    ? (eng.source === "env" ? "環境変数で設定済み" : "キーチェーンに保存済み")
    : "未設定";
  head.appendChild(status);
  wrap.appendChild(head);

  const row = document.createElement("div");
  row.className = "setting-row";
  const input = document.createElement("input");
  input.type = "password";
  input.placeholder = eng.configured && eng.source === "keychain"
    ? "新しいキーで上書き…"
    : `${eng.env_var} を入力`;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); saveKey(eng.engine, input.value); }
  });
  row.appendChild(input);

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = "保存";
  save.addEventListener("click", () => saveKey(eng.engine, input.value));
  row.appendChild(save);

  if (eng.configured && eng.source === "keychain") {
    const del = document.createElement("button");
    del.type = "button";
    del.className = "ghost danger";
    del.textContent = "削除";
    del.addEventListener("click", () => deleteKey(eng.engine));
    row.appendChild(del);
  }
  wrap.appendChild(row);

  if (eng.source === "env") {
    const note = document.createElement("p");
    note.className = "setting-note";
    note.textContent = `環境変数 ${eng.env_var} が設定されています。キーチェーンより優先されます。`;
    wrap.appendChild(note);
  }

  if (eng.help_url) {
    const link = document.createElement("a");
    link.href = eng.help_url;
    link.target = "_blank";
    link.rel = "noopener";
    link.className = "setting-link";
    link.textContent = "APIキーを取得 →";
    wrap.appendChild(link);
  }
  return wrap;
}

async function saveKey(engine, key) {
  key = (key || "").trim();
  if (!key) {
    setSettingsStatus(`${engine}: キーを入力してください`, "err");
    return;
  }
  setSettingsStatus(`${engine}: 保存中…`);
  try {
    const res = await fetch(`/api/config/${encodeURIComponent(engine)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: key }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || `${res.status}`);
    }
    setSettingsStatus(`${engine}: 保存しました`, "ok");
    await renderSettings();
    await loadEngines();
  } catch (err) {
    setSettingsStatus(`${engine}: ${err.message}`, "err");
  }
}

async function deleteKey(engine) {
  if (!confirm(`${engine} のAPIキーをキーチェーンから削除しますか？`)) return;
  setSettingsStatus(`${engine}: 削除中…`);
  try {
    const res = await fetch(`/api/config/${encodeURIComponent(engine)}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`${res.status}`);
    setSettingsStatus(`${engine}: 削除しました`, "ok");
    await renderSettings();
    await loadEngines();
  } catch (err) {
    setSettingsStatus(`${engine}: ${err.message}`, "err");
  }
}

// ---------- Init ----------
loadCache();
loadEngines();
