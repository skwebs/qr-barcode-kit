(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const HISTORY_KEY = "qr-scanner-history-v1";
  const SETTINGS_KEY = "qr-scanner-settings-v2";
  let settings = { vibrate: true, suppressDuplicates: true, retention: 200, confirmLeave: true };
  let lastScannedText = "";
  let lastScannedAt = 0;
  let generatedCanvas = null;

  try { settings = { ...settings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; } catch (_) {}

  // PWA service worker: do not block scanner startup if registration is unavailable.
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(err => console.warn("PWA offline setup unavailable", err)));
  }

  function readHistory() {
    try {
      const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      return Array.isArray(value) ? value.filter(x => x && typeof x.text === "string" && typeof x.id === "string") : [];
    } catch (_) { return []; }
  }
  function writeHistory(rows) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(rows)); return true; }
    catch (_) { window.toast?.("Storage is full. Export history or delete old records."); return false; }
  }
  function csvEscape(v) { return '"' + String(v ?? "").replace(/"/g, '""') + '"'; }
  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function exportRows(format) {
    const rows = readHistory();
    if (format === "json") {
      downloadBlob(new Blob([JSON.stringify({ schemaVersion: 2, exportedAt: new Date().toISOString(), records: rows }, null, 2)], { type: "application/json" }), "qr-scanner-history.json");
    } else {
      const header = ["id","text","type","source","timestamp","favorite","notes"];
      const lines = [header.map(csvEscape).join(","), ...rows.map(r => header.map(k => csvEscape(r[k])).join(","))];
      downloadBlob(new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), "qr-scanner-history.csv");
    }
  }

  // Upgrade history records in place without discarding existing records.
  function migrateRecords() {
    const rows = readHistory().map(r => ({
      ...r,
      type: r.type || classifyText(r.text),
      favorite: Boolean(r.favorite),
      notes: typeof r.notes === "string" ? r.notes : "",
      normalizedValue: r.normalizedValue || r.text
    })).slice(0, Number(settings.retention) || 200);
    writeHistory(rows);
  }
  function classifyText(text) {
    const v = String(text).trim();
    if (/^https?:\/\/\S+/i.test(v)) return "URL";
    if (/^WIFI:/i.test(v)) return "WI-FI";
    if (/^(BEGIN:VCARD|MECARD:)/i.test(v)) return "CONTACT";
    if (/^mailto:/i.test(v)) return "EMAIL";
    if (/^tel:/i.test(v)) return "PHONE";
    if (/^(sms:|smsto:)/i.test(v)) return "SMS";
    if (/^geo:/i.test(v)) return "LOCATION";
    if (/^(upi:|bitcoin:)/i.test(v)) return "PAYMENT";
    if (/^BEGIN:VEVENT/i.test(v)) return "CALENDAR";
    return "TEXT";
  }

  function enhanceHistory() {
    const list = $("historyList");
    if (!list || list.dataset.enhanced) return;
    list.dataset.enhanced = "true";
    const originalRender = window.renderHistory;
    // Re-render using safe DOM APIs. Never inject QR payloads as HTML.
    window.renderHistory = function () {
      const all = readHistory();
      const q = ($("historySearch")?.value || "").trim().toLowerCase();
      const type = $("historyFilter")?.value || "all";
      const rows = all.filter(r => (type === "all" || (r.type || classifyText(r.text)) === type) &&
        (!q || [r.text, r.type, r.source, r.notes].some(x => String(x || "").toLowerCase().includes(q))));
      $("historyCount").textContent = `${rows.length} of ${all.length} saved scan${all.length === 1 ? "" : "s"}`;
      list.replaceChildren();
      if (!rows.length) {
        const empty = document.createElement("div"); empty.className = "empty-history";
        const strong = document.createElement("strong"); strong.textContent = all.length ? "No matching scans" : "No scan history yet";
        const p = document.createElement("p"); p.textContent = all.length ? "Try another search or filter." : "QR codes you scan will appear here.";
        empty.append(strong, p); list.append(empty); return;
      }
      rows.forEach(record => {
        const row = document.createElement("article"); row.className = "history-row";
        const icon = document.createElement("div"); icon.className = "history-icon";
        const i = document.createElement("i"); i.className = "fa-solid fa-qrcode"; icon.append(i);
        const detail = document.createElement("div"); detail.className = "history-detail";
        const txt = document.createElement("div"); txt.className = "history-text"; txt.textContent = record.text;
        const meta = document.createElement("div"); meta.className = "history-meta";
        meta.textContent = `${record.type || classifyText(record.text)} · ${record.source || "Camera"} · ${new Date(record.timestamp).toLocaleString()}`;
        detail.append(txt, meta);
        if (record.notes) { const note = document.createElement("div"); note.className = "history-meta"; note.textContent = "Note: " + record.notes; detail.append(note); }
        const fav = document.createElement("button"); fav.className = "favorite-btn" + (record.favorite ? " active" : "");
        fav.setAttribute("aria-label", record.favorite ? "Remove favorite" : "Add favorite");
        fav.innerHTML = '<i class="fa-solid fa-star"></i>';
        fav.addEventListener("click", () => updateRecord(record.id, r => ({...r, favorite: !r.favorite})));
        const actions = document.createElement("div"); actions.style.display = "flex"; actions.style.flexDirection = "column"; actions.style.gap = "5px";
        const open = document.createElement("button"); open.className = "history-open"; open.type = "button"; open.setAttribute("aria-label", "View scan result"); open.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
        open.addEventListener("click", () => {
          $("historyScreen").classList.add("hidden");
          if (window.state) window.state.detected = false;
          window.showResult?.(record.text, "History");
          if (!window.showResult) { $("resultValue").textContent = record.text; $("resultType").textContent = record.type || classifyText(record.text); $("resultModal").classList.remove("hidden"); }
        });
        const note = document.createElement("button"); note.className = "note-btn"; note.textContent = "Note";
        note.addEventListener("click", () => { const value = prompt("Add a note for this scan:", record.notes || ""); if (value !== null) updateRecord(record.id, r => ({...r, notes: value.slice(0, 1000)})); });
        const del = document.createElement("button"); del.className = "note-btn"; del.textContent = "Delete";
        del.addEventListener("click", () => { if (confirm("Delete this scan record?")) { writeHistory(readHistory().filter(r => r.id !== record.id)); window.renderHistory(); } });
        actions.append(open, note, del); row.append(icon, detail, fav, actions); list.append(row);
      });
    };
    function updateRecord(id, fn) { writeHistory(readHistory().map(r => r.id === id ? fn(r) : r)); window.renderHistory(); }
    $("historySearch")?.addEventListener("input", () => window.renderHistory());
    $("historyFilter")?.addEventListener("change", () => window.renderHistory());
    // Add settings access without crowding the scanner controls.
    const topbar = document.querySelector(".topbar > div:last-child");
    if (topbar) {
      const btn = document.createElement("button"); btn.className = "icon-btn"; btn.id = "settingsBtnInline";
      btn.setAttribute("aria-label", "Settings"); btn.title = "Settings"; btn.innerHTML = '<i class="fa-solid fa-gear"></i>';
      topbar.prepend(btn); btn.addEventListener("click", openSettings);
    }
  }

  function openSettings() {
    $("vibrateSetting").checked = settings.vibrate;
    $("duplicateSetting").checked = settings.suppressDuplicates;
    $("retentionSetting").value = String(settings.retention || 200);
    if ($("confirmLeaveSetting")) $("confirmLeaveSetting").checked = settings.confirmLeave !== false;
    $("settingsModal").classList.remove("hidden");
  }
  function closeSettings() { $("settingsModal").classList.add("hidden"); }
  let generatorMode = "qr";
  function setMainTab(tab) {
    const result = $("resultModal");
    if (result && !result.classList.contains("hidden")) {
      result.classList.add("hidden");
      if (window.state) { window.state.currentResult = null; window.state.detected = false; }
    }
    const generator = tab === "generator";
    $("scannerTab").setAttribute("aria-selected", String(!generator));
    $("generatorTab").setAttribute("aria-selected", String(generator));
    if (generator) {
      $("createModal").classList.remove("hidden");
      $("createModal").classList.add("generator-tab-view");
      // Stop camera use while generating, but leave the bottom tabs accessible.
      if (window.stopCamera) window.stopCamera();
      $("createTitle").textContent = "Create code";
      scheduleQrPreview(0);
    } else {
      $("createModal").classList.add("hidden");
      $("createModal").classList.remove("generator-tab-view");
      clearTimeout(qrDebounceTimer);
      // Do not force a permission prompt again; retry remains available if needed.
      if (window.state?.running) return;
      if ($("permissionScreen").classList.contains("hidden") && window.startCamera) window.startCamera();
    }
  }
  function openCreator() { setMainTab("generator"); }
  function closeCreator() { setMainTab("scanner"); }
  function currentPayload() {
    return $("qrPayload").value.trim();
  }
  let qrLibraryPromise = null;
  function loadQrLibrary() {
    if (typeof window.qrcode === "function") return Promise.resolve(window.qrcode);
    if (qrLibraryPromise) return qrLibraryPromise;
    // This is qrcode-generator (API: qrcode(), addData(), make(), isDark()),
    // not the different npm package named "qrcode" (API: toCanvas()).
    const sources = [
      "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js",
      "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js",
      "https://unpkg.com/qrcode-generator@1.4.4/qrcode.js"
    ];
    qrLibraryPromise = (async () => {
      for (const src of sources) {
        try {
          await new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = src;
            script.async = true;
            script.onload = () => typeof window.qrcode === "function"
              ? resolve()
              : reject(new Error("Loaded script did not expose qrcode()"));
            script.onerror = () => { script.remove(); reject(new Error("Could not load " + src)); };
            document.head.appendChild(script);
          });
          return window.qrcode;
        } catch (error) {
          console.warn("QR generator CDN failed:", src, error);
        }
      }
      throw new Error("QR generator library could not load. Connect to the internet and retry.");
    })().finally(() => {
      if (typeof window.qrcode !== "function") qrLibraryPromise = null;
    });
    return qrLibraryPromise;
  }

  let qrDebounceTimer = null;
  let qrRenderVersion = 0;
  let lastRenderedPayload = "";

  function setQrStatus(message, isError = false) {
    const status = $("qrStatus");
    if (status) {
      status.textContent = message;
      status.style.color = isError ? "#ff9b9b" : "";
    }
  }

  function showQrPlaceholder(message) {
    const target = $("qrGenerated");
    target.replaceChildren();
    const placeholder = document.createElement("div");
    placeholder.className = "qr-placeholder";
    placeholder.textContent = message;
    target.append(placeholder);
    generatedCanvas = null;
    lastRenderedPayload = "";
    $("downloadQrBtn").disabled = true;
    $("shareQrBtn").disabled = true;
  }

  function scheduleQrPreview(delay = 300) {
    clearTimeout(qrDebounceTimer);
    const payload = currentPayload();
    if (!payload) {
      ++qrRenderVersion;
      showQrPlaceholder("Enter text below to create a QR code");
      setQrStatus("Waiting for text…");
      return;
    }
    setQrStatus("Preview updates as you type…");
    qrDebounceTimer = setTimeout(() => generateQr(payload), delay);
  }

  async function generateQr(payload = currentPayload()) {
    if (generatorMode === "barcode") return generateBarcode(payload);
    const version = ++qrRenderVersion;
    const target = $("qrGenerated");
    if (!payload) {
      showQrPlaceholder("Enter text below to create a QR code");
      setQrStatus("Waiting for text…");
      return;
    }
    if (payload === lastRenderedPayload && generatedCanvas) return;

    setQrStatus("Generating preview…");
    try {
      const qrcode = await loadQrLibrary();
      // Ignore outdated requests when the user types again while the library loads.
      if (version !== qrRenderVersion || payload !== currentPayload()) return;

      const qr = qrcode(0, "M");
      qr.addData(payload);
      qr.make();

      const moduleCount = qr.getModuleCount();
      const margin = 2;
      const outputSize = 560;
      const totalModules = moduleCount + margin * 2;
      const cellSize = outputSize / totalModules;
      const canvas = document.createElement("canvas");
      canvas.width = outputSize;
      canvas.height = outputSize;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", "Generated QR code");
      const ctx = canvas.getContext("2d", { alpha: false });
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, outputSize, outputSize);
      ctx.fillStyle = "#111111";
      for (let row = 0; row < moduleCount; row++) {
        for (let col = 0; col < moduleCount; col++) {
          if (qr.isDark(row, col)) {
            const x = Math.round((col + margin) * cellSize);
            const y = Math.round((row + margin) * cellSize);
            const right = Math.round((col + margin + 1) * cellSize);
            const bottom = Math.round((row + margin + 1) * cellSize);
            ctx.fillRect(x, y, right - x, bottom - y);
          }
        }
      }
      if (version !== qrRenderVersion || payload !== currentPayload()) return;
      canvas.style.display = "block";
      canvas.style.width = "min(280px, 100%)";
      canvas.style.height = "auto";
      canvas.style.imageRendering = "pixelated";
      target.replaceChildren(canvas);
      generatedCanvas = canvas;
      lastRenderedPayload = payload;
      $("downloadQrBtn").disabled = false;
      $("shareQrBtn").disabled = false;
      setQrStatus("QR preview updated.");
    } catch (error) {
      if (version !== qrRenderVersion) return;
      showQrPlaceholder("QR code could not be generated");
      setQrStatus(error.message || "QR library unavailable. Check the CDN connection and retry.", true);
    }
  }

  let barcodeLibraryPromise = null;
  async function loadBarcodeLibrary() {
    if (window.JsBarcode) return window.JsBarcode;
    if (!barcodeLibraryPromise) barcodeLibraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/jsbarcode@3.12.1/dist/JsBarcode.all.min.js";
      script.onload = () => window.JsBarcode ? resolve(window.JsBarcode) : reject(new Error("Barcode library did not initialize."));
      script.onerror = () => { script.remove(); reject(new Error("Barcode library unavailable. Check your internet connection.")); };
      document.head.appendChild(script);
    }).catch(error => { barcodeLibraryPromise = null; throw error; });
    return barcodeLibraryPromise;
  }
  async function generateBarcode(payload = currentPayload()) {
    const version = ++qrRenderVersion;
    const target = $("qrGenerated");
    if (!payload) { showQrPlaceholder("Enter text below to create a barcode"); setQrStatus("Waiting for text…"); return; }
    setQrStatus("Generating barcode preview…");
    try {
      const JsBarcode = await loadBarcodeLibrary();
      if (version !== qrRenderVersion || payload !== currentPayload()) return;
      const format = $("barcodeFormat").value;
      const canvas = document.createElement("canvas");
      canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", "Generated barcode");
      JsBarcode(canvas, payload, { format, displayValue: true, margin: 12, height: 100, width: 2, background: "#ffffff", lineColor: "#111111", font: "monospace", valid: valid => { if (!valid) throw new Error("Invalid value for " + format + ". Check the required digits/format."); } });
      if (version !== qrRenderVersion || payload !== currentPayload()) return;
      canvas.style.display = "block"; canvas.style.width = "min(100%, 360px)"; canvas.style.height = "auto";
      target.replaceChildren(canvas); generatedCanvas = canvas; lastRenderedPayload = payload;
      $("downloadQrBtn").disabled = false; $("shareQrBtn").disabled = false;
      setQrStatus("Barcode preview updated.");
    } catch (error) {
      if (version !== qrRenderVersion) return;
      showQrPlaceholder("Barcode could not be generated"); setQrStatus(error.message || "Could not generate barcode.", true);
    }
  }
  function setGeneratorMode(mode) {
    generatorMode = mode;
    const isQr = mode === "qr";
    $("makeQrMode").className = isQr ? "btn-accent" : "btn-outline";
    $("makeBarcodeMode").className = isQr ? "btn-outline" : "btn-accent";
    $("makeQrMode").setAttribute("aria-pressed", String(isQr));
    $("makeBarcodeMode").setAttribute("aria-pressed", String(!isQr));
    $("barcodeFormatLabel").style.display = isQr ? "none" : "block";
    $("barcodeFormat").style.display = isQr ? "none" : "block";
    $("createTitle").textContent = isQr ? "Create QR code" : "Create barcode";
    lastRenderedPayload = ""; generatedCanvas = null;
    scheduleQrPreview(0);
  }

  function installEnhancements() {
    migrateRecords(); enhanceHistory();
    $("scannerTab")?.addEventListener("click", () => setMainTab("scanner"));
    $("generatorTab")?.addEventListener("click", () => setMainTab("generator"));
    $("makeQrMode")?.addEventListener("click", () => setGeneratorMode("qr"));
    $("makeBarcodeMode")?.addEventListener("click", () => setGeneratorMode("barcode"));
    $("barcodeFormat")?.addEventListener("change", () => { lastRenderedPayload = ""; scheduleQrPreview(0); });
    $("createQrBtn")?.addEventListener("click", openCreator);
    $("closeCreateBtn")?.addEventListener("click", closeCreator);
    $("closeCreateFooterBtn")?.addEventListener("click", closeCreator);
    $("qrPayload")?.addEventListener("input", () => scheduleQrPreview(300));
    $("downloadQrBtn")?.addEventListener("click", () => {
      if (generatedCanvas) generatedCanvas.toBlob(blob => blob && downloadBlob(blob, generatorMode === "qr" ? "qr-code.png" : "barcode.png"));
    });
    $("shareQrBtn")?.addEventListener("click", async () => {
      if (!generatedCanvas) return;
      generatedCanvas.toBlob(async blob => {
        if (!blob) return;
        try {
          const filename = generatorMode === "qr" ? "qr-code.png" : "barcode.png";
          const file = new File([blob], filename, {type:"image/png"});
          if (navigator.canShare?.({files:[file]})) await navigator.share({files:[file], title: generatorMode === "qr" ? "QR code" : "Barcode"});
          else downloadBlob(blob, filename);
        } catch (e) { if (e.name !== "AbortError") downloadBlob(blob, generatorMode === "qr" ? "qr-code.png" : "barcode.png"); }
      });
    });
    $("closeSettingsBtn")?.addEventListener("click", closeSettings);
    $("saveSettingsBtn")?.addEventListener("click", () => {
      settings.vibrate = $("vibrateSetting").checked;
      settings.suppressDuplicates = $("duplicateSetting").checked;
      settings.retention = Number($("retentionSetting").value) || 200;
      settings.confirmLeave = $("confirmLeaveSetting") ? $("confirmLeaveSetting").checked : true;
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) {}
      writeHistory(readHistory().slice(0, settings.retention)); closeSettings(); window.renderHistory?.();
      window.toast?.("Settings saved.");
    });
    $("exportJsonBtn")?.addEventListener("click", () => exportRows("json"));
    $("exportCsvBtn")?.addEventListener("click", () => exportRows("csv"));
    $("importHistoryBtn")?.addEventListener("click", () => $("importHistoryInput").click());
    $("importHistoryInput")?.addEventListener("change", async e => {
      const file = e.target.files?.[0]; if (!file) return;
      try {
        if (file.size > 5 * 1024 * 1024) throw new Error("Import file must be under 5 MB.");
        const data = JSON.parse(await file.text());
        const incoming = Array.isArray(data) ? data : data.records;
        if (!Array.isArray(incoming)) throw new Error("This file does not contain a valid history export.");
        const valid = incoming.filter(r => r && typeof r.text === "string" && r.text.length <= 10000).map(r => ({
          id: typeof r.id === "string" ? r.id : crypto.randomUUID(),
          text: r.text, type: classifyText(r.text), source: String(r.source || "Import").slice(0, 40),
          timestamp: Number.isFinite(Date.parse(r.timestamp)) ? new Date(r.timestamp).toISOString() : new Date().toISOString(),
          favorite: Boolean(r.favorite), notes: typeof r.notes === "string" ? r.notes.slice(0,1000) : ""
        }));
        const old = readHistory(), map = new Map([...valid, ...old].map(r => [r.id, r]));
        writeHistory([...map.values()].slice(0, settings.retention));
        window.renderHistory?.(); alert(`Imported ${valid.length} valid record(s).`);
      } catch (err) { alert(err.message || "Could not import this file."); }
      finally { e.target.value = ""; }
    });

    // Respect configured retention when legacy scanner saves new records.
    const originalSave = window.saveScan;
    if (typeof originalSave === "function") {
      window.saveScan = function (text, source) {
        if (settings.suppressDuplicates && text === lastScannedText && Date.now() - lastScannedAt < 1800) return;
        lastScannedText = text; lastScannedAt = Date.now();
        originalSave(text, source);
        const rows = readHistory().slice(0, settings.retention);
        writeHistory(rows);
        if (settings.vibrate && navigator.vibrate) navigator.vibrate(35);
      };
    }
    // Expose one batch handler to the existing gallery control.
    window.handleBatchGallery = async function (files) {
      const input = $("galleryInput");
      if (files.length > 30) { alert("Choose up to 30 images per batch."); input.value = ""; return; }
      if (typeof Html5Qrcode === "undefined") { alert("QR decoder library is unavailable."); input.value = ""; return; }
      if (window.stopCamera) await window.stopCamera();
      let found = 0, failed = 0;
      for (const file of files) {
        if (!file.type.startsWith("image/") || file.size > 20*1024*1024) { failed++; continue; }
        try {
          const decoder = new Html5Qrcode("reader", { verbose:false });
          const text = await decoder.scanFile(file, false);
          const rows = readHistory();
          rows.unshift({ id: (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2)), text, type: classifyText(text), source:"Batch gallery", timestamp:new Date().toISOString(), favorite:false, notes:"" });
          writeHistory(rows.slice(0, settings.retention)); found++;
        } catch (_) { failed++; }
      }
      input.value = ""; window.renderHistory?.();
      alert(`Batch complete: ${found} QR code(s) found; ${failed} image(s) skipped or unreadable.`);
      if (window.startCamera && $("historyScreen").classList.contains("hidden")) window.startCamera();
    };

  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", installEnhancements);
  else installEnhancements();
})();