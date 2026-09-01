(function initializeAdminPortal(global) {
  "use strict";

  const PRODUCTS = ["HopeSojourns", "JoshBeyondBorders", "ChristianSteps", "Unassigned"];
  const PRODUCT_LABELS = {
    HopeSojourns: "Hope Sojourns",
    JoshBeyondBorders: "Josh Beyond Borders",
    ChristianSteps: "Christian Steps",
    Unassigned: "Needs review",
  };
  const state = { csrfToken: "", page: 1, pages: 1, years: [], toastTimer: 0, transactionRequest: 0, selectedTransactions: new Set(), currentEligibleIds: [] };
  const byId = id => document.getElementById(id);

  function setBusy(isBusy, label = "Working…") {
    byId("loading-label").textContent = label;
    byId("loading-overlay").hidden = !isBusy;
  }

  function toast(message, duration = 4_500) {
    clearTimeout(state.toastTimer);
    const element = byId("toast");
    element.textContent = message;
    element.hidden = false;
    state.toastTimer = setTimeout(() => { element.hidden = true; }, duration);
  }

  async function api(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const isRead = method === "GET" || method === "HEAD";
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");
    if (isRead) {
      headers.set("Cache-Control", "no-cache");
      headers.set("Pragma", "no-cache");
    }
    if (state.csrfToken && method !== "GET" && method !== "HEAD") headers.set("X-CSRF-Token", state.csrfToken);
    let body = options.body;
    if (body && typeof body !== "string") {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(body);
    }
    const url = new URL(`/api/admin${path}`, global.location.origin);
    if (isRead) url.searchParams.set("_fresh", String(Date.now()));
    const response = await fetch(url, {
      ...options,
      method,
      headers,
      body,
      credentials: "same-origin",
      cache: isRead ? "no-store" : options.cache,
    });
    const text = await response.text();
    let result = {};
    try { result = text ? JSON.parse(text) : {}; } catch { result = {}; }
    if (!response.ok) {
      if (response.status === 401 && path !== "/login") showLogin();
      throw new Error(result.error || "The Admin Portal could not complete this request.");
    }
    return result;
  }

  function showLogin() {
    state.csrfToken = "";
    byId("portal-view").hidden = true;
    byId("login-view").hidden = false;
    byId("login-password").value = "";
    byId("login-password").focus();
  }

  function showPortal(session) {
    state.csrfToken = session.csrfToken;
    byId("login-view").hidden = true;
    byId("portal-view").hidden = false;
  }

  const currency = (value, code = "USD") => {
    try { return new Intl.NumberFormat("en-US", { style: "currency", currency: code || "USD" }).format(Number(value || 0)); }
    catch { return `${Number(value || 0).toFixed(2)} ${code || ""}`.trim(); }
  };

  const dateTime = value => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value || "") : parsed.toLocaleString("en-US", {
      month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago",
    });
  };

  function summaryCountText(donations, givers) {
    const donationCount = Number(donations || 0);
    const giverCount = Number(givers || 0);
    return `${donationCount.toLocaleString()} donation${donationCount === 1 ? "" : "s"} · ${giverCount.toLocaleString()} giver${giverCount === 1 ? "" : "s"}`;
  }

  function renderSummary(summary = {}) {
    byId("summary-year").textContent = summary.year || new Date().getFullYear();
    byId("summary-hope").textContent = currency(summary.products?.HopeSojourns);
    byId("summary-jbb").textContent = currency(summary.products?.JoshBeyondBorders);
    byId("summary-cs").textContent = currency(summary.products?.ChristianSteps);
    byId("summary-total").textContent = currency(summary.total);
    byId("summary-hope-counts").textContent = summaryCountText(summary.donationCounts?.HopeSojourns, summary.giverCounts?.HopeSojourns);
    byId("summary-jbb-counts").textContent = summaryCountText(summary.donationCounts?.JoshBeyondBorders, summary.giverCounts?.JoshBeyondBorders);
    byId("summary-cs-counts").textContent = summaryCountText(summary.donationCounts?.ChristianSteps, summary.giverCounts?.ChristianSteps);
    byId("summary-total-counts").textContent = summaryCountText(summary.donationCount, summary.giverCount);
    byId("summary-hope-sent").textContent = currency(summary.sentProducts?.HopeSojourns);
    byId("summary-jbb-sent").textContent = currency(summary.sentProducts?.JoshBeyondBorders);
    byId("summary-cs-sent").textContent = currency(summary.sentProducts?.ChristianSteps);
    byId("summary-total-sent").textContent = currency(summary.sentTotal);
  }

  function renderYears(years = []) {
    const select = byId("filter-year");
    const selected = select.value;
    select.replaceChildren();
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "All years";
    select.append(all);
    for (const year of years) {
      const option = document.createElement("option");
      option.value = String(year);
      option.textContent = String(year);
      select.append(option);
    }
    select.value = years.map(String).includes(selected) ? selected : "";
    state.years = years;
  }

  function renderSync(sync) {
    const element = byId("sync-status");
    if (!sync?.lastSuccessAt) {
      element.textContent = "PayPal has not been synchronized yet. The first pull will load the full history available from PayPal's API.";
      return;
    }
    element.textContent = `Last PayPal pull: ${dateTime(sync.lastSuccessAt)} · ${Number(sync.lastResultCount || 0).toLocaleString()} records checked (${sync.lastScope || "recent"})`;
  }

  function productSelect(transaction) {
    const select = document.createElement("select");
    select.className = `product-select${transaction.product === "Unassigned" ? " needs-review" : ""}`;
    select.setAttribute("aria-label", `Product for transaction ${transaction.transactionId}`);
    const automatic = document.createElement("option");
    automatic.value = "";
    automatic.textContent = `Automatic: ${PRODUCT_LABELS[transaction.productDetected] || transaction.productDetected}`;
    select.append(automatic);
    for (const product of PRODUCTS) {
      const option = document.createElement("option");
      option.value = product;
      option.textContent = PRODUCT_LABELS[product];
      select.append(option);
    }
    select.value = transaction.productOverride || "";
    select.addEventListener("change", async () => {
      const chosen = select.value;
      select.disabled = true;
      try {
        await api(`/transactions/${encodeURIComponent(transaction.id)}/product`, { method: "POST", body: { product: chosen || null } });
        toast("The product assignment was saved.");
        await loadTransactions();
      } catch (error) {
        select.value = transaction.productOverride || "";
        toast(error.message);
      } finally {
        select.disabled = false;
      }
    });
    return select;
  }

  function isDistributionEligible(transaction) {
    return ["HopeSojourns", "JoshBeyondBorders"].includes(transaction.product)
      && /^T00\d{2}$/.test(transaction.eventCode || "")
      && transaction.status === "Completed"
      && transaction.currency === "USD"
      && ((transaction.direction === "received" && Number(transaction.gross) > 0)
        || (transaction.direction === "sent" && Number(transaction.gross) < 0));
  }

  function updateDistributionSelection() {
    const count = state.selectedTransactions.size;
    byId("distribution-selection-count").textContent = `${count.toLocaleString()} selected`;
    byId("send-selected-button").disabled = count === 0;
    const eligible = state.currentEligibleIds;
    const selectedOnPage = eligible.filter(id => state.selectedTransactions.has(id)).length;
    const selectAll = byId("select-all-distributions");
    selectAll.disabled = eligible.length === 0;
    selectAll.checked = eligible.length > 0 && selectedOnPage === eligible.length;
    selectAll.indeterminate = selectedOnPage > 0 && selectedOnPage < eligible.length;
  }

  function renderTransactions(transactions = []) {
    const body = byId("transaction-body");
    body.replaceChildren();
    for (const transaction of transactions) {
      if (!isDistributionEligible(transaction)) state.selectedTransactions.delete(transaction.id);
    }
    state.currentEligibleIds = transactions.filter(isDistributionEligible).map(transaction => transaction.id);
    for (const transaction of transactions) {
      const isHold = transaction.eventCode === "T2101";
      const isHoldRelease = transaction.eventCode === "T2102";
      const relatedParty = transaction.relatedCounterpartyName || transaction.relatedCounterpartyEmail;
      const relatedDescription = relatedParty ? `Related to ${relatedParty} · ` : "";
      const row = document.createElement("tr");
      const selectCell = row.insertCell();
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "row-checkbox";
      checkbox.disabled = !isDistributionEligible(transaction);
      checkbox.checked = state.selectedTransactions.has(transaction.id);
      checkbox.setAttribute("aria-label", `Select ${transaction.displayName || transaction.transactionId} for distribution`);
      checkbox.title = checkbox.disabled ? "Only completed received or sent payments assigned to Hope Sojourns or Josh Beyond Borders can be sent. Holds and releases are excluded." : "Send this transaction to the recipient approval queue.";
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) state.selectedTransactions.add(transaction.id);
        else state.selectedTransactions.delete(transaction.id);
        updateDistributionSelection();
      });
      selectCell.append(checkbox);
      row.insertCell().textContent = dateTime(transaction.transactionDate);
      const directionCell = row.insertCell();
      const direction = document.createElement("span");
      direction.className = `direction-pill ${isHold ? "direction-held" : isHoldRelease ? "direction-released" : `direction-${transaction.direction}`}`;
      direction.textContent = isHold ? "Held" : isHoldRelease ? "Released" : transaction.direction === "received" ? "Received" : "Sent";
      directionCell.append(direction);
      const nameCell = row.insertCell();
      const person = document.createElement("span");
      person.className = "person-cell";
      const name = document.createElement("strong");
      name.textContent = isHold ? "PayPal payment hold" : isHoldRelease ? "PayPal hold released" : transaction.displayName || "Name unavailable";
      const email = document.createElement("small");
      email.textContent = isHold || isHoldRelease
        ? `${relatedDescription}Payment ${transaction.referenceTransactionId || transaction.transactionId}`
        : transaction.counterpartyEmail || transaction.transactionId;
      person.append(name, email);
      nameCell.append(person);
      row.insertCell().append(productSelect(transaction));
      const itemCell = row.insertCell();
      const item = document.createElement("span");
      item.className = "item-cell";
      const itemName = document.createElement("strong");
      itemName.textContent = transaction.itemTitle || transaction.subject || "No item title supplied";
      const itemId = document.createElement("small");
      itemId.textContent = transaction.itemId ? `Item ID: ${transaction.itemId}` : transaction.transactionId;
      item.append(itemName, document.createElement("br"), itemId);
      itemCell.append(item);
      const statusCell = row.insertCell();
      const status = document.createElement("span");
      status.className = `status-pill ${transaction.status === "Completed" ? "status-completed" : "status-other"}`;
      status.textContent = transaction.status;
      statusCell.append(status);
      const deliveryCell = row.insertCell();
      const delivery = document.createElement("span");
      const deliveryStatus = transaction.distributionStatus || "not_sent";
      delivery.className = `status-pill delivery-${deliveryStatus}`;
      delivery.textContent = deliveryStatus === "not_sent" ? "Not sent" : deliveryStatus.replaceAll("_", " ");
      if (transaction.distributionDestination) delivery.title = `${PRODUCT_LABELS[transaction.distributionDestination] || transaction.distributionDestination}${transaction.distributionError ? `: ${transaction.distributionError}` : ""}`;
      deliveryCell.append(delivery);
      for (const field of ["gross", "fee", "net"]) {
        const cell = row.insertCell();
        cell.className = "number-cell";
        cell.textContent = currency(transaction[field], transaction.currency);
      }
      body.append(row);
    }
    byId("empty-transactions").hidden = transactions.length > 0;
    updateDistributionSelection();
  }

  async function sendSelectedTransactions() {
    const transactionIds = [...state.selectedTransactions];
    if (!transactionIds.length) return;
    if (!global.confirm(`Send ${transactionIds.length} selected transaction${transactionIds.length === 1 ? "" : "s"} to the recipient approval queue?`)) return;
    setBusy(true, "Sending transactions for review…");
    try {
      const result = await api("/distribution/send", { method: "POST", body: { transactionIds } });
      state.selectedTransactions.clear();
      await loadTransactions();
      toast(`${Number(result.sent || 0).toLocaleString()} sent; ${Number(result.failed || 0).toLocaleString()} need attention.`);
    } catch (error) {
      toast(error.message);
      await loadTransactions();
    } finally {
      setBusy(false);
    }
  }

  function filterQuery() {
    const form = new FormData(byId("filter-form"));
    const parameters = new URLSearchParams();
    for (const key of ["search", "activity", "product", "direction", "year"]) {
      const value = String(form.get(key) || "").trim();
      if (value) parameters.set(key, value);
    }
    parameters.set("page", String(state.page));
    return parameters.toString();
  }

  async function loadTransactions({ throwOnError = false, showError = true } = {}) {
    const requestId = ++state.transactionRequest;
    try {
      const result = await api(`/transactions?${filterQuery()}`);
      if (requestId !== state.transactionRequest) return null;
      renderTransactions(result.transactions || []);
      renderSummary(result.summary);
      renderSync(result.sync);
      renderYears(result.years || []);
      state.page = Number(result.pagination?.page || 1);
      state.pages = Number(result.pagination?.pages || 1);
      const total = Number(result.pagination?.total || 0);
      byId("record-count").textContent = `${total.toLocaleString()} record${total === 1 ? "" : "s"}, newest first`;
      byId("page-status").textContent = `Page ${state.page} of ${state.pages}`;
      byId("previous-page-button").disabled = state.page <= 1;
      byId("next-page-button").disabled = state.page >= state.pages;
      return result;
    } catch (error) {
      if (showError) toast(error.message);
      if (throwOnError) throw error;
      return null;
    }
  }

  async function synchronize(fullHistory) {
    if (fullHistory && !global.confirm("Refresh the full history available through PayPal's API? This can take several minutes.")) return;
    let pullCompleted = false;
    setBusy(true, fullHistory ? "Refreshing PayPal history…" : "Pulling recent PayPal activity…");
    try {
      const result = await api("/paypal/sync", { method: "POST", body: { fullHistory } });
      pullCompleted = true;
      if (result.summary) renderSummary(result.summary);
      if (result.sync) renderSync(result.sync);
      state.page = 1;
      await loadTransactions({ throwOnError: true, showError: false });
      const recordsFound = Number(result.recordsFound ?? result.found ?? 0);
      const recordsInserted = Number(result.recordsInserted ?? result.inserted ?? 0);
      const recordsUpdated = Number(result.recordsUpdated ?? result.updated ?? 0);
      const reportingNote = recordsInserted === 0
        ? " If you just completed a PayPal transaction, PayPal may take up to three hours to include it in Transaction Search."
        : "";
      toast(
        `${recordsFound.toLocaleString()} PayPal records checked; ${recordsInserted.toLocaleString()} new; ${recordsUpdated.toLocaleString()} refreshed.${reportingNote}`,
        recordsInserted === 0 ? 9_000 : 6_000,
      );
    } catch (error) {
      toast(pullCompleted
        ? `The PayPal pull completed, but the table could not refresh automatically: ${error.message}`
        : error.message);
    } finally {
      setBusy(false);
    }
  }

  function styleWorksheet(sheet, columnCount) {
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: columnCount } };
    const header = sheet.getRow(1);
    header.height = 24;
    header.eachCell(cell => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF123F33" } };
      cell.alignment = { vertical: "middle" };
    });
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1 && rowNumber % 2 === 0) row.eachCell(cell => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F8F5" } }; });
    });
  }

  async function downloadWorkbook() {
    setBusy(true, "Building the Excel workbook…");
    try {
      const result = await api("/transactions/export");
      if (!global.ExcelJS) throw new Error("The spreadsheet component did not load.");
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Christian Steps Admin Portal";
      workbook.created = new Date(result.generatedAt || Date.now());
      const summary = workbook.addWorksheet("Summary");
      summary.columns = [{ key: "label", width: 32 }, { key: "received", width: 26 }, { key: "donations", width: 12 }, { key: "givers", width: 12 }, { key: "sent", width: 24 }];
      summary.addRows([
        { label: `${result.summary.year} activity by product`, received: "Gross donations received", donations: "Donations", givers: "Givers", sent: "Sent to another account" },
        { label: "Hope Sojourns", received: Number(result.summary.products.HopeSojourns || 0), donations: Number(result.summary.donationCounts?.HopeSojourns || 0), givers: Number(result.summary.giverCounts?.HopeSojourns || 0), sent: Number(result.summary.sentProducts?.HopeSojourns || 0) },
        { label: "Josh Beyond Borders", received: Number(result.summary.products.JoshBeyondBorders || 0), donations: Number(result.summary.donationCounts?.JoshBeyondBorders || 0), givers: Number(result.summary.giverCounts?.JoshBeyondBorders || 0), sent: Number(result.summary.sentProducts?.JoshBeyondBorders || 0) },
        { label: "Christian Steps", received: Number(result.summary.products.ChristianSteps || 0), donations: Number(result.summary.donationCounts?.ChristianSteps || 0), givers: Number(result.summary.giverCounts?.ChristianSteps || 0), sent: Number(result.summary.sentProducts?.ChristianSteps || 0) },
        { label: "All ministry activity", received: Number(result.summary.total || 0), donations: Number(result.summary.donationCount || 0), givers: Number(result.summary.giverCount || 0), sent: Number(result.summary.sentTotal || 0) },
        { label: "Workbook generated", received: new Date(result.generatedAt), donations: "", givers: "", sent: "" },
      ]);
      summary.getColumn(2).numFmt = "$#,##0.00;[Red]-$#,##0.00";
      summary.getColumn(5).numFmt = "$#,##0.00;[Red]-$#,##0.00";
      summary.getCell("B6").numFmt = "m/d/yyyy h:mm AM/PM";
      styleWorksheet(summary, 5);

      const transactions = workbook.addWorksheet("PayPal Transactions");
      const columns = [
        ["Date", "transactionDate", 22], ["Direction", "direction", 12], ["Status", "status", 15], ["Product", "product", 22],
        ["Auto-detected product", "productDetected", 22], ["Product override", "productOverride", 20], ["Name", "counterpartyName", 25],
        ["Email", "counterpartyEmail", 30], ["Related payment name", "relatedCounterpartyName", 25], ["Related payment email", "relatedCounterpartyEmail", 30], ["Phone", "counterpartyPhone", 18], ["Gross", "gross", 14], ["Fee", "fee", 14], ["Net", "net", 14],
        ["Currency", "currency", 10], ["PayPal item title", "itemTitle", 34], ["PayPal item ID", "itemId", 22], ["Type", "type", 22],
        ["Transaction ID", "transactionId", 24], ["Event code", "eventCode", 14], ["Reference transaction ID", "referenceTransactionId", 26],
        ["Invoice", "invoiceNumber", 18], ["Custom field", "customNumber", 22], ["Subject", "subject", 30], ["Note", "note", 40],
        ["Shipping name", "shippingName", 25], ["Address 1", "addressLine1", 28], ["Address 2", "addressLine2", 22], ["City", "city", 20],
        ["State / region", "region", 16], ["Postal code", "postalCode", 14], ["Country", "countryCode", 10], ["Address status", "addressStatus", 15],
        ["Ending balance", "endingBalance", 16], ["Item details JSON", "itemDetailsJson", 45], ["Complete PayPal record JSON", "rawJson", 60],
      ];
      transactions.columns = columns.map(([header, key, width]) => ({ header, key, width }));
      transactions.addRows((result.transactions || []).map(transaction => ({ ...transaction, transactionDate: new Date(transaction.transactionDate) })));
      ["gross", "fee", "net", "endingBalance"].forEach(key => { transactions.getColumn(key).numFmt = "$#,##0.00;[Red]-$#,##0.00"; });
      transactions.getColumn("transactionDate").numFmt = "m/d/yyyy h:mm AM/PM";
      transactions.getColumn("rawJson").alignment = { wrapText: false };
      styleWorksheet(transactions, columns.length);
      const buffer = await workbook.xlsx.writeBuffer();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const generatedStamp = new Date(result.generatedAt || Date.now()).toISOString().replace(/[:.]/g, "-");
      link.download = `Christian-Steps-PayPal-Transactions-${generatedStamp}.xlsx`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
      toast("A fresh PayPal workbook was downloaded.");
    } catch (error) {
      toast(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function signIn(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    byId("login-message").textContent = "";
    setBusy(true, "Signing in…");
    try {
      const session = await api("/login", { method: "POST", body: { password: form.get("password"), rememberMe: form.get("rememberMe") === "on" } });
      showPortal(session);
      await loadTransactions();
    } catch (error) {
      byId("login-message").textContent = error.message;
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    try { await api("/logout", { method: "POST" }); } catch { /* Clearing the local view is still safe. */ }
    showLogin();
  }

  async function changePassword(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const message = byId("password-message");
    message.textContent = "";
    try {
      await api("/password", { method: "POST", body: Object.fromEntries(form) });
      event.currentTarget.reset();
      byId("password-dialog").close();
      toast("The password was changed and other sessions were signed out.");
    } catch (error) { message.textContent = error.message; }
  }

  function closeActionMenu() {
    byId("more-actions-menu").hidden = true;
    byId("more-actions-button").setAttribute("aria-expanded", "false");
  }

  function bindEvents() {
    byId("login-form").addEventListener("submit", signIn);
    byId("sign-out-button").addEventListener("click", signOut);
    byId("change-password-button").addEventListener("click", () => byId("password-dialog").showModal());
    byId("password-form").addEventListener("submit", changePassword);
    document.querySelectorAll("[data-password-target]").forEach(button => button.addEventListener("click", () => {
      const input = byId(button.dataset.passwordTarget);
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      button.textContent = showing ? "Show" : "Hide";
    }));
    byId("sync-button").addEventListener("click", () => synchronize(false));
    byId("full-sync-button").addEventListener("click", () => { closeActionMenu(); synchronize(true); });
    byId("download-workbook-button").addEventListener("click", () => { closeActionMenu(); downloadWorkbook(); });
    byId("open-letters-button").addEventListener("click", () => { closeActionMenu(); global.CSGivingLetters.open(state.years); });
    byId("more-actions-button").addEventListener("click", () => {
      const menu = byId("more-actions-menu");
      menu.hidden = !menu.hidden;
      byId("more-actions-button").setAttribute("aria-expanded", String(!menu.hidden));
    });
    document.addEventListener("click", event => {
      if (!event.target.closest(".action-group")) closeActionMenu();
    });
    byId("filter-form").addEventListener("submit", event => { event.preventDefault(); state.page = 1; loadTransactions(); });
    byId("clear-filters-button").addEventListener("click", () => { byId("filter-form").reset(); state.page = 1; loadTransactions(); });
    byId("previous-page-button").addEventListener("click", () => { if (state.page > 1) { state.page -= 1; loadTransactions(); } });
    byId("next-page-button").addEventListener("click", () => { if (state.page < state.pages) { state.page += 1; loadTransactions(); } });
    byId("send-selected-button").addEventListener("click", sendSelectedTransactions);
    byId("select-all-distributions").addEventListener("change", event => {
      for (const id of state.currentEligibleIds) {
        if (event.currentTarget.checked) state.selectedTransactions.add(id);
        else state.selectedTransactions.delete(id);
      }
      document.querySelectorAll("#transaction-body .row-checkbox:not(:disabled)").forEach(checkbox => { checkbox.checked = event.currentTarget.checked; });
      updateDistributionSelection();
    });
  }

  async function boot() {
    bindEvents();
    global.CSGivingLetters.init({ api, setBusy, toast, years: [] });
    try {
      const session = await api("/session");
      showPortal(session);
      await loadTransactions();
    } catch { showLogin(); }
  }

  global.CSAdmin = Object.freeze({ api, setBusy, toast, loadTransactions });
  boot();
})(window);
