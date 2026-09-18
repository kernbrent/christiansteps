"use strict";

(() => {
  const CONFIG = window.CSM_LEDGER_CONFIG || {};
  const API_BASE = String(CONFIG.apiBase || "/api/admin").replace(/\/$/, "");
  const LOCAL_DEMO =
    (location.hostname === "127.0.0.1" || location.hostname === "localhost") &&
    new URLSearchParams(location.search).get("live") !== "1";
  const TABLE_KEYS = [
    "categories",
    "clients",
    "projects",
    "trip_templates",
    "mileage_rates",
    "expenses",
    "income",
    "income_payments",
    "mileage_entries",
    "attachments",
    "invoices",
    "invoice_items",
    "invoice_profiles",
    "client_artifacts",
    "paypal_activity",
  ];
  const PROGRAMS = [
    ["ChristianSteps", "Christian Steps"],
    ["HopeSojourns", "Hope Sojourns"],
    ["Shared", "Shared / administration"],
  ];
  const DEFAULT_CATEGORIES = [
    ["Tolls", "Car and truck expenses", "#6d5b8c"],
    ["Business Meals & Coffee", "Meals", "#9a6817"],
    ["Office Supplies", "Office expense", "#0d4b73"],
    ["Travel - Airfare", "Travel", "#26735b"],
    ["Travel - Lodging", "Travel", "#26735b"],
    ["Travel - Rental Car", "Travel", "#26735b"],
    ["Travel - Meals", "Meals", "#9a6817"],
    ["Parking & Local Transportation", "Car and truck expenses", "#6d5b8c"],
    ["Software & Subscriptions", "Other business expenses", "#17699a"],
    ["Professional Services", "Legal and professional services", "#0d4b73"],
    ["Marketing & Advertising", "Advertising", "#a04444"],
    ["Other Business Expense", "Other business expenses", "#667783"],
  ];
  const PAYMENT_METHODS = [
    "ACH / bank transfer",
    "Business credit card",
    "Business debit card",
    "Cash",
    "Check",
    "Personal card",
    "PayPal",
    "Venmo",
    "Other",
  ];
  const ROUTES = {
    dashboard: ["Overview", "Dashboard"],
    paypal: ["Fund accounting", "PayPal & Funds"],
    expenses: ["Bookkeeping", "Expenses"],
    income: ["Bookkeeping", "Income"],
    invoices: ["Client billing", "Invoices"],
    artifacts: ["Client billing", "Files & Assets"],
    mileage: ["Bookkeeping", "Mileage"],
    clients: ["Relationships", "Clients & Projects"],
    reports: ["Tax preparation", "Reports"],
    settings: ["Administration", "Settings"],
  };
  const state = {
    user: null,
    session: null,
    csrfToken: null,
    demo: LOCAL_DEMO,
    settings: null,
    categories: [],
    clients: [],
    projects: [],
    trip_templates: [],
    mileage_rates: [],
    expenses: [],
    income: [],
    income_payments: [],
    mileage_entries: [],
    attachments: [],
    invoices: [],
    invoice_items: [],
    invoice_profiles: [],
    client_artifacts: [],
    paypal_activity: [],
    ledger_sync: null,
    reportFilters: null,
  };
  let invoicePortal = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const today = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  };
  const currentYear = () => new Date().getFullYear();
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`);
  const num = (value) => Number(value || 0);
  const clean = (value) => {
    const text = String(value ?? "").trim();
    return text || null;
  };
  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  const money = (value) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: state.settings?.currency_code || "USD",
    }).format(num(value));
  const shortDate = (value) => {
    if (!value) return "-";
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${value}T12:00:00Z`));
  };
  const statusLabel = (value) =>
    String(value || "").replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
  const ownerPayload = (payload) => ({ ...payload, owner_id: state.user.id });
  const byId = (collection, id) => collection.find((item) => item.id === id);
  const clientName = (id) => byId(state.clients, id)?.name || "-";
  const projectName = (id) => byId(state.projects, id)?.name || "-";
  const categoryName = (id) => byId(state.categories, id)?.name || "Uncategorized";
  const programName = (value) => ({
    ChristianSteps: "Christian Steps",
    HopeSojourns: "Hope Sojourns",
    JoshBeyondBorders: "Josh Beyond Borders",
    Shared: "Shared / administration",
    Unassigned: "Needs assignment",
  }[value] || value || "Christian Steps");
  const programOptions = (selected = "ChristianSteps", includeShared = true) =>
    PROGRAMS.filter(([value]) => includeShared || value !== "Shared")
      .map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`)
      .join("");
  const paymentsFor = (incomeId) =>
    state.income_payments.filter((payment) => payment.income_id === incomeId);
  const amountPaid = (incomeId) =>
    paymentsFor(incomeId).reduce((sum, payment) => sum + num(payment.amount), 0);
  const attachmentsFor = (type, id) =>
    state.attachments.filter(
      (item) => item.record_type === type && item[`${type}_id`] === id
    );
  const taxYear = () => state.settings?.default_tax_year || currentYear();
  const yearStart = (year = taxYear()) => `${year}-01-01`;
  const yearEnd = (year = taxYear()) => `${year}-12-31`;
  const mileageRates = () =>
    state.mileage_rates
      .filter((item) => Boolean(item.is_active))
      .sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  const mileageRateForDate = (date) =>
    mileageRates().find((item) => item.effective_from <= date && item.effective_to >= date) || null;
  const mileageDeductionFor = (item) => {
    const rate = mileageRateForDate(item.mileage_date);
    return rate ? num(item.miles) * num(rate.rate_per_mile) : 0;
  };
  const mileageTotals = (items) => ({
    miles: items.reduce((sum, item) => sum + num(item.miles), 0),
    deduction: items.reduce((sum, item) => sum + mileageDeductionFor(item), 0),
    missingRateCount: items.filter((item) => !mileageRateForDate(item.mileage_date)).length,
  });
  const rateDisplay = (value) =>
    `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(num(value) * 100)}¢/mi`;

  function showOnly(id) {
    ["loading-view", "auth-view", "setup-view", "admin-shell"].forEach((viewId) => {
      const element = document.getElementById(viewId);
      if (element) element.hidden = viewId !== id;
    });
  }

  function toast(message, tone = "success") {
    const region = $("#toast-region");
    const item = document.createElement("div");
    item.className = `toast toast-${tone}`;
    item.textContent = message;
    region.append(item);
    setTimeout(() => item.remove(), 4200);
  }

  function friendlyError(error, fallback = "That action could not be completed.") {
    if (error?.code === "RECORD_IN_USE") {
      return "This item is linked to bookkeeping records. Keep it and mark it inactive instead of deleting it.";
    }
    if (error?.code === "DUPLICATE_RECORD") {
      return "A record with that unique name or number already exists.";
    }
    if (error?.code === "MILEAGE_RATE_OVERLAP") {
      return "This date range overlaps another active mileage rate. Adjust one of the date ranges and try again.";
    }
    if (error?.code === "DUPLICATE_INVOICE") {
      return "That invoice number or saved starting-point name is already in use.";
    }
    if (error?.code === "AUTH_REQUIRED" || error?.code === "SESSION_EXPIRED") {
      return "Your secure session expired. Sign in again.";
    }
    return error?.message || fallback;
  }

  function setBusy(form, busy, label = "Saving...") {
    const submit = $('button[type="submit"]', form);
    if (!submit) return;
    if (busy) {
      submit.dataset.originalLabel = submit.textContent;
      submit.textContent = label;
      submit.disabled = true;
    } else {
      submit.textContent = submit.dataset.originalLabel || "Save";
      submit.disabled = false;
    }
  }

  function showFormError(form, message = "") {
    const target = form ? $("[data-form-error]", form) : null;
    if (!target) return false;
    target.textContent = message;
    target.hidden = !message;
    if (message) target.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return true;
  }

  function demoDate(month, day) {
    const year = currentYear();
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function seedDemoData() {
    const owner = "00000000-0000-4000-8000-000000000001";
    state.user = { id: owner, email: "preview@christiansteps.net" };
    state.session = { user: state.user };
    state.settings = {
      owner_id: owner,
      business_name: "Christian Steps Ministries",
      default_tax_year: currentYear(),
      currency_code: "USD",
      mileage_rate: 0.7,
      contact_email: "preview@christiansteps.net",
    };
    state.categories = DEFAULT_CATEGORIES.map(([name, tax_line, color], index) => ({
      id: uid(), owner_id: owner, name, tax_line, color, is_active: true, sort_order: index,
    }));
    const meal = state.categories.find((item) => item.name.includes("Meals"));
    const software = state.categories.find((item) => item.name.includes("Software"));
    const office = state.categories.find((item) => item.name === "Office Supplies");
    const tolls = state.categories.find((item) => item.name === "Tolls");
    const clientA = { id: uid(), owner_id: owner, name: "Northstar Leadership", company: "Northstar Leadership", email: "amy@example.com", phone: "", notes: "Executive coaching engagement", is_active: true };
    const clientB = { id: uid(), owner_id: owner, name: "WeatherCall Services", company: "WeatherCall Services", email: "accounts@example.com", phone: "", notes: "", is_active: true };
    state.clients = [clientA, clientB];
    const projectA = { id: uid(), owner_id: owner, client_id: clientA.id, name: "Leadership Coaching", description: "", is_active: true };
    const projectB = { id: uid(), owner_id: owner, client_id: clientB.id, name: "Technology Advisory", description: "", is_active: true };
    state.projects = [projectA, projectB];
    state.trip_templates = [{
      id: uid(), owner_id: owner, name: "Northstar workshop", origin: "McKinney, TX",
      destination: "Dallas, TX", business_purpose: "Client workshop", miles: 67.4,
      toll_amount: 12.84, toll_vendor: "NTTA", payment_method: "Business credit card",
      client_id: clientA.id, project_id: projectA.id, notes: "Round trip", is_active: true,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }];
    const rateStamp = new Date().toISOString();
    state.mileage_rates = [
      { id: uid(), owner_id: owner, effective_from: "2026-01-01", effective_to: "2026-06-30", rate_per_mile: 0.725, label: "IRS business rate - Jan through Jun 2026", is_active: true, created_at: rateStamp, updated_at: rateStamp },
      { id: uid(), owner_id: owner, effective_from: "2026-07-01", effective_to: "2026-12-31", rate_per_mile: 0.76, label: "IRS business rate - Jul through Dec 2026", is_active: true, created_at: rateStamp, updated_at: rateStamp },
    ];
    state.expenses = [
      { id: uid(), owner_id: owner, expense_date: demoDate(8, 21), vendor: "Delta Air Lines", amount: 486.2, category_id: state.categories.find((item) => item.name.includes("Airfare")).id, description: "Client travel", business_purpose: "Onsite leadership workshop", payment_method: "Business credit card", client_id: clientA.id, project_id: projectA.id, tax_year: currentYear(), reimbursable: false, reimbursed: false, deductibility_percent: 100, record_status: "included", cpa_review: false, cpa_notes: "", notes: "" },
      { id: uid(), owner_id: owner, expense_date: demoDate(8, 18), vendor: "The Yard Coffee", amount: 18.45, category_id: meal.id, description: "Coffee meeting", business_purpose: "Discovery conversation with prospective client", payment_method: "Business credit card", client_id: null, project_id: null, tax_year: currentYear(), reimbursable: false, reimbursed: false, deductibility_percent: 50, record_status: "needs_review", cpa_review: true, cpa_notes: "Confirm meal deductibility.", notes: "" },
      { id: uid(), owner_id: owner, expense_date: demoDate(8, 4), vendor: "Microsoft", amount: 21.99, category_id: software.id, description: "Microsoft 365", business_purpose: "Business software", payment_method: "Business credit card", client_id: null, project_id: null, tax_year: currentYear(), reimbursable: false, reimbursed: false, deductibility_percent: 100, record_status: "included", cpa_review: false, cpa_notes: "", notes: "" },
      { id: uid(), owner_id: owner, expense_date: demoDate(8, 22), vendor: "NTTA", amount: 12.84, category_id: tolls.id, description: "Dallas North Tollway", business_purpose: "Travel to client workshop", payment_method: "Business credit card", client_id: clientA.id, project_id: projectA.id, tax_year: currentYear(), reimbursable: false, reimbursed: false, deductibility_percent: 100, record_status: "included", cpa_review: false, cpa_notes: "", notes: "" },
      { id: uid(), owner_id: owner, expense_date: demoDate(7, 29), vendor: "Staples", amount: 64.31, category_id: office.id, description: "Printer supplies", business_purpose: "Home office supplies", payment_method: "Business credit card", client_id: null, project_id: null, tax_year: currentYear(), reimbursable: false, reimbursed: false, deductibility_percent: 100, record_status: "included", cpa_review: false, cpa_notes: "", notes: "" },
    ];
    const incomeA = { id: uid(), owner_id: owner, income_date: demoDate(8, 15), client_id: clientA.id, project_id: projectA.id, payer_name: clientA.name, invoice_number: "CS-1004", invoice_date: demoDate(8, 1), due_date: demoDate(8, 31), amount: 3000, payment_status: "paid", description: "Leadership coaching package", payment_method: "ACH / bank transfer", tax_year: currentYear(), record_status: "included", cpa_review: false, cpa_notes: "", notes: "" };
    const incomeB = { id: uid(), owner_id: owner, income_date: demoDate(8, 28), client_id: clientB.id, project_id: projectB.id, payer_name: clientB.name, invoice_number: "CS-1005", invoice_date: demoDate(8, 20), due_date: demoDate(9, 20), amount: 4500, payment_status: "partial", description: "Technology advisory services", payment_method: "Check", tax_year: currentYear(), record_status: "included", cpa_review: false, cpa_notes: "", notes: "" };
    state.income = [incomeA, incomeB];
    state.income_payments = [
      { id: uid(), owner_id: owner, income_id: incomeA.id, payment_date: demoDate(8, 15), amount: 3000, payment_method: "ACH / bank transfer", reference_number: "ACH-8142", notes: "" },
      { id: uid(), owner_id: owner, income_id: incomeB.id, payment_date: demoDate(8, 28), amount: 1500, payment_method: "Check", reference_number: "1047", notes: "" },
    ];
    state.mileage_entries = [
      { id: uid(), owner_id: owner, mileage_date: demoDate(8, 22), origin: "McKinney, TX", destination: "Dallas, TX", business_purpose: "Client workshop", miles: 67.4, client_id: clientA.id, project_id: projectA.id, tax_year: currentYear(), record_status: "included", cpa_review: false, cpa_notes: "", notes: "Round trip" },
      { id: uid(), owner_id: owner, mileage_date: demoDate(8, 11), origin: "McKinney, TX", destination: "Plano, TX", business_purpose: "Prospective client meeting", miles: 31.2, client_id: null, project_id: null, tax_year: currentYear(), record_status: "included", cpa_review: false, cpa_notes: "", notes: "Round trip" },
    ];
    state.attachments = [
      { id: uid(), owner_id: owner, record_type: "expense", expense_id: state.expenses[0].id, income_id: null, storage_path: "demo/receipt.pdf", file_name: "delta-receipt.pdf", mime_type: "application/pdf", size_bytes: 180231, created_at: new Date().toISOString() },
      { id: uid(), owner_id: owner, record_type: "expense", expense_id: state.expenses[2].id, income_id: null, storage_path: "demo/microsoft.pdf", file_name: "microsoft-365.pdf", mime_type: "application/pdf", size_bytes: 84022, created_at: new Date().toISOString() },
      { id: uid(), owner_id: owner, record_type: "income", expense_id: null, income_id: incomeA.id, storage_path: "demo/invoice.pdf", file_name: "CS-1004.pdf", mime_type: "application/pdf", size_bytes: 101204, created_at: new Date().toISOString() },
    ];
  }

  async function apiRequest(path, { method = "GET", body, headers = {} } = {}) {
    const requestHeaders = new Headers(headers);
    requestHeaders.set("Accept", "application/json");
    const options = { method, credentials: "include", headers: requestHeaders };
    if (body !== undefined) {
      if (body instanceof Blob) {
        options.body = body;
      } else {
        requestHeaders.set("Content-Type", "application/json");
        options.body = JSON.stringify(body);
      }
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(method) && state.csrfToken) {
      requestHeaders.set("X-CSRF-Token", state.csrfToken);
    }
    const response = await fetch(`${API_BASE}${path}`, options);
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : { error: response.statusText || "The request could not be completed." };
    if (!response.ok) {
      const error = new Error(payload.error || "The request could not be completed.");
      error.code = payload.code || "REQUEST_FAILED";
      error.status = response.status;
      error.details = payload.details || null;
      if (response.status === 401 && path !== "/login") {
        state.user = null;
        state.session = null;
        state.csrfToken = null;
        showOnly("auth-view");
      }
      throw error;
    }
    return payload;
  }

  async function loadData() {
    const data = await apiRequest("/data");
    state.settings = data.settings;
    state.ledger_sync = data.ledger_sync || null;
    TABLE_KEYS.forEach((table) => {
      state[table] = data[table] || [];
    });
    state.expenses.sort((a, b) => b.expense_date.localeCompare(a.expense_date));
    state.income.sort((a, b) => b.income_date.localeCompare(a.income_date));
    state.mileage_entries.sort((a, b) => b.mileage_date.localeCompare(a.mileage_date));
    state.invoices.sort((a, b) => b.created_date.localeCompare(a.created_date));
  }

  async function saveRow(table, payload, id = null) {
    if (state.demo) {
      const collection = state[table];
      const stamp = new Date().toISOString();
      if (id) {
        const index = collection.findIndex((item) => item.id === id);
        collection[index] = { ...collection[index], ...payload, updated_at: stamp };
        return collection[index];
      }
      const row = { id: uid(), ...ownerPayload(payload), created_at: stamp, updated_at: stamp };
      collection.push(row);
      return row;
    }
    const result = await apiRequest(
      id ? `/records/${table}/${encodeURIComponent(id)}` : `/records/${table}`,
      { method: id ? "PATCH" : "POST", body: payload }
    );
    return result.record;
  }

  async function deleteRow(table, id) {
    if (state.demo) {
      state[table] = state[table].filter((item) => item.id !== id);
      return;
    }
    await apiRequest(`/records/${table}/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async function establishSession(session) {
    if(session.user){window.dispatchEvent(new CustomEvent("shared-session",{detail:session}));if(session.user.must_change_password||(!session.user.is_admin&&!["read","edit"].includes(session.user.permissions.finances))){location.replace("/admin/account/");return;}}
    state.session = session;
    state.csrfToken = session.csrfToken;
    state.user = { id: "primary", email: "Christian Steps Administrator" };
    showOnly("loading-view");
    try {
      await loadData();
      state.user.email = state.settings.contact_email || "Christian Steps Administrator";
      showApp();
    } catch (error) {
      console.error(error);
      if (error.status === 401) return;
      showOnly("auth-view");
      $("#auth-message").textContent = "The bookkeeping database could not be opened. Please try again.";
    }
  }

  async function init() {
    bindGlobalEvents();
    if (state.demo) {
      seedDemoData();
      showApp();
      return;
    }
    try {
      const session = await apiRequest("/session");
      await establishSession(session);
    } catch (error) {
      if (error.status === 401) {
        showOnly("auth-view");
        return;
      }
      console.error(error);
      showOnly("setup-view");
    }
  }
  function showApp() {
    showOnly("admin-shell");
    $("[data-active-tax-year]").textContent = taxYear();
    if (!invoicePortal) {
      invoicePortal = window.createChristianStepsInvoicePortal({
        state, $, $$, API_BASE, apiRequest, loadData, renderRoute, dialogFrame, toast, escapeHtml,
        money, shortDate, statusBadge, clientName, projectName, optionList, clean, num, uid, today,
        taxYear, amountPaid, pageToolbar, emptyState, methodOptions,
      });
      if (state.demo) invoicePortal.seedDemoData();
    }
    if (state.demo && !$("#demo-banner")) {
      const banner = document.createElement("div");
      banner.id = "demo-banner";
      banner.className = "demo-banner";
      banner.innerHTML = "<strong>Local preview</strong><span>Sample data is temporary and is not saved.</span>";
      $(".admin-workspace").prepend(banner);
    }
    if (!location.hash) location.hash = "#/dashboard";
    renderRoute();
  }

  function activeRoute() {
    const route = location.hash.replace(/^#\/?/, "").split("?")[0];
    return ROUTES[route] ? route : "dashboard";
  }

  function renderRoute() {
    const route = activeRoute();
    const [eyebrow, title] = ROUTES[route];
    $("#page-eyebrow").textContent = eyebrow;
    $("#page-title").textContent = title;
    $$(".admin-nav a").forEach((link) =>
      link.classList.toggle("is-active", link.dataset.route === route)
    );
    const renderers = {
      dashboard: renderDashboard,
      paypal: renderPaypalLedger,
      expenses: renderExpenses,
      income: renderIncome,
      invoices: invoicePortal.renderInvoices,
      artifacts: invoicePortal.renderArtifacts,
      mileage: renderMileage,
      clients: renderClients,
      reports: renderReports,
      settings: renderSettings,
    };
    $("#admin-main").innerHTML = renderers[route]();
    $("#admin-main").focus({ preventScroll: true });
    $("#sidebar").classList.remove("is-open");
    $("#menu-button").setAttribute("aria-expanded", "false");
  }

  function pageToolbar(label, searchPlaceholder, addAction, addLabel, extra = "") {
    return `
      <div class="page-toolbar">
        <label class="table-search">
          <span class="sr-only">Search ${escapeHtml(label)}</span>
          <input type="search" data-table-search placeholder="${escapeHtml(searchPlaceholder)}">
        </label>
        <div class="toolbar-actions">
          ${extra}
          <button class="button" type="button" data-action="${addAction}">+ ${escapeHtml(addLabel)}</button>
        </div>
      </div>`;
  }

  function statusBadge(value) {
    return `<span class="status-badge status-${escapeHtml(value)}">${escapeHtml(statusLabel(value))}</span>`;
  }

  function receiptBadge(type, id) {
    const count = attachmentsFor(type, id).length;
    return count
      ? `<span class="receipt-badge receipt-present">${count} file${count === 1 ? "" : "s"}</span>`
      : '<span class="receipt-badge receipt-missing">Missing</span>';
  }

  function emptyState(title, message, action = "", actionLabel = "") {
    return `
      <div class="empty-state table-empty">
        <span class="empty-mark">CS</span>
        <div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p>
        ${action ? `<button class="text-action" type="button" data-action="${action}">${escapeHtml(actionLabel)}</button>` : ""}
        </div>
      </div>`;
  }

  const paypalDate = (item) => String(item.transaction_date || "").slice(0, 10);
  const completedPayPal = (item) => String(item.status || "").toUpperCase() === "COMPLETED";
  const paypalForYear = (year) => state.paypal_activity.filter(
    (item) => completedPayPal(item) && Number(paypalDate(item).slice(0, 4)) === Number(year)
  );
  const contributionAmount = (rows) => rows
    .filter((item) => item.accounting_class === "contribution")
    .reduce((sum, item) => sum + Math.max(0, num(item.gross)), 0);
  const contributionFees = (rows) => rows
    .filter((item) => item.accounting_class === "contribution")
    .reduce((sum, item) => sum + Math.abs(num(item.fee)), 0);
  const agencyBalance = (rows = state.paypal_activity) => rows
    .filter((item) => completedPayPal(item) && item.program === "JoshBeyondBorders")
    .reduce((sum, item) => {
      if (item.accounting_class === "agency_receipt") return sum + Math.max(0, num(item.net));
      if (item.accounting_class === "agency_disbursement") return sum - Math.abs(num(item.net));
      return sum;
    }, 0);
  const accountingLabel = (value) => ({
    contribution: "Contribution income",
    agency_receipt: "JBB pass-through received",
    agency_disbursement: "JBB pass-through paid",
    internal_transfer: "Internal transfer",
    unassigned: "Needs assignment",
  }[value] || statusLabel(value));
  const paypalAccountingLabel = (item) => item.event_code === "T0400"
    ? "PayPal to bank transfer"
    : item.event_code === "T0300"
      ? "Bank to PayPal transfer"
      : accountingLabel(item.accounting_class);

  function renderPaypalLedger() {
    const year = taxYear();
    const yearRows = paypalForYear(year);
    const csmRows = yearRows.filter((item) => item.program === "ChristianSteps");
    const hopeRows = yearRows.filter((item) => item.program === "HopeSojourns");
    const jbbRows = yearRows.filter((item) => item.program === "JoshBeyondBorders");
    const jbbReceived = jbbRows.filter((item) => item.accounting_class === "agency_receipt")
      .reduce((sum, item) => sum + Math.max(0, num(item.gross)), 0);
    const jbbSent = jbbRows.filter((item) => item.accounting_class === "agency_disbursement")
      .reduce((sum, item) => sum + Math.abs(num(item.net)), 0);
    const bankTransfers = yearRows.filter((item) => item.event_code === "T0400")
      .reduce((sum, item) => sum + Math.abs(num(item.net) || num(item.gross)), 0);
    const rows = state.paypal_activity.map((item) => `
      <tr data-search-row="${escapeHtml([item.transaction_date, item.display_name, item.counterparty_email, item.item_title, item.transaction_id, programName(item.program), paypalAccountingLabel(item)].join(" ").toLowerCase())}">
        <td>${shortDate(paypalDate(item))}</td>
        <td><strong>${escapeHtml(item.display_name)}</strong><small>${escapeHtml(item.counterparty_email || item.transaction_id)}</small>${completedPayPal(item)&&item.direction==='received'&&['ChristianSteps','HopeSojourns'].includes(item.program)?`<button type="button" data-action="donor-splits" data-id="${escapeHtml(item.source_record_id)}">Split donation</button>`:''}</td>
        <td>${escapeHtml(programName(item.program))}</td>
        <td><strong>${escapeHtml(paypalAccountingLabel(item))}</strong><small>${escapeHtml(item.item_title || item.event_code)}</small></td>
        <td>${statusBadge(completedPayPal(item) ? "included" : "needs_review").replace(completedPayPal(item) ? "Included" : "Needs Review", escapeHtml(item.status))}<small>${escapeHtml(item.distribution_status || "Not sent for review")}</small></td>
        <td class="number"><strong>${money(item.gross)}</strong><small>Fee ${money(item.fee)} · Net ${money(item.net)}</small></td>
      </tr>`).join("");
    const synced = state.ledger_sync?.last_success_at
      ? `Updated ${new Date(state.ledger_sync.last_success_at).toLocaleString()} from ${state.ledger_sync.records_seen} PayPal records.`
      : "The PayPal ledger projection will update when this page loads.";
    return `
      <section class="view">
        <div class="section-heading-row split-heading">
          <div><p class="section-kicker">Read-only PayPal accounting</p><h2>Ministry funds and pass-through activity</h2><p>PayPal remains the source of truth. Original payments remain unchanged. Use Split donation to attribute a combined deposit to its donors.</p></div>
          <a class="secondary-button" href="../">Open Giving Portal</a>
        </div>
        <div class="metric-grid fund-metric-grid">
          <article class="metric-card metric-income"><span>Christian Steps contributions</span><strong>${money(contributionAmount(csmRows))}</strong><small>${year} gross · ${money(contributionFees(csmRows))} fees</small></article>
          <article class="metric-card metric-income"><span>Hope Sojourns contributions</span><strong>${money(contributionAmount(hopeRows))}</strong><small>${year} gross · ${money(contributionFees(hopeRows))} fees</small></article>
          <article class="metric-card metric-expense"><span>JBB funds handled</span><strong>${money(jbbReceived)}</strong><small>${money(jbbSent)} sent · agency activity, not CSM income</small></article>
          <article class="metric-card metric-net"><span>Due to JBB</span><strong>${money(agencyBalance())}</strong><small>All-time net receipts less disbursements</small></article>
          <article class="metric-card"><span>PayPal moved to bank</span><strong>${money(bankTransfers)}</strong><small>${year} internal transfers · not income or expense</small></article>
        </div>
        <div class="panel table-panel">
          <div class="panel-heading"><div><p class="section-kicker">Reconciliation</p><h2>PayPal payments and bank transfers</h2><p>${escapeHtml(synced)}</p></div><span>${state.paypal_activity.length} records</span></div>
          ${state.paypal_activity.length ? `<div class="page-toolbar"><label class="table-search"><span class="sr-only">Search PayPal records</span><input type="search" data-table-search placeholder="Search donor, ministry, item, or transaction" autocomplete="off"></label></div>
            <div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Party</th><th>Ministry</th><th>Accounting treatment</th><th>Status</th><th class="number">Gross / net</th></tr></thead><tbody>${rows}</tbody></table></div><p class="no-search-results" hidden>No PayPal records match this search.</p>`
            : emptyState("No PayPal records copied yet", "Pull PayPal activity in the Giving Portal, then return here.")}
        </div>
      </section>`;
  }

  function dashboardTransactions() {
    const rows = [
      ...state.expenses.map((item) => ({
        date: item.expense_date,
        type: "Expense",
        name: item.vendor,
        detail: categoryName(item.category_id),
        amount: -num(item.amount),
      })),
      ...state.income_payments.map((payment) => {
        const item = byId(state.income, payment.income_id);
        return {
          date: payment.payment_date,
          type: "Income",
          name: item?.payer_name || "Client payment",
          detail: item?.invoice_number || item?.description || "Payment received",
          amount: num(payment.amount),
        };
      }),
      ...state.mileage_entries.map((item) => ({
        date: item.mileage_date,
        type: "Mileage",
        name: `${item.origin} to ${item.destination}`,
        detail: item.business_purpose,
        amount: null,
        miles: num(item.miles),
      })),
      ...state.paypal_activity.filter(completedPayPal).map((item) => ({
        date: paypalDate(item),
        type: item.accounting_class === "contribution" ? "Contribution" : item.program === "JoshBeyondBorders" ? "Agency" : "Transfer",
        name: item.display_name,
        detail: `${programName(item.program)} · ${paypalAccountingLabel(item)}`,
        amount: item.accounting_class === "agency_disbursement" || item.accounting_class === "internal_transfer"
          ? -Math.abs(num(item.net))
          : Math.max(0, num(item.gross)),
      })),
    ];
    return rows.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  }

  function renderDashboard() {
    const year = taxYear();
    const expenses = state.expenses.filter(
      (item) => item.tax_year === year && item.record_status === "included"
    );
    const payments = state.income_payments.filter(
      (item) => Number(item.payment_date.slice(0, 4)) === year
    );
    const mileage = state.mileage_entries.filter(
      (item) => item.tax_year === year && item.record_status === "included"
    );
    const paypal = paypalForYear(year);
    const incomeTotal = payments.reduce((sum, item) => sum + num(item.amount), 0) + contributionAmount(paypal);
    const expenseTotal = expenses.reduce(
      (sum, item) => sum + num(item.amount) * (num(item.deductibility_percent) / 100),
      0
    ) + contributionFees(paypal);
    const mileageSummary = mileageTotals(mileage);
    const tollTotal = expenses
      .filter((item) => /toll/i.test(categoryName(item.category_id)))
      .reduce((sum, item) => sum + num(item.amount), 0);
    const missingReceipts = expenses.filter(
      (item) => !attachmentsFor("expense", item.id).length
    ).length;
    const needsReview = [
      ...state.expenses,
      ...state.income,
      ...state.mileage_entries,
    ].filter((item) => item.record_status === "needs_review").length;
    const cpaReview = [
      ...state.expenses,
      ...state.income,
      ...state.mileage_entries,
    ].filter((item) => item.cpa_review).length;
    const outstanding = state.income
      .filter((item) => item.payment_status !== "void")
      .reduce((sum, item) => sum + Math.max(0, num(item.amount) - amountPaid(item.id)), 0);
    const transactions = dashboardTransactions();
    const recent = transactions.length
      ? `<div class="table-wrap"><table class="data-table compact-table">
          <thead><tr><th>Date</th><th>Type</th><th>Record</th><th class="number">Amount</th></tr></thead>
          <tbody>${transactions.map((item) => `
            <tr><td>${shortDate(item.date)}</td><td><span class="type-chip type-${item.type.toLowerCase()}">${item.type}</span></td>
            <td><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.detail)}</small></td>
            <td class="number ${item.amount > 0 ? "positive" : ""}">${item.miles != null ? `${item.miles.toFixed(1)} mi` : money(item.amount)}</td></tr>
          `).join("")}</tbody></table></div>`
      : emptyState("No transactions yet", "Add your first expense or client payment to begin the ledger.", "add-expense", "Add expense");
    return `
      <section class="view">
        <div class="dashboard-intro">
          <div><p class="section-kicker">Tax year ${year}</p><h2>Ministry finances at a glance.</h2></div>
          <div class="quick-actions">
            <button type="button" data-action="add-expense">Add expense</button>
            <button type="button" data-action="add-income">Add income</button>
            <button type="button" data-action="add-invoice">Create invoice</button>
            <button type="button" data-action="add-mileage">Log mileage</button>
            <a href="#/reports">Build report</a>
          </div>
        </div>
        <div class="metric-grid">
          <article class="metric-card metric-income"><span>Income received</span><strong>${money(incomeTotal)}</strong><small>Year to date</small></article>
          <article class="metric-card metric-expense"><span>Included expenses</span><strong>${money(expenseTotal)}</strong><small>After deductibility %</small></article>
          <article class="metric-card metric-net"><span>Net ministry operations</span><strong>${money(incomeTotal - expenseTotal)}</strong><small>Before mileage deduction</small></article>
          <article class="metric-card metric-mileage"><span>Mileage &amp; tolls</span><strong>${mileageSummary.miles.toFixed(1)} mi</strong><small>${money(mileageSummary.deduction)} estimated deduction · ${money(tollTotal)} tolls${mileageSummary.missingRateCount ? ` · ${mileageSummary.missingRateCount} ${mileageSummary.missingRateCount === 1 ? "trip" : "trips"} missing a rate` : ""}</small></article>
          <article class="metric-card metric-net"><span>Due to JBB</span><strong>${money(agencyBalance())}</strong><small>Pass-through liability · not CSM income</small></article>
        </div>
        <div class="dashboard-grid">
          <section class="panel panel-wide">
            <div class="panel-heading"><div><p class="section-kicker">Activity</p><h2>Recent transactions</h2></div><a href="#/reports">View all</a></div>
            ${recent}
          </section>
          <section class="panel attention-panel">
            <div class="panel-heading"><div><p class="section-kicker">Needs attention</p><h2>Before tax time</h2></div></div>
            <ul class="attention-list">
              <li><a href="#/reports" data-action="open-report-preset" data-preset="missing-receipts">Missing receipts</a><strong>${missingReceipts}</strong></li>
              <li><span>Needs review</span><strong>${needsReview}</strong></li>
              <li><span>CPA review</span><strong>${cpaReview}</strong></li>
              <li><span>Outstanding invoices</span><strong>${money(outstanding)}</strong></li>
            </ul>
          </section>
        </div>
      </section>`;
  }

  function renderExpenses() {
    const rows = state.expenses.map((item) => {
      const haystack = [item.expense_date, item.vendor, item.description, item.business_purpose, programName(item.program), categoryName(item.category_id), clientName(item.client_id), item.payment_method, item.record_status].join(" ").toLowerCase();
      return `<tr data-search-row="${escapeHtml(haystack)}">
        <td>${shortDate(item.expense_date)}</td>
        <td><strong>${escapeHtml(item.vendor)}</strong><small>${escapeHtml(item.business_purpose || item.description || "")}</small></td>
        <td>${escapeHtml(programName(item.program))}</td>
        <td>${escapeHtml(categoryName(item.category_id))}</td>
        <td>${escapeHtml(clientName(item.client_id))}</td>
        <td>${receiptBadge("expense", item.id)}</td>
        <td>${statusBadge(item.record_status)}${item.cpa_review ? '<span class="mini-flag">CPA</span>' : ""}</td>
        <td class="number"><strong>${money(item.amount)}</strong><small>${num(item.deductibility_percent)}% deductible</small></td>
        <td class="row-actions"><button type="button" data-action="edit-expense" data-id="${item.id}">Edit</button><button type="button" data-action="delete-expense" data-id="${item.id}">Delete</button></td>
      </tr>`;
    }).join("");
    return `
      <section class="view">
        <div class="section-heading-row"><div><p class="section-kicker">Manual expense ledger</p><h2>Business expenses</h2><p>Track purchases, business purpose, reimbursement, deductibility, and supporting files.</p></div></div>
        ${pageToolbar("expenses", "Search vendor, category, purpose, or client", "add-expense", "Add expense")}
        <div class="panel table-panel">${state.expenses.length ? `
          <div class="table-wrap"><table class="data-table">
            <thead><tr><th>Date</th><th>Vendor / purpose</th><th>Ministry</th><th>Category</th><th>Client</th><th>Receipt</th><th>Status</th><th class="number">Amount</th><th><span class="sr-only">Actions</span></th></tr></thead>
            <tbody>${rows}</tbody></table></div><p class="no-search-results" hidden>No expenses match this search.</p>`
          : emptyState("No expenses recorded", "Add a business expense and attach one or more receipts.", "add-expense", "Add expense")}</div>
      </section>`;
  }

  function incomeComputedStatus(item) {
    if (item.payment_status === "void") return "void";
    const paid = amountPaid(item.id);
    if (paid <= 0 && item.due_date && item.due_date < today()) return "overdue";
    if (paid <= 0) return "unpaid";
    if (paid < num(item.amount)) return "partial";
    return "paid";
  }

  function renderIncome() {
    const rows = state.income.map((item) => {
      const paid = amountPaid(item.id);
      const linkedInvoice = invoicePortal?.invoiceForIncome(item.id);
      const status = linkedInvoice && item.payment_status === "unpaid" && (!item.due_date || item.due_date >= today())
        ? "pending"
        : incomeComputedStatus(item);
      const haystack = [item.income_date, item.payer_name, item.invoice_number, item.description, programName(item.program), clientName(item.client_id), item.payment_method, status].join(" ").toLowerCase();
      return `<tr data-search-row="${escapeHtml(haystack)}">
        <td>${shortDate(item.income_date)}</td>
        <td><strong>${escapeHtml(item.payer_name)}</strong><small>${escapeHtml(item.description || "")}</small></td>
        <td>${escapeHtml(programName(item.program))}</td>
        <td>${escapeHtml(item.invoice_number || "-")}<small>${item.invoice_date ? `Issued ${shortDate(item.invoice_date)}` : ""}</small></td>
        <td>${escapeHtml(clientName(item.client_id))}</td>
        <td>${receiptBadge("income", item.id)}</td>
        <td>${statusBadge(status)}${item.cpa_review ? '<span class="mini-flag">CPA</span>' : ""}</td>
        <td class="number"><strong>${money(item.amount)}</strong><small>${money(paid)} received</small></td>
        <td class="row-actions"><button type="button" data-action="record-payment" data-id="${item.id}">Payment</button>${linkedInvoice ? `<button type="button" data-action="edit-invoice" data-id="${linkedInvoice.id}">Invoice</button>` : `<button type="button" data-action="edit-income" data-id="${item.id}">Edit</button><button type="button" data-action="delete-income" data-id="${item.id}">Delete</button>`}</td>
      </tr>`;
    }).join("");
    return `
      <section class="view">
        <div class="section-heading-row"><div><p class="section-kicker">Client revenue</p><h2>Income & invoices</h2><p>Record invoices, payments received, partial payments, and supporting documents.</p></div></div>
        ${pageToolbar("income", "Search client, invoice, description, or status", "add-income", "Add income", '<button class="secondary-button" type="button" data-action="add-invoice">+ Create invoice</button>')}
        <div class="panel table-panel">${state.income.length ? `
          <div class="table-wrap"><table class="data-table">
            <thead><tr><th>Income date</th><th>Payer / description</th><th>Ministry</th><th>Invoice</th><th>Client</th><th>Files</th><th>Status</th><th class="number">Invoice / received</th><th><span class="sr-only">Actions</span></th></tr></thead>
            <tbody>${rows}</tbody></table></div><p class="no-search-results" hidden>No income records match this search.</p>`
          : emptyState("No income recorded", "Add a client invoice or payment received to begin.", "add-income", "Add income")}</div>
      </section>`;
  }

  function renderMileage() {
    const included = state.mileage_entries.filter(
      (item) => item.tax_year === taxYear() && item.record_status === "included"
    );
    const total = mileageTotals(included);
    const rows = state.mileage_entries.map((item) => {
      const rate = mileageRateForDate(item.mileage_date);
      const haystack = [item.mileage_date, item.origin, item.destination, item.business_purpose, programName(item.program), clientName(item.client_id), projectName(item.project_id), item.notes].join(" ").toLowerCase();
      return `<tr data-search-row="${escapeHtml(haystack)}">
        <td>${shortDate(item.mileage_date)}</td>
        <td><strong>${escapeHtml(item.origin)}</strong><small>to ${escapeHtml(item.destination)}</small></td>
        <td><strong>${escapeHtml(item.business_purpose)}</strong><small>${escapeHtml(item.notes || "")}</small></td>
        <td>${escapeHtml(programName(item.program))}</td>
        <td>${escapeHtml(clientName(item.client_id))}<small>${escapeHtml(projectName(item.project_id))}</small></td>
        <td>${statusBadge(item.record_status)}${item.cpa_review ? '<span class="mini-flag">CPA</span>' : ""}</td>
        <td class="number"><strong>${num(item.miles).toFixed(1)} mi</strong><small>${rate ? `${rateDisplay(rate.rate_per_mile)} · ${money(mileageDeductionFor(item))}` : "Rate missing"}</small></td>
        <td class="row-actions"><button type="button" data-action="edit-mileage" data-id="${item.id}">Edit</button><button type="button" data-action="delete-mileage" data-id="${item.id}">Delete</button></td>
      </tr>`;
    }).join("");
    return `
      <section class="view">
        <div class="section-heading-row split-heading"><div><p class="section-kicker">Vehicle log</p><h2>Business mileage</h2><p>Document every trip with origin, destination, business purpose, client, and notes.</p></div><div class="standalone-metric"><span>${taxYear()} total</span><strong>${total.miles.toFixed(1)} mi</strong><small>${money(total.deduction)} estimated deduction${total.missingRateCount ? ` · ${total.missingRateCount} ${total.missingRateCount === 1 ? "trip" : "trips"} missing a rate` : ""}</small></div></div>
        ${pageToolbar("mileage", "Search route, purpose, client, or notes", "add-mileage", "Log mileage")}
        <div class="panel table-panel">${state.mileage_entries.length ? `
          <div class="table-wrap"><table class="data-table">
            <thead><tr><th>Date</th><th>Route</th><th>Business purpose</th><th>Ministry</th><th>Client / project</th><th>Status</th><th class="number">Miles / deduction</th><th><span class="sr-only">Actions</span></th></tr></thead>
            <tbody>${rows}</tbody></table></div><p class="no-search-results" hidden>No mileage entries match this search.</p>`
          : emptyState("No mileage logged", "Add your first business trip to begin the mileage ledger.", "add-mileage", "Log mileage")}</div>
      </section>`;
  }

  function renderClients() {
    const rows = state.clients.map((item) => {
      const projects = state.projects.filter((project) => project.client_id === item.id);
      const billed = state.income.filter((income) => income.client_id === item.id).reduce((sum, income) => sum + num(income.amount), 0);
      const haystack = [item.name, item.company, item.email, item.phone, item.notes, ...projects.map((project) => project.name)].join(" ").toLowerCase();
      return `<tr data-search-row="${escapeHtml(haystack)}">
        <td><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.company || "")}</small></td>
        <td>${escapeHtml(item.email || "-")}<small>${escapeHtml(item.phone || "")}</small></td>
        <td><div class="chip-list">${projects.length ? projects.map((project) => `<button type="button" data-action="edit-project" data-id="${project.id}">${escapeHtml(project.name)}</button>`).join("") : "<span>No projects</span>"}</div></td>
        <td class="number"><strong>${money(billed)}</strong><small>Total invoiced</small></td>
        <td>${item.is_active ? statusBadge("included").replace("Included", "Active") : statusBadge("excluded").replace("Excluded", "Inactive")}</td>
        <td class="row-actions"><button type="button" data-action="add-project" data-client-id="${item.id}">Project</button><button type="button" data-action="edit-client" data-id="${item.id}">Edit</button><button type="button" data-action="delete-client" data-id="${item.id}">Delete</button></td>
      </tr>`;
    }).join("");
    return `
      <section class="view">
        <div class="section-heading-row"><div><p class="section-kicker">Relationships</p><h2>Clients & projects</h2><p>Clients can stand alone. Every project must belong to a client, and can then be connected to income, expenses, and mileage.</p></div></div>
        ${pageToolbar("clients", "Search client, contact, project, or notes", "add-client", "Add client", '<button class="secondary-button" type="button" data-action="add-project">+ Add project</button>')}
        <div class="panel table-panel">${state.clients.length ? `
          <div class="table-wrap"><table class="data-table">
            <thead><tr><th>Client</th><th>Contact</th><th>Projects</th><th class="number">Invoiced</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
            <tbody>${rows}</tbody></table></div><p class="no-search-results" hidden>No clients match this search.</p>`
          : emptyState("No clients yet", "Add a client, then create optional projects for more detailed reporting.", "add-client", "Add client")}</div>
      </section>`;
  }

  function initialReportFilters() {
    return {
      preset: "ytd",
      mode: "all",
      date_from: yearStart(),
      date_to: today(),
      tax_year: String(taxYear()),
      program: "",
      category_id: "",
      client_id: "",
      project_id: "",
      vendor: "",
      payment_method: "",
      record_status: "included",
      receipt: "",
      reimbursement: "",
    };
  }

  function reportData() {
    if (!state.reportFilters) state.reportFilters = initialReportFilters();
    const filters = state.reportFilters;
    const dateMatch = (date, itemTaxYear) => {
      if (filters.date_from && date < filters.date_from) return false;
      if (filters.date_to && date > filters.date_to) return false;
      if (filters.tax_year && num(itemTaxYear || date.slice(0, 4)) !== num(filters.tax_year)) return false;
      return true;
    };
    const sharedMatch = (item, date, skipPaymentMethod = false) => {
      if (!dateMatch(date, item.tax_year)) return false;
      if (filters.client_id && item.client_id !== filters.client_id) return false;
      if (filters.project_id && item.project_id !== filters.project_id) return false;
      if (filters.program && item.program !== filters.program) return false;
      if (!skipPaymentMethod && filters.payment_method && item.payment_method !== filters.payment_method) return false;
      if (filters.record_status && item.record_status !== filters.record_status) return false;
      return true;
    };
    const expenses = state.expenses.filter((item) => {
      if (!sharedMatch(item, item.expense_date)) return false;
      if (filters.category_id && item.category_id !== filters.category_id) return false;
      if (filters.vendor && !item.vendor.toLowerCase().includes(filters.vendor.toLowerCase())) return false;
      const hasReceipt = attachmentsFor("expense", item.id).length > 0;
      if (filters.receipt === "present" && !hasReceipt) return false;
      if (filters.receipt === "missing" && hasReceipt) return false;
      if (filters.reimbursement === "reimbursable" && !item.reimbursable) return false;
      if (filters.reimbursement === "reimbursed" && !item.reimbursed) return false;
      if (filters.reimbursement === "outstanding" && (!item.reimbursable || item.reimbursed)) return false;
      return true;
    });
    const incomeCandidates = state.income.filter((item) => {
      if (filters.client_id && item.client_id !== filters.client_id) return false;
      if (filters.project_id && item.project_id !== filters.project_id) return false;
      if (filters.program && item.program !== filters.program) return false;
      if (filters.record_status && item.record_status !== filters.record_status) return false;
      return true;
    });
    const allowedIncome = new Set(incomeCandidates.map((item) => item.id));
    const payments = state.income_payments.filter((payment) => {
      if (!allowedIncome.has(payment.income_id)) return false;
      if (!dateMatch(payment.payment_date, payment.payment_date.slice(0, 4))) return false;
      if (filters.payment_method && payment.payment_method !== filters.payment_method) return false;
      return true;
    });
    const paymentIncomeIds = new Set(payments.map((payment) => payment.income_id));
    const income = incomeCandidates.filter(
      (item) => dateMatch(item.income_date, item.tax_year) || paymentIncomeIds.has(item.id)
    );
    const mileage = state.mileage_entries.filter((item) => {
      if (!dateMatch(item.mileage_date, item.tax_year)) return false;
      if (filters.client_id && item.client_id !== filters.client_id) return false;
      if (filters.project_id && item.project_id !== filters.project_id) return false;
      if (filters.program && item.program !== filters.program) return false;
      if (filters.record_status && item.record_status !== filters.record_status) return false;
      return true;
    });
    const attachmentIds = new Set([
      ...expenses.map((item) => `expense:${item.id}`),
      ...income.map((item) => `income:${item.id}`),
    ]);
    const attachments = state.attachments.filter((item) =>
      attachmentIds.has(`${item.record_type}:${item[`${item.record_type}_id`]}`)
    );
    const paypal = state.paypal_activity.filter((item) => {
      if (!dateMatch(paypalDate(item), paypalDate(item).slice(0, 4))) return false;
      if (filters.program && item.program !== filters.program) return false;
      return completedPayPal(item);
    });
    return { expenses, income, payments, mileage, attachments, paypal };
  }

  function selectOptions(items, valueKey, labelKey, selected, allLabel) {
    return `<option value="">${escapeHtml(allLabel)}</option>${items.map((item) =>
      `<option value="${escapeHtml(item[valueKey])}" ${item[valueKey] === selected ? "selected" : ""}>${escapeHtml(item[labelKey])}</option>`
    ).join("")}`;
  }

  function renderReports() {
    if (!state.reportFilters) state.reportFilters = initialReportFilters();
    const f = state.reportFilters;
    const years = [...new Set([
      currentYear(),
      ...state.expenses.map((item) => item.tax_year),
      ...state.income.map((item) => item.tax_year),
      ...state.mileage_entries.map((item) => item.tax_year),
      ...state.paypal_activity.map((item) => Number(paypalDate(item).slice(0, 4))),
    ])].sort((a, b) => b - a);
    const methods = [...new Set([
      ...PAYMENT_METHODS,
      ...state.expenses.map((item) => item.payment_method),
      ...state.income_payments.map((item) => item.payment_method),
    ].filter(Boolean))].sort();
    return `
      <section class="view reports-view">
        <div class="section-heading-row split-heading">
          <div><p class="section-kicker">CPA-ready reporting</p><h2>Build a tax package</h2><p>Filter the ledger, review the totals, then export a structured workbook, CSV, or PDF.</p></div>
          <div class="report-export-actions">
            <button class="secondary-button" type="button" data-action="export-csv">Export CSV</button>
            <button class="secondary-button" type="button" data-action="export-pdf">Export PDF</button>
            <button class="button" type="button" data-action="export-xlsx">CPA Tax Package</button>
          </div>
        </div>
        <div class="preset-bar" aria-label="Report presets">
          ${[
            ["ytd", "Year to date"],
            ["quarter", "Current quarter"],
            ["income-client", "Income by client"],
            ["expenses-category", "Expenses by category"],
            ["mileage", "Mileage"],
            ["funds", "Ministry funds"],
            ["missing-receipts", "Missing receipts"],
            ["all", "All transactions"],
          ].map(([value, label]) => `<button type="button" data-action="report-preset" data-preset="${value}" class="${f.preset === value ? "is-active" : ""}">${label}</button>`).join("")}
        </div>
        <form class="report-filter-panel" id="report-filter-form">
          <div class="filter-grid">
            <label>From<input type="date" name="date_from" value="${escapeHtml(f.date_from)}"></label>
            <label>To<input type="date" name="date_to" value="${escapeHtml(f.date_to)}"></label>
            <label>Tax year<select name="tax_year"><option value="">All years</option>${years.map((year) => `<option value="${year}" ${String(year) === f.tax_year ? "selected" : ""}>${year}</option>`).join("")}</select></label>
            <label>Ministry<select name="program"><option value="">All ministries</option><option value="ChristianSteps" ${f.program === "ChristianSteps" ? "selected" : ""}>Christian Steps</option><option value="HopeSojourns" ${f.program === "HopeSojourns" ? "selected" : ""}>Hope Sojourns</option><option value="JoshBeyondBorders" ${f.program === "JoshBeyondBorders" ? "selected" : ""}>Josh Beyond Borders pass-through</option><option value="Shared" ${f.program === "Shared" ? "selected" : ""}>Shared / administration</option></select></label>
            <label>Category<select name="category_id">${selectOptions(state.categories.filter((item) => item.is_active), "id", "name", f.category_id, "All categories")}</select></label>
            <label>Client<select name="client_id">${selectOptions(state.clients, "id", "name", f.client_id, "All clients")}</select></label>
            <label>Project<select name="project_id">${selectOptions(state.projects, "id", "name", f.project_id, "All projects")}</select></label>
            <label>Vendor<input type="search" name="vendor" value="${escapeHtml(f.vendor)}" placeholder="All vendors"></label>
            <label>Payment method<select name="payment_method"><option value="">All methods</option>${methods.map((method) => `<option value="${escapeHtml(method)}" ${method === f.payment_method ? "selected" : ""}>${escapeHtml(method)}</option>`).join("")}</select></label>
            <label>Record status<select name="record_status">
              <option value="">All statuses</option>
              <option value="included" ${f.record_status === "included" ? "selected" : ""}>Included</option>
              <option value="excluded" ${f.record_status === "excluded" ? "selected" : ""}>Excluded</option>
              <option value="needs_review" ${f.record_status === "needs_review" ? "selected" : ""}>Needs review</option>
            </select></label>
            <label>Receipt<select name="receipt">
              <option value="">Present or missing</option>
              <option value="present" ${f.receipt === "present" ? "selected" : ""}>Receipt present</option>
              <option value="missing" ${f.receipt === "missing" ? "selected" : ""}>Receipt missing</option>
            </select></label>
            <label>Reimbursement<select name="reimbursement">
              <option value="">All</option>
              <option value="reimbursable" ${f.reimbursement === "reimbursable" ? "selected" : ""}>Reimbursable</option>
              <option value="reimbursed" ${f.reimbursement === "reimbursed" ? "selected" : ""}>Reimbursed</option>
              <option value="outstanding" ${f.reimbursement === "outstanding" ? "selected" : ""}>Not yet reimbursed</option>
            </select></label>
            <label>Report focus<select name="mode">
              <option value="all" ${f.mode === "all" ? "selected" : ""}>All transactions</option>
              <option value="expenses" ${f.mode === "expenses" ? "selected" : ""}>Expenses</option>
              <option value="income" ${f.mode === "income" ? "selected" : ""}>Income</option>
              <option value="mileage" ${f.mode === "mileage" ? "selected" : ""}>Mileage</option>
              <option value="paypal" ${f.mode === "paypal" ? "selected" : ""}>PayPal &amp; funds</option>
            </select></label>
          </div>
          <button class="text-button filter-reset" type="button" data-action="reset-report">Reset filters</button>
        </form>
        <div id="report-results">${renderReportResults()}</div>
      </section>`;
  }

  function groupedTotals(items, keyFn, amountFn) {
    const totals = new Map();
    items.forEach((item) => {
      const key = keyFn(item);
      totals.set(key, (totals.get(key) || 0) + amountFn(item));
    });
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }

  function renderReportResults() {
    const data = reportData();
    const paypalFeeTotal = contributionFees(data.paypal);
    const expenseTotal = data.expenses.reduce(
      (sum, item) => sum + num(item.amount) * num(item.deductibility_percent) / 100,
      0
    ) + paypalFeeTotal;
    const incomeTotal = data.payments.reduce((sum, item) => sum + num(item.amount), 0) + contributionAmount(data.paypal);
    const mileageSummary = mileageTotals(data.mileage);
    const missing = data.expenses.filter((item) => !attachmentsFor("expense", item.id).length).length;
    const expenseGroups = groupedTotals(
      data.expenses,
      (item) => categoryName(item.category_id),
      (item) => num(item.amount) * num(item.deductibility_percent) / 100
    );
    if (paypalFeeTotal) expenseGroups.push(["PayPal processing fees", paypalFeeTotal]);
    const paymentParent = (payment) => byId(state.income, payment.income_id);
    const incomeGroups = groupedTotals(
      data.payments,
      (payment) => clientName(paymentParent(payment)?.client_id) === "-" ? (paymentParent(payment)?.payer_name || "Unassigned") : clientName(paymentParent(payment)?.client_id),
      (payment) => num(payment.amount)
    );
    groupedTotals(
      data.paypal.filter((item) => item.accounting_class === "contribution"),
      (item) => programName(item.program),
      (item) => Math.max(0, num(item.gross))
    ).forEach(([label, amount]) => {
      const existing = incomeGroups.find((item) => item[0] === label);
      if (existing) existing[1] += amount;
      else incomeGroups.push([label, amount]);
    });
    const mode = state.reportFilters.mode;
    const transactionRows = [];
    if (mode === "all" || mode === "expenses") {
      data.expenses.forEach((item) => transactionRows.push({
        date: item.expense_date,
        type: "Expense",
        party: item.vendor,
        detail: categoryName(item.category_id),
        client: clientName(item.client_id),
        status: statusLabel(item.record_status),
        amount: -num(item.amount),
      }));
    }
    if (mode === "all" || mode === "income") {
      data.payments.forEach((payment) => {
        const parent = paymentParent(payment);
        transactionRows.push({
          date: payment.payment_date,
          type: "Income",
          party: parent?.payer_name || "Client payment",
          detail: parent?.invoice_number || parent?.description || "Payment",
          client: clientName(parent?.client_id),
          status: statusLabel(parent?.record_status),
          amount: num(payment.amount),
        });
      });
    }
    if (mode === "all" || mode === "mileage") {
      data.mileage.forEach((item) => transactionRows.push({
        date: item.mileage_date,
        type: "Mileage",
        party: `${item.origin} to ${item.destination}`,
        detail: `${item.business_purpose} · ${mileageRateForDate(item.mileage_date) ? rateDisplay(mileageRateForDate(item.mileage_date).rate_per_mile) : "rate missing"}`,
        client: clientName(item.client_id),
        status: statusLabel(item.record_status),
        amount: null,
        miles: num(item.miles),
        deduction: mileageDeductionFor(item),
      }));
    }
    if (mode === "all" || mode === "paypal" || mode === "income") {
      data.paypal
        .filter((item) => mode !== "income" || item.accounting_class === "contribution")
        .forEach((item) => transactionRows.push({
          date: paypalDate(item),
          type: item.accounting_class === "contribution" ? "Contribution" : "PayPal fund activity",
          party: item.display_name,
          detail: `${programName(item.program)} · ${paypalAccountingLabel(item)}${num(item.fee) ? ` · fee ${money(item.fee)}` : ""}`,
          client: "-",
          status: item.distribution_status ? statusLabel(item.distribution_status) : statusLabel(item.status),
          amount: item.accounting_class === "agency_disbursement" || item.accounting_class === "internal_transfer"
            ? -Math.abs(num(item.net))
            : Math.max(0, num(item.gross)),
        }));
    }
    transactionRows.sort((a, b) => b.date.localeCompare(a.date));
    return `
      <div class="report-metrics">
        <article><span>Income received</span><strong>${money(incomeTotal)}</strong></article>
        <article><span>Deductible expenses</span><strong>${money(expenseTotal)}</strong></article>
        <article><span>Net</span><strong>${money(incomeTotal - expenseTotal)}</strong></article>
        <article><span>Mileage & tolls</span><strong>${mileageSummary.miles.toFixed(1)} mi</strong><small>${money(mileageSummary.deduction)} deduction · ${money(data.expenses.filter((item) => /toll/i.test(categoryName(item.category_id))).reduce((sum, item) => sum + num(item.amount), 0))} tolls${mileageSummary.missingRateCount ? ` · ${mileageSummary.missingRateCount} missing rate` : ""}</small></article>
        <article><span>Missing receipts</span><strong>${missing}</strong></article>
        <article><span>JBB pass-through balance</span><strong>${money(agencyBalance())}</strong><small>Liability, not CSM income</small></article>
      </div>
      <div class="report-summary-grid">
        <section class="panel"><div class="panel-heading"><div><p class="section-kicker">Expense summary</p><h2>By category</h2></div></div>
          ${expenseGroups.length ? `<ul class="summary-list">${expenseGroups.map(([label, total]) => `<li><span>${escapeHtml(label)}</span><strong>${money(total)}</strong></li>`).join("")}</ul>` : "<p class=\"muted-copy\">No expenses match these filters.</p>"}
        </section>
        <section class="panel"><div class="panel-heading"><div><p class="section-kicker">Income summary</p><h2>By client or ministry</h2></div></div>
          ${incomeGroups.length ? `<ul class="summary-list">${incomeGroups.map(([label, total]) => `<li><span>${escapeHtml(label)}</span><strong>${money(total)}</strong></li>`).join("")}</ul>` : "<p class=\"muted-copy\">No client payments match these filters.</p>"}
        </section>
      </div>
      <section class="panel report-ledger">
        <div class="panel-heading"><div><p class="section-kicker">Detailed ledger</p><h2>Filtered transactions</h2></div><span>${transactionRows.length} records</span></div>
        ${transactionRows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Type</th><th>Party / route</th><th>Detail</th><th>Client</th><th>Status</th><th class="number">Amount / miles</th></tr></thead>
          <tbody>${transactionRows.map((row) => `<tr><td>${shortDate(row.date)}</td><td>${escapeHtml(row.type)}</td><td><strong>${escapeHtml(row.party)}</strong></td><td>${escapeHtml(row.detail)}</td><td>${escapeHtml(row.client)}</td><td>${escapeHtml(row.status)}</td><td class="number">${row.miles != null ? `<strong>${row.miles.toFixed(1)} mi</strong><small>${money(row.deduction)} deduction</small>` : money(row.amount)}</td></tr>`).join("")}</tbody></table></div>`
          : emptyState("No matching transactions", "Adjust the filters or choose another report preset.")}
      </section>`;
  }

  function applyReportPreset(preset) {
    const year = taxYear();
    const base = initialReportFilters();
    base.preset = preset;
    if (preset === "quarter") {
      const now = new Date();
      const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
      const start = new Date(now.getFullYear(), quarterStartMonth, 1);
      const end = new Date(now.getFullYear(), quarterStartMonth + 3, 0);
      base.date_from = start.toISOString().slice(0, 10);
      base.date_to = end.toISOString().slice(0, 10);
    } else if (preset === "income-client") {
      base.mode = "income";
    } else if (preset === "expenses-category") {
      base.mode = "expenses";
    } else if (preset === "mileage") {
      base.mode = "mileage";
    } else if (preset === "funds") {
      base.mode = "paypal";
    } else if (preset === "missing-receipts") {
      base.mode = "expenses";
      base.receipt = "missing";
    } else if (preset === "all") {
      base.date_from = "";
      base.date_to = "";
      base.tax_year = "";
      base.record_status = "";
    } else {
      base.tax_year = String(year);
    }
    state.reportFilters = base;
    renderRoute();
  }

  function exportRows() {
    const data = reportData();
    const expenseRows = data.expenses.map((item) => ({
      Date: item.expense_date,
      Vendor: item.vendor,
      Ministry: programName(item.program),
      Category: categoryName(item.category_id),
      Description: item.description || "",
      "Business Purpose": item.business_purpose || "",
      Client: clientName(item.client_id),
      Project: projectName(item.project_id),
      "Payment Method": item.payment_method || "",
      Amount: num(item.amount),
      "Deductibility %": num(item.deductibility_percent),
      "Deductible Amount": num(item.amount) * num(item.deductibility_percent) / 100,
      Reimbursable: item.reimbursable ? "Yes" : "No",
      Reimbursed: item.reimbursed ? "Yes" : "No",
      Status: statusLabel(item.record_status),
      "Receipt Count": attachmentsFor("expense", item.id).length,
      "CPA Review": item.cpa_review ? "Yes" : "No",
      "CPA Notes": item.cpa_notes || "",
      Notes: item.notes || "",
      Created: item.created_at || "",
      Modified: item.updated_at || "",
    }));
    const incomeRows = data.income.map((item) => ({
      "Income Date": item.income_date,
      Ministry: programName(item.program),
      Client: clientName(item.client_id),
      Project: projectName(item.project_id),
      Payer: item.payer_name,
      "Invoice Number": item.invoice_number || "",
      "Invoice Date": item.invoice_date || "",
      "Due Date": item.due_date || "",
      "Invoice Amount": num(item.amount),
      "Amount Received in Period": data.payments
        .filter((payment) => payment.income_id === item.id)
        .reduce((sum, payment) => sum + num(payment.amount), 0),
      Outstanding: Math.max(0, num(item.amount) - amountPaid(item.id)),
      "Payment Status": statusLabel(incomeComputedStatus(item)),
      Description: item.description || "",
      Status: statusLabel(item.record_status),
      "Attachment Count": attachmentsFor("income", item.id).length,
      "CPA Review": item.cpa_review ? "Yes" : "No",
      "CPA Notes": item.cpa_notes || "",
      Notes: item.notes || "",
      Created: item.created_at || "",
      Modified: item.updated_at || "",
    }));
    const paymentRows = data.payments.map((payment) => {
      const item = byId(state.income, payment.income_id);
      return {
        "Payment Date": payment.payment_date,
        Client: clientName(item?.client_id),
        Payer: item?.payer_name || "",
        "Invoice Number": item?.invoice_number || "",
        Amount: num(payment.amount),
        "Payment Method": payment.payment_method || "",
        Reference: payment.reference_number || "",
        Notes: payment.notes || "",
      };
    });
    const mileageRows = data.mileage.map((item) => {
      const rate = mileageRateForDate(item.mileage_date);
      return {
        Date: item.mileage_date,
        Ministry: programName(item.program),
        Origin: item.origin,
        Destination: item.destination,
        "Business Purpose": item.business_purpose,
        Miles: num(item.miles),
        "Rate per Mile": rate ? num(rate.rate_per_mile) : "",
        "Rate Period": rate ? `${rate.effective_from} through ${rate.effective_to}` : "Missing rate",
        "Estimated Deduction": rate ? mileageDeductionFor(item) : "",
        Client: clientName(item.client_id),
        Project: projectName(item.project_id),
        Status: statusLabel(item.record_status),
        "CPA Review": item.cpa_review ? "Yes" : "No",
        "CPA Notes": item.cpa_notes || "",
        Notes: item.notes || "",
        Created: item.created_at || "",
        Modified: item.updated_at || "",
      };
    });
    const attachmentRows = data.attachments.map((item) => {
      const record = item.record_type === "expense" ? byId(state.expenses, item.expense_id) : byId(state.income, item.income_id);
      return {
        "Record Type": statusLabel(item.record_type),
        "Record Date": item.record_type === "expense" ? record?.expense_date : record?.income_date,
        "Vendor / Payer": item.record_type === "expense" ? record?.vendor : record?.payer_name,
        "File Name": item.file_name,
        "MIME Type": item.mime_type || "",
        "Size Bytes": item.size_bytes,
        Added: item.created_at || "",
      };
    });
    const cpaRows = [
      ...data.expenses.filter((item) => item.cpa_review).map((item) => ({ Type: "Expense", Date: item.expense_date, Record: item.vendor, Amount: num(item.amount), Notes: item.cpa_notes || "" })),
      ...data.income.filter((item) => item.cpa_review).map((item) => ({ Type: "Income", Date: item.income_date, Record: item.payer_name, Amount: num(item.amount), Notes: item.cpa_notes || "" })),
      ...data.mileage.filter((item) => item.cpa_review).map((item) => ({ Type: "Mileage", Date: item.mileage_date, Record: item.business_purpose, Amount: num(item.miles), Notes: item.cpa_notes || "" })),
    ];
    const paypalRows = data.paypal.map((item) => ({
      Date: paypalDate(item),
      Ministry: programName(item.program),
      "Accounting Treatment": paypalAccountingLabel(item),
      Direction: statusLabel(item.direction),
      Party: item.display_name,
      Email: item.counterparty_email || "",
      Item: item.item_title || "",
      "Transaction ID": item.transaction_id,
      "Event Code": item.event_code,
      Status: item.status,
      "Recipient Status": item.distribution_status || "",
      Gross: num(item.gross),
      Fee: num(item.fee),
      Net: num(item.net),
      "Recognized CSM Income": item.accounting_class === "contribution" ? Math.max(0, num(item.gross)) : 0,
      "JBB Liability Increase": item.accounting_class === "agency_receipt" ? Math.max(0, num(item.net)) : 0,
      "JBB Liability Decrease": item.accounting_class === "agency_disbursement" ? Math.abs(num(item.net)) : 0,
    }));
    const fundRows = ["ChristianSteps", "HopeSojourns", "JoshBeyondBorders"].map((program) => {
      const rows = data.paypal.filter((item) => item.program === program);
      return {
        Ministry: programName(program),
        "Gross Contributions": contributionAmount(rows),
        "PayPal Fees": contributionFees(rows),
        "JBB Gross Received": rows.filter((item) => item.accounting_class === "agency_receipt").reduce((sum, item) => sum + Math.max(0, num(item.gross)), 0),
        "JBB Net Liability Added": rows.filter((item) => item.accounting_class === "agency_receipt").reduce((sum, item) => sum + Math.max(0, num(item.net)), 0),
        "JBB Disbursed": rows.filter((item) => item.accounting_class === "agency_disbursement").reduce((sum, item) => sum + Math.abs(num(item.net)), 0),
      };
    });
    return { data, expenseRows, incomeRows, paymentRows, mileageRows, attachmentRows, cpaRows, paypalRows, fundRows };
  }

  function downloadBlob(name, type, content) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function csvCell(value) {
    const text = String(value ?? "");
    return `"${text.replaceAll('"', '""')}"`;
  }

  function rowsToCsv(rows) {
    if (!rows.length) return "";
    const headers = Object.keys(rows[0]);
    return [
      headers.map(csvCell).join(","),
      ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
    ].join("\r\n");
  }

  function exportCsv() {
    const { expenseRows, paymentRows, mileageRows, paypalRows } = exportRows();
    const rows = [
      ...expenseRows.map((row) => ({
        Type: "Expense",
        Date: row.Date,
        "Vendor / Client / Route": row.Vendor,
        Detail: row.Category,
        Amount: -row.Amount,
        Miles: "",
        "Rate per Mile": "",
        "Estimated Mileage Deduction": "",
        Status: row.Status,
      })),
      ...paymentRows.map((row) => ({
        Type: "Income",
        Date: row["Payment Date"],
        "Vendor / Client / Route": row.Payer,
        Detail: row["Invoice Number"],
        Amount: row.Amount,
        Miles: "",
        "Rate per Mile": "",
        "Estimated Mileage Deduction": "",
        Status: "Received",
      })),
      ...mileageRows.map((row) => ({
        Type: "Mileage",
        Date: row.Date,
        "Vendor / Client / Route": `${row.Origin} to ${row.Destination}`,
        Detail: row["Business Purpose"],
        Amount: "",
        Miles: row.Miles,
        "Rate per Mile": row["Rate per Mile"],
        "Estimated Mileage Deduction": row["Estimated Deduction"],
        Status: row.Status,
      })),
      ...paypalRows.map((row) => ({
        Type: row["Accounting Treatment"],
        Date: row.Date,
        "Vendor / Client / Route": row.Party,
        Detail: row.Ministry,
        Amount: row["Accounting Treatment"] === "JBB pass-through paid" || row["Accounting Treatment"] === "Internal transfer" ? -Math.abs(row.Net) : row.Gross,
        Miles: "",
        "Rate per Mile": "",
        "Estimated Mileage Deduction": "",
        Status: row.Status,
      })),
    ].sort((a, b) => String(a.Date).localeCompare(String(b.Date)));
    downloadBlob(
      `christiansteps-transactions-${today()}.csv`,
      "text/csv;charset=utf-8",
      "\ufeff" + rowsToCsv(rows)
    );
    toast("CSV export created.");
  }

  function exportXlsx() {
    if (!window.XLSX) {
      toast("The Excel export library did not load. Please check your connection.", "error");
      return;
    }
    const { data, expenseRows, incomeRows, paymentRows, mileageRows, attachmentRows, cpaRows, paypalRows, fundRows } = exportRows();
    const expenseGroups = groupedTotals(
      data.expenses,
      (item) => categoryName(item.category_id),
      (item) => num(item.amount) * num(item.deductibility_percent) / 100
    );
    const incomeGroups = groupedTotals(
      data.payments,
      (payment) => {
        const income = byId(state.income, payment.income_id);
        return clientName(income?.client_id) === "-" ? income?.payer_name || "Unassigned" : clientName(income?.client_id);
      },
      (payment) => num(payment.amount)
    );
    const incomeTotal = data.payments.reduce((sum, item) => sum + num(item.amount), 0) + contributionAmount(data.paypal);
    const expenseTotal = expenseGroups.reduce((sum, item) => sum + item[1], 0) + contributionFees(data.paypal);
    const mileageSummary = mileageTotals(data.mileage);
    const ratesApplied = [...new Set(
      data.mileage
        .map((item) => mileageRateForDate(item.mileage_date))
        .filter(Boolean)
        .map((item) => rateDisplay(item.rate_per_mile))
    )].join(", ") || "None";
    const summary = [
      { Metric: "Business", Value: state.settings.business_name },
      { Metric: "Report generated", Value: new Date().toLocaleString() },
      { Metric: "Date range", Value: `${state.reportFilters.date_from || "All"} through ${state.reportFilters.date_to || "All"}` },
      { Metric: "Income received", Value: incomeTotal },
      { Metric: "Deductible expenses", Value: expenseTotal },
      { Metric: "Net ministry operations", Value: incomeTotal - expenseTotal },
      { Metric: "JBB pass-through balance (all time)", Value: agencyBalance() },
      { Metric: "Business miles", Value: mileageSummary.miles },
      { Metric: "Mileage rates applied", Value: ratesApplied },
      { Metric: "Estimated mileage deduction", Value: mileageSummary.deduction },
      { Metric: "Mileage entries missing a rate", Value: mileageSummary.missingRateCount },
      { Metric: "Attachment count", Value: attachmentRows.length },
      { Metric: "CPA review items", Value: cpaRows.length },
    ];
    const workbook = XLSX.utils.book_new();
    const addSheet = (name, rows) =>
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(rows.length ? rows : [{ Notice: "No matching records" }]),
        name
      );
    addSheet("Summary", summary);
    addSheet("Expense Categories", expenseGroups.map(([Category, Amount]) => ({ Category, Amount })));
    addSheet("Expense Ledger", expenseRows);
    addSheet("Income by Client", incomeGroups.map(([Client, Amount]) => ({ Client, Amount })));
    addSheet("Income Ledger", incomeRows);
    addSheet("Payment Ledger", paymentRows);
    addSheet("Ministry Fund Summary", fundRows);
    addSheet("PayPal Activity", paypalRows);
    addSheet("Mileage Log", mileageRows);
    addSheet("Attachment Index", attachmentRows);
    addSheet("CPA Review", cpaRows);
    XLSX.writeFile(workbook, `ChristianSteps-CPA-Tax-Package-${today()}.xlsx`, {
      compression: true,
    });
    toast("CPA Tax Package workbook created.");
  }

  function exportPdf() {
    const JsPdf = window.jspdf?.jsPDF;
    if (!JsPdf) {
      window.print();
      toast("Use the print dialog to save this report as PDF.");
      return;
    }
    const { data, expenseRows, incomeRows, paymentRows, mileageRows, attachmentRows, cpaRows, paypalRows, fundRows } = exportRows();
    const expenseTotal = expenseRows.reduce((sum, row) => sum + num(row["Deductible Amount"]), 0) + contributionFees(data.paypal);
    const incomeTotal = paymentRows.reduce((sum, row) => sum + num(row.Amount), 0) + contributionAmount(data.paypal);
    const mileageSummary = mileageTotals(data.mileage);
    const expenseGroups = groupedTotals(
      data.expenses,
      (item) => categoryName(item.category_id),
      (item) => num(item.amount) * num(item.deductibility_percent) / 100
    );
    const incomeGroups = groupedTotals(
      data.payments,
      (payment) => {
        const income = byId(state.income, payment.income_id);
        return clientName(income?.client_id) === "-" ? income?.payer_name || "Unassigned" : clientName(income?.client_id);
      },
      (payment) => num(payment.amount)
    );
    const documentPdf = new JsPdf({ orientation: "landscape", unit: "pt", format: "letter" });
    const left = 38;
    documentPdf.setTextColor(17, 61, 92);
    documentPdf.setFont("helvetica", "bold");
    documentPdf.setFontSize(18);
    documentPdf.text("Christian Steps Ministries - CPA Tax Package", left, 42);
    documentPdf.setFont("helvetica", "normal");
    documentPdf.setFontSize(9);
    documentPdf.setTextColor(90, 105, 114);
    documentPdf.text(
      `Generated ${new Date().toLocaleString()} | ${state.reportFilters.date_from || "All dates"} through ${state.reportFilters.date_to || "All dates"}`,
      left,
      59
    );
    const autoTable = documentPdf.autoTable?.bind(documentPdf);
    if (!autoTable) {
      documentPdf.text(`Income received: ${money(incomeTotal)}`, left, 85);
      documentPdf.text(`Deductible expenses: ${money(expenseTotal)}`, left, 101);
      documentPdf.text(`Business mileage: ${mileageSummary.miles.toFixed(1)} miles`, left, 117);
      documentPdf.text(`Estimated mileage deduction: ${money(mileageSummary.deduction)}`, left, 133);
      if (mileageSummary.missingRateCount) {
        documentPdf.text(`Mileage entries missing a rate: ${mileageSummary.missingRateCount}`, left, 149);
      }
    } else {
      autoTable({
        startY: 72,
        head: [["Income received", "Deductible expenses", "Net", "Business miles", "Mileage deduction", "Missing rate", "CPA review items"]],
        body: [[money(incomeTotal), money(expenseTotal), money(incomeTotal - expenseTotal), mileageSummary.miles.toFixed(1), money(mileageSummary.deduction), mileageSummary.missingRateCount, cpaRows.length]],
        theme: "grid",
        headStyles: { fillColor: [13, 75, 115] },
      });
      const section = (title, head, body) => {
        const lastY = documentPdf.lastAutoTable?.finalY || 72;
        if (lastY > 470) documentPdf.addPage();
        const y = documentPdf.lastAutoTable?.finalY > 470 ? 42 : lastY + 28;
        documentPdf.setFont("helvetica", "bold");
        documentPdf.setFontSize(12);
        documentPdf.setTextColor(17, 61, 92);
        documentPdf.text(title, left, y);
        autoTable({
          startY: y + 8,
          head: [head],
          body: body.length ? body : [["No matching records"]],
          theme: "striped",
          headStyles: { fillColor: [17, 61, 92], fontSize: 7 },
          bodyStyles: { fontSize: 7 },
          margin: { left, right: left },
        });
      };
      section(
        "Expense categories",
        ["Category", "Deductible amount"],
        expenseGroups.map(([category, amount]) => [category, money(amount)])
      );
      section(
        "Detailed expense ledger",
        ["Date", "Vendor", "Category", "Purpose", "Client", "Amount", "Deductible", "Receipt", "Status"],
        expenseRows.map((row) => [row.Date, row.Vendor, row.Category, row["Business Purpose"], row.Client, money(row.Amount), money(row["Deductible Amount"]), row["Receipt Count"], row.Status])
      );
      section(
        "Income by client",
        ["Client", "Payments received"],
        incomeGroups.map(([clientLabel, amount]) => [clientLabel, money(amount)])
      );
      section(
        "Detailed income ledger",
        ["Income date", "Payer", "Client", "Invoice", "Invoice amount", "Received in period", "Outstanding", "Status"],
        incomeRows.map((row) => [row["Income Date"], row.Payer, row.Client, row["Invoice Number"], money(row["Invoice Amount"]), money(row["Amount Received in Period"]), money(row.Outstanding), row["Payment Status"]])
      );
      section(
        "Detailed income payment ledger",
        ["Date", "Payer", "Client", "Invoice", "Method", "Reference", "Amount"],
        paymentRows.map((row) => [row["Payment Date"], row.Payer, row.Client, row["Invoice Number"], row["Payment Method"], row.Reference, money(row.Amount)])
      );
      section(
        "Ministry fund summary",
        ["Ministry", "Gross contributions", "PayPal fees", "JBB gross received", "JBB liability added", "JBB disbursed"],
        fundRows.map((row) => [row.Ministry, money(row["Gross Contributions"]), money(row["PayPal Fees"]), money(row["JBB Gross Received"]), money(row["JBB Net Liability Added"]), money(row["JBB Disbursed"])])
      );
      section(
        "PayPal and pass-through activity",
        ["Date", "Ministry", "Treatment", "Party", "Gross", "Fee", "Net", "Recipient status"],
        paypalRows.map((row) => [row.Date, row.Ministry, row["Accounting Treatment"], row.Party, money(row.Gross), money(row.Fee), money(row.Net), row["Recipient Status"]])
      );
      section(
        "Mileage log",
        ["Date", "Origin", "Destination", "Business purpose", "Client", "Miles", "Rate", "Deduction", "Status"],
        mileageRows.map((row) => [row.Date, row.Origin, row.Destination, row["Business Purpose"], row.Client, row.Miles, row["Rate per Mile"] === "" ? "Missing" : rateDisplay(row["Rate per Mile"]), row["Estimated Deduction"] === "" ? "" : money(row["Estimated Deduction"]), row.Status])
      );
      section(
        "Attachment index",
        ["Type", "Record date", "Vendor / payer", "File name", "File type", "Size bytes", "Added"],
        attachmentRows.map((row) => [row["Record Type"], row["Record Date"], row["Vendor / Payer"], row["File Name"], row["MIME Type"], row["Size Bytes"], row.Added])
      );
      section(
        "CPA review items",
        ["Type", "Date", "Record", "Amount / miles", "Question or note"],
        cpaRows.map((row) => [row.Type, row.Date, row.Record, row.Amount, row.Notes])
      );
    }
    documentPdf.save(`ChristianSteps-CPA-Tax-Package-${today()}.pdf`);
    toast("CPA Tax Package PDF created.");
  }

  function renderSettings() {
    const rateRows = [...state.mileage_rates]
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from))
      .map((item) => `
        <tr>
          <td><strong>${shortDate(item.effective_from)} - ${shortDate(item.effective_to)}</strong><small>${escapeHtml(item.label || "Custom mileage rate")}</small></td>
          <td><strong class="rate-value">${rateDisplay(item.rate_per_mile)}</strong><small>${money(item.rate_per_mile)} per mile</small></td>
          <td>${item.is_active ? "Active" : "Inactive"}</td>
          <td class="row-actions"><button type="button" data-action="edit-mileage-rate" data-id="${item.id}">Edit</button><button type="button" data-action="delete-mileage-rate" data-id="${item.id}">Delete</button></td>
        </tr>`).join("");
    const categoryRows = [...state.categories]
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
      .map((item) => `
        <tr>
          <td><span class="color-dot" style="--category-color:${escapeHtml(item.color)}"></span><strong>${escapeHtml(item.name)}</strong></td>
          <td>${escapeHtml(item.tax_line || "-")}</td>
          <td>${item.is_active ? "Active" : "Inactive"}</td>
          <td class="row-actions"><button type="button" data-action="edit-category" data-id="${item.id}">Edit</button><button type="button" data-action="toggle-category" data-id="${item.id}">${item.is_active ? "Deactivate" : "Activate"}</button></td>
        </tr>`).join("");
    return `
      <section class="view">
        <div class="section-heading-row"><div><p class="section-kicker">Administration</p><h2>Bookkeeping settings</h2><p>Set reporting defaults, manage expense categories, and review the security model.</p></div></div>
        <div class="settings-grid">
          <section class="panel settings-panel">
            <div class="panel-heading"><div><p class="section-kicker">Business profile</p><h2>Reporting defaults</h2></div></div>
            <form class="record-form settings-form" data-form="settings">
              <label class="field field-wide">Business name<input name="business_name" required value="${escapeHtml(state.settings.business_name)}"></label>
              <label class="field">Default tax year<input name="default_tax_year" type="number" min="2000" max="2100" required value="${state.settings.default_tax_year}"></label>
              <label class="field">Currency code<input name="currency_code" maxlength="3" required value="${escapeHtml(state.settings.currency_code)}"></label>
              <label class="field">Contact email<input name="contact_email" type="email" value="${escapeHtml(state.settings.contact_email || state.user.email || "")}"></label>
              <div class="form-footer field-wide"><button class="button" type="submit">Save settings</button></div>
            </form>
          </section>
          <section class="panel security-panel">
            <div class="panel-heading"><div><p class="section-kicker">Security</p><h2>Private by design</h2></div></div>
            <ul class="security-list">
              <li><strong>Signed in as</strong><span>${escapeHtml(state.user.email || "Christian Steps Administrator")}</span></li>
              <li><strong>Database access</strong><span>Private Cloudflare D1 through the authenticated API</span></li>
              <li><strong>Session protection</strong><span>Secure HTTP-only cookie, CSRF checks, and rate limiting</span></li>
              <li><strong>Attachments</strong><span>Private Cloudflare R2 bucket</span></li>
            </ul>
            ${state.demo
              ? '<p class="demo-note">This local preview uses temporary in-memory sample data only.</p>'
              : `<form class="record-form settings-form password-form" data-form="password">
                  <label class="field field-wide">Current password<input name="current_password" type="password" autocomplete="current-password" required></label>
                  <label class="field">New password<input name="new_password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label>
                  <label class="field">Confirm new password<input name="confirm_password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label>
                  <p class="security-note field-wide">Use at least 12 characters and at least three of: uppercase letters, lowercase letters, numbers, and symbols.</p>
                  <div class="form-footer field-wide"><button class="button" type="submit">Change password</button></div>
                </form>`}
          </section>
        </div>
        <section class="panel mileage-rates-panel">
          <div class="panel-heading"><div><p class="section-kicker">Date-driven deduction</p><h2>Mileage rates</h2><p>Each trip automatically uses the active rate covering its travel date.</p></div><button class="button" type="button" data-action="add-mileage-rate">+ Add rate</button></div>
          <p class="settings-help">Active date ranges cannot overlap. The 2026 IRS business rates are 72.5¢ per mile from January 1 through June 30 and 76¢ per mile from July 1 through December 31. <a href="https://www.irs.gov/tax-professionals/standard-mileage-rates?nav=2" target="_blank" rel="noopener noreferrer">View IRS mileage rates</a>.</p>
          ${state.mileage_rates.length
            ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Date range</th><th>Rate</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${rateRows}</tbody></table></div>`
            : emptyState("No mileage rates configured", "Add a date range and rate so mileage deductions can be calculated.", "add-mileage-rate", "Add mileage rate")}
        </section>
        <section class="panel categories-panel">
          <div class="panel-heading"><div><p class="section-kicker">Extensible categories</p><h2>Expense categories</h2></div><button class="button" type="button" data-action="add-category">+ Add category</button></div>
          <div class="table-wrap"><table class="data-table"><thead><tr><th>Category</th><th>CPA / tax line</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${categoryRows}</tbody></table></div>
        </section>
      </section>`;
  }

  function optionList(items, selected, placeholder, labelFn = (item) => item.name) {
    return `<option value="">${escapeHtml(placeholder)}</option>${items.map((item) =>
      `<option value="${item.id}" ${item.id === selected ? "selected" : ""}>${escapeHtml(labelFn(item))}</option>`
    ).join("")}`;
  }

  function methodOptions(selected) {
    const methods = [...new Set([...PAYMENT_METHODS, selected].filter(Boolean))];
    return `<option value="">Select method</option>${methods.map((method) =>
      `<option value="${escapeHtml(method)}" ${method === selected ? "selected" : ""}>${escapeHtml(method)}</option>`
    ).join("")}`;
  }

  function recordStatusOptions(selected) {
    return [
      ["included", "Included"],
      ["excluded", "Excluded"],
      ["needs_review", "Needs review"],
    ].map(([value, label]) =>
      `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`
    ).join("");
  }

  function attachmentEditor(type, id) {
    if (!id) return "";
    const items = attachmentsFor(type, id);
    if (!items.length) return '<p class="muted-copy">No files attached yet.</p>';
    return `<ul class="attachment-list">${items.map((item) => `
      <li><button type="button" class="attachment-open" data-action="view-attachment" data-id="${item.id}">${escapeHtml(item.file_name)}</button>
      <span>${item.size_bytes ? `${Math.max(1, Math.round(item.size_bytes / 1024))} KB` : ""}</span>
      <button type="button" class="attachment-remove" data-action="remove-attachment" data-id="${item.id}">Remove</button></li>`
    ).join("")}</ul>`;
  }

  function auditLine(item) {
    if (!item?.created_at && !item?.updated_at) return "";
    const format = (value) => value ? new Date(value).toLocaleString() : "-";
    return `<p class="audit-line">Created ${escapeHtml(format(item.created_at))} <span aria-hidden="true">|</span> Modified ${escapeHtml(format(item.updated_at || item.created_at))}</p>`;
  }

  function dialogFrame(title, subtitle, content, size = "") {
    const dialog = $("#record-dialog");
    dialog.className = `record-dialog ${size}`;
    dialog.innerHTML = `
      <div class="dialog-header">
        <div><p class="section-kicker">Christian Steps ledger</p><h2 id="dialog-title">${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div>
        <button class="dialog-close" type="button" data-action="close-dialog" aria-label="Close dialog">Close</button>
      </div>
      ${content}`;
    dialog.showModal();
  }

  function expenseForm(item = null) {
    const record = item || {
      expense_date: today(),
      vendor: "",
      amount: "",
      program: "HopeSojourns",
      category_id: "",
      description: "",
      business_purpose: "",
      payment_method: "",
      client_id: "",
      project_id: "",
      tax_year: taxYear(),
      reimbursable: false,
      reimbursed: false,
      deductibility_percent: 100,
      record_status: "included",
      cpa_review: false,
      cpa_notes: "",
      notes: "",
    };
    dialogFrame(
      item ? "Edit expense" : "Add business expense",
      "Capture the tax details now so the record is useful at year end.",
      `<form class="record-form" data-form="expense" data-id="${item?.id || ""}">
        <div class="form-section">
          <h3>Expense details</h3>
          <div class="form-grid">
            <label class="field">Date<input name="expense_date" type="date" required value="${escapeHtml(record.expense_date)}"></label>
            <label class="field field-grow">Vendor / merchant<input name="vendor" required maxlength="180" value="${escapeHtml(record.vendor)}"></label>
            <label class="field">Amount<input name="amount" type="number" min="0.01" step="0.01" required value="${escapeHtml(record.amount)}"></label>
            <label class="field">Category<select name="category_id">${optionList(state.categories.filter((category) => category.is_active || category.id === record.category_id), record.category_id, "Select category")}</select></label>
            <label class="field field-wide">Description<input name="description" value="${escapeHtml(record.description || "")}" placeholder="What was purchased?"></label>
            <label class="field field-wide">Business purpose<textarea name="business_purpose" rows="2" placeholder="Why was this a business expense?">${escapeHtml(record.business_purpose || "")}</textarea></label>
          </div>
        </div>
        <div class="form-section">
          <h3>Classification</h3>
          <div class="form-grid">
            <label class="field">Ministry program<select name="program" required>${programOptions(record.program || "HopeSojourns")}</select></label>
            <label class="field">Payment method<select name="payment_method">${methodOptions(record.payment_method)}</select></label>
            <label class="field">Client<select name="client_id">${optionList(state.clients.filter((clientItem) => clientItem.is_active), record.client_id, "No client")}</select></label>
            <label class="field">Project<select name="project_id">${optionList(state.projects.filter((project) => project.is_active), record.project_id, "No project", (project) => `${clientName(project.client_id)} - ${project.name}`)}</select></label>
            <label class="field">Tax year<input name="tax_year" type="number" min="2000" max="2100" required value="${record.tax_year}"></label>
            <label class="field">Deductibility %<input name="deductibility_percent" type="number" min="0" max="100" step="0.01" required value="${num(record.deductibility_percent)}"></label>
            <label class="field">Record status<select name="record_status">${recordStatusOptions(record.record_status)}</select></label>
          </div>
          <div class="check-grid">
            <label><input name="reimbursable" type="checkbox" ${record.reimbursable ? "checked" : ""}> Reimbursable</label>
            <label><input name="reimbursed" type="checkbox" ${record.reimbursed ? "checked" : ""}> Already reimbursed</label>
            <label><input name="cpa_review" type="checkbox" ${record.cpa_review ? "checked" : ""}> Flag for CPA review</label>
          </div>
        </div>
        <div class="form-section">
          <h3>Receipts & review notes</h3>
          <div class="form-grid">
            <label class="field field-wide file-field">Add photos or files<input name="attachments" type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"><small>Up to 15 MB per file. Images, PDFs, documents, and spreadsheets are supported.</small></label>
            <div class="field field-wide"><span>Existing files</span>${attachmentEditor("expense", item?.id)}</div>
            <label class="field field-wide">CPA question / note<textarea name="cpa_notes" rows="2">${escapeHtml(record.cpa_notes || "")}</textarea></label>
            <label class="field field-wide">Internal notes<textarea name="notes" rows="2">${escapeHtml(record.notes || "")}</textarea></label>
          </div>
        </div>
        <div class="duplicate-warning" data-duplicate-warning hidden></div>
        ${auditLine(item)}
        <div class="form-footer"><button class="secondary-button" type="button" data-action="close-dialog">Cancel</button><button class="button" type="submit">${item ? "Save changes" : "Save expense"}</button></div>
      </form>`,
      "dialog-wide"
    );
  }

  function incomeForm(item = null) {
    const record = item || {
      income_date: today(),
      client_id: "",
      project_id: "",
      payer_name: "",
      invoice_number: "",
      invoice_date: today(),
      due_date: "",
      amount: "",
      program: "HopeSojourns",
      payment_status: "unpaid",
      description: "",
      payment_method: "",
      tax_year: taxYear(),
      record_status: "included",
      cpa_review: false,
      cpa_notes: "",
      notes: "",
    };
    dialogFrame(
      item ? "Edit income record" : "Add income or invoice",
      "Record the invoice and any payment received now. Additional partial payments can be added later.",
      `<form class="record-form" data-form="income" data-id="${item?.id || ""}">
        <div class="form-section">
          <h3>Client & invoice</h3>
          <div class="form-grid">
            <label class="field">Income date<input name="income_date" type="date" required value="${escapeHtml(record.income_date)}"></label>
            <label class="field">Client<select name="client_id">${optionList(state.clients.filter((clientItem) => clientItem.is_active), record.client_id, "No client")}</select></label>
            <label class="field">Project<select name="project_id">${optionList(state.projects.filter((project) => project.is_active), record.project_id, "No project", (project) => `${clientName(project.client_id)} - ${project.name}`)}</select></label>
            <label class="field field-grow">Payer / client name<input name="payer_name" required maxlength="180" value="${escapeHtml(record.payer_name)}"></label>
            <label class="field">Invoice number<input name="invoice_number" value="${escapeHtml(record.invoice_number || "")}"></label>
            <label class="field">Invoice date<input name="invoice_date" type="date" value="${escapeHtml(record.invoice_date || "")}"></label>
            <label class="field">Due date<input name="due_date" type="date" value="${escapeHtml(record.due_date || "")}"></label>
            <label class="field">Invoice amount<input name="amount" type="number" min="0.01" step="0.01" required value="${escapeHtml(record.amount)}"></label>
            <label class="field field-wide">Description<input name="description" value="${escapeHtml(record.description || "")}" placeholder="Services or engagement covered"></label>
          </div>
        </div>
        <div class="form-section">
          <h3>Payment & tax treatment</h3>
          <div class="form-grid">
            <label class="field">Ministry program<select name="program" required>${programOptions(record.program || "HopeSojourns", false)}</select></label>
            ${item ? `<div class="field"><span>Received to date</span><strong class="field-readout">${money(amountPaid(item.id))}</strong></div><div class="field"><span>Outstanding</span><strong class="field-readout">${money(Math.max(0, num(item.amount) - amountPaid(item.id)))}</strong></div>` : `
              <label class="field">Amount received now<input name="initial_payment_amount" type="number" min="0" step="0.01" value=""></label>
              <label class="field">Payment method<select name="payment_method">${methodOptions(record.payment_method)}</select></label>
              <label class="field">Payment reference<input name="payment_reference" placeholder="Check or transfer reference"></label>
            `}
            <label class="field">Tax year<input name="tax_year" type="number" min="2000" max="2100" required value="${record.tax_year}"></label>
            <label class="field">Record status<select name="record_status">${recordStatusOptions(record.record_status)}</select></label>
          </div>
          <div class="check-grid"><label><input name="cpa_review" type="checkbox" ${record.cpa_review ? "checked" : ""}> Flag for CPA review</label></div>
        </div>
        ${item ? `<div class="form-section">
          <h3>Payment history</h3>
          ${paymentsFor(item.id).length ? `<ul class="payment-history">${paymentsFor(item.id)
            .sort((a, b) => b.payment_date.localeCompare(a.payment_date))
            .map((payment) => `<li><span><strong>${shortDate(payment.payment_date)} - ${money(payment.amount)}</strong><small>${escapeHtml(payment.payment_method || "Method not recorded")}${payment.reference_number ? ` - ${escapeHtml(payment.reference_number)}` : ""}</small></span><button type="button" data-action="delete-payment" data-id="${payment.id}">Delete</button></li>`)
            .join("")}</ul>` : '<p class="muted-copy">No payments have been recorded.</p>'}
        </div>` : ""}
        <div class="form-section">
          <h3>Documents & notes</h3>
          <div class="form-grid">
            <label class="field field-wide file-field">Add photos or files<input name="attachments" type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"><small>Attach invoices, deposit confirmations, checks, or related documents.</small></label>
            <div class="field field-wide"><span>Existing files</span>${attachmentEditor("income", item?.id)}</div>
            <label class="field field-wide">CPA question / note<textarea name="cpa_notes" rows="2">${escapeHtml(record.cpa_notes || "")}</textarea></label>
            <label class="field field-wide">Internal notes<textarea name="notes" rows="2">${escapeHtml(record.notes || "")}</textarea></label>
          </div>
        </div>
        <div class="duplicate-warning" data-duplicate-warning hidden></div>
        ${auditLine(item)}
        <div class="form-footer"><button class="secondary-button" type="button" data-action="close-dialog">Cancel</button><button class="button" type="submit">${item ? "Save changes" : "Save income"}</button></div>
      </form>`,
      "dialog-wide"
    );
  }

  function tripWeekDates(value) {
    const anchor = new Date(`${value || today()}T12:00:00Z`);
    const day = anchor.getUTCDay();
    const monday = new Date(anchor);
    monday.setUTCDate(anchor.getUTCDate() - (day === 0 ? 6 : day - 1));
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(monday);
      date.setUTCDate(monday.getUTCDate() + index);
      return date.toISOString().slice(0, 10);
    });
  }

  function selectedMileageDates(form) {
    const baseDate = form.elements.mileage_date?.value;
    const selected = form.elements.repeat_trip?.checked
      ? $$('input[name="batch_date"]:checked', form).map((input) => input.value)
      : [];
    return [...new Set([baseDate, ...selected].filter(Boolean))].sort();
  }

  function renderTripWeek(form) {
    const container = $("[data-trip-week]", form);
    if (!container) return;
    const baseDate = form.elements.mileage_date.value || today();
    const selected = new Set(selectedMileageDates(form));
    const formatter = new Intl.DateTimeFormat("en-US", {
      month: "short", day: "numeric", timeZone: "UTC",
    });
    container.innerHTML = tripWeekDates(baseDate).map((date) => {
      const label = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" })
        .format(new Date(`${date}T12:00:00Z`));
      const isBase = date === baseDate;
      return `<label class="trip-date-option ${isBase ? "is-base" : ""}">
        <input type="checkbox" name="batch_date" value="${date}" ${isBase || selected.has(date) ? "checked" : ""} ${isBase ? "disabled" : ""}>
        <span><strong>${label}</strong><small>${formatter.format(new Date(`${date}T12:00:00Z`))}</small></span>
      </label>`;
    }).join("");
  }

  function updateMileagePreview(form) {
    if (form.dataset.id) return;
    const dates = selectedMileageDates(form);
    const tripCount = Math.max(1, dates.length);
    const miles = num(form.elements.miles?.value);
    const tollAmount = num(form.elements.toll_amount?.value);
    const preview = $("[data-mileage-preview]", form);
    if (preview) {
      preview.innerHTML = `
        <div><span>Trip dates</span><strong>${tripCount}</strong></div>
        <div><span>Total mileage</span><strong>${(miles * tripCount).toFixed(1)} mi</strong></div>
        <div><span>Toll expenses</span><strong>${tollAmount > 0 ? money(tollAmount * tripCount) : "None"}</strong></div>
        <p>${dates.length ? dates.map(shortDate).join(" · ") : "Choose a trip date."}${tollAmount > 0 ? ` Each date will receive a separate ${money(tollAmount)} toll expense.` : ""}</p>`;
    }
    const submit = $('button[type="submit"]', form);
    if (submit && !form.dataset.saveDuplicate) {
      submit.dataset.defaultLabel = tripCount > 1 ? `Save ${tripCount} trips` : "Save trip";
      submit.textContent = submit.dataset.defaultLabel;
    }
  }

  function syncNewMileageForm(form, rebuildWeek = false) {
    if (!form || form.dataset.id) return;
    const repeatPanel = $("[data-repeat-trip-panel]", form);
    if (repeatPanel) repeatPanel.hidden = !form.elements.repeat_trip.checked;
    if (rebuildWeek || form.elements.repeat_trip.checked) renderTripWeek(form);
    const favoriteName = $("[data-favorite-name]", form);
    if (favoriteName) favoriteName.hidden = !form.elements.save_as_template.checked;
    form.elements.template_name.required = form.elements.save_as_template.checked;
    const deleteFavorite = $("[data-action='delete-trip-template']", form);
    if (deleteFavorite) deleteFavorite.disabled = !form.elements.trip_template_id.value;
    updateMileagePreview(form);
  }

  function applyTripTemplate(form, templateId) {
    const template = byId(state.trip_templates, templateId);
    if (!template) return;
    [
      ["origin", template.origin],
      ["destination", template.destination],
      ["business_purpose", template.business_purpose],
      ["miles", template.miles],
      ["program", template.program || "HopeSojourns"],
      ["client_id", template.client_id || ""],
      ["project_id", template.project_id || ""],
      ["toll_amount", template.toll_amount || ""],
      ["toll_vendor", template.toll_vendor || ""],
      ["toll_payment_method", template.payment_method || ""],
      ["notes", template.notes || ""],
    ].forEach(([name, value]) => {
      if (form.elements[name]) form.elements[name].value = value;
    });
    updateMileagePreview(form);
  }

  function mileageForm(item = null) {
    const record = item || {
      mileage_date: today(),
      origin: "",
      destination: "",
      business_purpose: "",
      miles: "",
      program: "HopeSojourns",
      client_id: "",
      project_id: "",
      tax_year: taxYear(),
      record_status: "included",
      cpa_review: false,
      cpa_notes: "",
      notes: "",
    };
    if (item) {
      dialogFrame(
        "Edit mileage entry",
        "Update this individual mileage record. Any linked toll expense remains a separate expense record.",
        `<form class="record-form" data-form="mileage" data-id="${item.id}">
          <div class="form-section"><div class="form-grid">
            <label class="field">Date<input name="mileage_date" type="date" required value="${escapeHtml(record.mileage_date)}"></label>
            <label class="field field-grow">Origin<input name="origin" required value="${escapeHtml(record.origin)}"></label>
            <label class="field field-grow">Destination<input name="destination" required value="${escapeHtml(record.destination)}"></label>
            <label class="field">Miles<input name="miles" type="number" min="0.01" step="0.01" required value="${escapeHtml(record.miles)}"></label>
            <label class="field">Ministry program<select name="program" required>${programOptions(record.program || "HopeSojourns")}</select></label>
            <label class="field field-wide">Business purpose<textarea name="business_purpose" rows="2" required>${escapeHtml(record.business_purpose)}</textarea></label>
            <label class="field">Client<select name="client_id">${optionList(state.clients.filter((clientItem) => clientItem.is_active), record.client_id, "No client")}</select></label>
            <label class="field">Project<select name="project_id">${optionList(state.projects.filter((project) => project.is_active), record.project_id, "No project", (project) => `${clientName(project.client_id)} - ${project.name}`)}</select></label>
            <label class="field">Tax year<input name="tax_year" type="number" min="2000" max="2100" required value="${record.tax_year}"></label>
            <label class="field">Record status<select name="record_status">${recordStatusOptions(record.record_status)}</select></label>
            <label class="field field-wide">Notes<textarea name="notes" rows="2">${escapeHtml(record.notes || "")}</textarea></label>
            <label class="field field-wide"><span class="check-label"><input name="cpa_review" type="checkbox" ${record.cpa_review ? "checked" : ""}> Flag for CPA review</span></label>
            <label class="field field-wide">CPA question / note<textarea name="cpa_notes" rows="2">${escapeHtml(record.cpa_notes || "")}</textarea></label>
          </div></div>
          <div class="duplicate-warning" data-duplicate-warning hidden></div>
          ${auditLine(item)}
          <div class="form-footer"><button class="secondary-button" type="button" data-action="close-dialog">Cancel</button><button class="button" type="submit" data-default-label="Save changes">Save changes</button></div>
        </form>`,
        "dialog-wide"
      );
      return;
    }

    const templates = state.trip_templates.filter((template) => template.is_active);
    dialogFrame(
      "Log mileage & tolls",
      "Enter one trip, choose every date it happened, and create the matching mileage and toll records together.",
      `<form class="record-form" data-form="mileage">
        <div class="form-section">
          <h3>Saved trip</h3>
          <div class="favorite-trip-row">
            <label class="field field-grow">Use a favorite trip
              <select name="trip_template_id">${optionList(templates, "", "Choose a saved trip")}</select>
              <small>Choosing a favorite fills the route, miles, tolls, client, and purpose.</small>
            </label>
            <button class="secondary-button compact-button" type="button" data-action="delete-trip-template" disabled>Delete favorite</button>
          </div>
        </div>
        <div class="form-section">
          <h3>Trip details</h3>
          <div class="form-grid">
            <label class="field">First date<input name="mileage_date" type="date" required value="${escapeHtml(record.mileage_date)}"></label>
            <label class="field field-grow">Origin<input name="origin" required maxlength="240" value="${escapeHtml(record.origin)}" placeholder="Street, city, or office"></label>
            <label class="field field-grow">Destination<input name="destination" required maxlength="240" value="${escapeHtml(record.destination)}" placeholder="Street, city, or client site"></label>
            <label class="field">Miles for each date<input name="miles" type="number" min="0.01" step="0.01" required value="${escapeHtml(record.miles)}"></label>
            <label class="field field-wide">Business purpose<textarea name="business_purpose" rows="2" maxlength="500" required>${escapeHtml(record.business_purpose)}</textarea></label>
            <label class="field field-wide"><span class="check-label"><input name="repeat_trip" type="checkbox"> Repeat this same trip on other days this week</span></label>
            <div class="repeat-trip-panel field-wide" data-repeat-trip-panel hidden>
              <p>Select every day this same trip occurred. The first date stays selected.</p>
              <div class="trip-date-grid" data-trip-week></div>
            </div>
          </div>
        </div>
        <div class="form-section toll-section">
          <h3>Tolls & classification</h3>
          <div class="form-grid">
            <label class="field">Tolls for each date
              <input name="toll_amount" type="number" min="0" step="0.01" value="" placeholder="0.00">
              <small>Leave at $0 when there were no tolls.</small>
            </label>
            <label class="field">Toll provider / vendor<input name="toll_vendor" maxlength="180" placeholder="NTTA or toll road"></label>
            <label class="field">Toll payment method<select name="toll_payment_method">${methodOptions("")}</select></label>
            <label class="field">Ministry program<select name="program" required>${programOptions(record.program || "HopeSojourns")}</select></label>
            <label class="field">Client<select name="client_id">${optionList(state.clients.filter((clientItem) => clientItem.is_active), record.client_id, "No client")}</select></label>
            <label class="field">Project<select name="project_id">${optionList(state.projects.filter((project) => project.is_active), record.project_id, "No project", (project) => `${clientName(project.client_id)} - ${project.name}`)}</select></label>
            <label class="field">Record status<select name="record_status">${recordStatusOptions(record.record_status)}</select></label>
          </div>
        </div>
        <div class="form-section">
          <h3>Notes & review</h3>
          <div class="form-grid">
            <label class="field field-wide">Notes<textarea name="notes" rows="2">${escapeHtml(record.notes || "")}</textarea></label>
            <label class="field field-wide"><span class="check-label"><input name="cpa_review" type="checkbox"> Flag mileage and tolls for CPA review</span></label>
            <label class="field field-wide">CPA question / note<textarea name="cpa_notes" rows="2"></textarea></label>
            <label class="field field-wide"><span class="check-label"><input name="save_as_template" type="checkbox"> Save these details as a favorite trip</span></label>
            <label class="field field-wide" data-favorite-name hidden>Favorite name<input name="template_name" maxlength="100" placeholder="For example: Weekly Dallas client visit"></label>
          </div>
        </div>
        <div class="mileage-preview" data-mileage-preview aria-live="polite"></div>
        <div class="duplicate-warning" data-duplicate-warning hidden></div>
        <div class="form-footer"><button class="secondary-button" type="button" data-action="close-dialog">Cancel</button><button class="button" type="submit" data-default-label="Save trip">Save trip</button></div>
      </form>`,
      "dialog-wide"
    );
    syncNewMileageForm($("form[data-form='mileage']", $("#record-dialog")), true);
  }
  function clientForm(item = null) {
    const record = item || { name: "", company: "", email: "", phone: "", notes: "", is_active: true };
    dialogFrame(
      item ? "Edit client" : "Add client",
      "Clients can be connected to expenses, invoices, payments, mileage, and projects.",
      `<form class="record-form" data-form="client" data-id="${item?.id || ""}">
        <div class="form-section"><div class="form-grid">
          <label class="field field-grow">Client name<input name="name" required maxlength="160" value="${escapeHtml(record.name)}"></label>
          <label class="field field-grow">Company<input name="company" value="${escapeHtml(record.company || "")}"></label>
          <label class="field">Email<input name="email" type="email" value="${escapeHtml(record.email || "")}"></label>
          <label class="field">Phone<input name="phone" type="tel" value="${escapeHtml(record.phone || "")}"></label>
          <label class="field field-wide">Notes<textarea name="notes" rows="3">${escapeHtml(record.notes || "")}</textarea></label>
          <label class="field field-wide"><span class="check-label"><input name="is_active" type="checkbox" ${record.is_active ? "checked" : ""}> Active client</span></label>
        </div></div>
        <div class="form-footer"><button class="secondary-button" type="button" data-action="close-dialog">Cancel</button><button class="button" type="submit">${item ? "Save changes" : "Save client"}</button></div>
      </form>`
    );
  }

  function projectForm(item = null, clientId = "") {
    const record = item || { client_id: clientId, name: "", description: "", start_date: "", end_date: "", is_active: true };
    dialogFrame(
      item ? "Edit project" : "Add project",
      "Every project must belong to one client. Clients can be saved without projects.",
      `<form class="record-form" data-form="project" data-id="${item?.id || ""}">
        <div class="form-section"><div class="form-grid">
          <label class="field">Client<select name="client_id" required>${optionList(state.clients.filter((clientItem) => clientItem.is_active), record.client_id, "Select client")}</select></label>
          <label class="field field-grow">Project name<input name="name" required maxlength="160" value="${escapeHtml(record.name)}"></label>
          <label class="field">Start date<input name="start_date" type="date" value="${escapeHtml(record.start_date || "")}"></label>
          <label class="field">End date<input name="end_date" type="date" value="${escapeHtml(record.end_date || "")}"></label>
          <label class="field field-wide">Description<textarea name="description" rows="3">${escapeHtml(record.description || "")}</textarea></label>
          <label class="field field-wide"><span class="check-label"><input name="is_active" type="checkbox" ${record.is_active ? "checked" : ""}> Active project</span></label>
        </div></div>
        <div class="form-footer">${item ? `<button class="danger-button" type="button" data-action="delete-project" data-id="${item.id}">Delete project</button>` : ""}<button class="secondary-button" type="button" data-action="close-dialog">Cancel</button><button class="button" type="submit">${item ? "Save changes" : "Save project"}</button></div>
      </form>`
    );
  }

  function paymentForm(incomeItem) {
    const outstanding = Math.max(0, num(incomeItem.amount) - amountPaid(incomeItem.id));
    dialogFrame(
      "Record client payment",
      `${incomeItem.payer_name} - ${incomeItem.invoice_number || "Income record"} - ${money(outstanding)} outstanding`,
      `<form class="record-form" data-form="payment" data-income-id="${incomeItem.id}">
        <div class="form-section"><div class="form-grid">
          <label class="field">Payment date<input name="payment_date" type="date" required value="${today()}"></label>
          <label class="field">Amount<input name="amount" type="number" min="0.01" step="0.01" required value="${outstanding || ""}"></label>
          <label class="field">Payment method<select name="payment_method">${methodOptions(incomeItem.payment_method)}</select></label>
          <label class="field">Reference number<input name="reference_number" placeholder="Check, ACH, or deposit reference"></label>
          <label class="field field-wide">Notes<textarea name="notes" rows="2"></textarea></label>
        </div></div>
        <div class="form-footer"><button class="secondary-button" type="button" data-action="close-dialog">Cancel</button><button class="button" type="submit">Save payment</button></div>
      </form>`
    );
  }

  function mileageRateForm(item = null) {
    const latestEnd = state.mileage_rates.reduce(
      (latest, rate) => rate.effective_to > latest ? rate.effective_to : latest,
      ""
    );
    let defaultFrom = yearStart();
    if (latestEnd) {
      const nextDate = new Date(`${latestEnd}T12:00:00Z`);
      nextDate.setUTCDate(nextDate.getUTCDate() + 1);
      defaultFrom = nextDate.toISOString().slice(0, 10);
    }
    const record = item || {
      effective_from: defaultFrom,
      effective_to: yearEnd(Number(defaultFrom.slice(0, 4))),
      rate_per_mile: "",
      label: "",
      is_active: true,
    };
    dialogFrame(
      item ? "Edit mileage rate" : "Add mileage rate",
      "The rate will be applied automatically to trips dated within this range.",
      `<form class="record-form" data-form="mileage-rate" data-id="${item?.id || ""}">
        <div class="form-section"><div class="form-grid">
          <label class="field">Starting date<input name="effective_from" type="date" required value="${escapeHtml(record.effective_from)}"></label>
          <label class="field">Ending date<input name="effective_to" type="date" required value="${escapeHtml(record.effective_to)}"></label>
          <label class="field">Rate per mile (dollars)<input name="rate_per_mile" type="number" min="0" max="100" step="0.001" required value="${record.rate_per_mile === "" ? "" : num(record.rate_per_mile)}"><small>Example: enter 0.76 for 76 cents per mile.</small></label>
          <label class="field field-grow">Label<input name="label" maxlength="180" value="${escapeHtml(record.label || "")}" placeholder="Example: IRS business rate - Jul through Dec 2026"></label>
          <label class="field field-wide"><span class="check-label"><input name="is_active" type="checkbox" ${record.is_active ? "checked" : ""}> Active rate</span></label>
        </div></div>
        ${auditLine(item)}
        <div class="form-footer">${item ? `<button class="danger-button" type="button" data-action="delete-mileage-rate" data-id="${item.id}">Delete rate</button>` : ""}<button class="secondary-button" type="button" data-action="close-dialog">Cancel</button><button class="button" type="submit">${item ? "Save changes" : "Add rate"}</button></div>
      </form>`
    );
  }

  function categoryForm(item = null) {
    const record = item || { name: "", tax_line: "", color: "#0d4b73", is_active: true, sort_order: state.categories.length };
    dialogFrame(
      item ? "Edit expense category" : "Add expense category",
      "Use tax-line notes to make category mapping clearer for your CPA.",
      `<form class="record-form" data-form="category" data-id="${item?.id || ""}">
        <div class="form-section"><div class="form-grid">
          <label class="field field-grow">Category name<input name="name" required maxlength="100" value="${escapeHtml(record.name)}"></label>
          <label class="field field-grow">CPA / tax line<input name="tax_line" value="${escapeHtml(record.tax_line || "")}" placeholder="Example: Travel"></label>
          <label class="field">Color<input name="color" type="color" value="${escapeHtml(record.color)}"></label>
          <label class="field">Sort order<input name="sort_order" type="number" step="1" value="${num(record.sort_order)}"></label>
          <label class="field field-wide"><span class="check-label"><input name="is_active" type="checkbox" ${record.is_active ? "checked" : ""}> Active category</span></label>
        </div></div>
        <div class="form-footer"><button class="secondary-button" type="button" data-action="close-dialog">Cancel</button><button class="button" type="submit">${item ? "Save changes" : "Save category"}</button></div>
      </form>`
    );
  }

  function openGlobalSearch() {
    const dialog = $("#search-dialog");
    dialog.innerHTML = `
      <div class="dialog-header">
        <div><p class="section-kicker">All bookkeeping</p><h2 id="search-dialog-title">Search every record</h2><p>Search vendors, clients, invoices, business purposes, projects, and routes.</p></div>
        <button class="dialog-close" type="button" data-action="close-search" aria-label="Close search">Close</button>
      </div>
      <label class="global-search-field"><span class="sr-only">Search all records</span><input type="search" data-global-search autofocus placeholder="Start typing a name, amount, invoice, or purpose..."></label>
      <div class="global-search-results" data-global-search-results>${globalSearchResults("")}</div>`;
    dialog.showModal();
    setTimeout(() => $("[data-global-search]", dialog)?.focus(), 20);
  }

  function globalSearchResults(query) {
    const normalized = query.trim().toLowerCase();
    const results = [];
    const match = (values) => !normalized || values.join(" ").toLowerCase().includes(normalized);
    state.expenses.forEach((item) => {
      if (match([item.vendor, item.description, item.business_purpose, categoryName(item.category_id), clientName(item.client_id), item.amount])) {
        results.push({ type: "Expense", date: item.expense_date, title: item.vendor, detail: `${categoryName(item.category_id)} - ${money(item.amount)}`, action: "edit-expense", id: item.id });
      }
    });
    state.income.forEach((item) => {
      if (match([item.payer_name, item.invoice_number, item.description, clientName(item.client_id), item.amount])) {
        results.push({ type: "Income", date: item.income_date, title: item.payer_name, detail: `${item.invoice_number || "No invoice"} - ${money(item.amount)}`, action: "edit-income", id: item.id });
      }
    });
    state.mileage_entries.forEach((item) => {
      if (match([item.origin, item.destination, item.business_purpose, clientName(item.client_id), item.miles])) {
        results.push({ type: "Mileage", date: item.mileage_date, title: `${item.origin} to ${item.destination}`, detail: `${item.business_purpose} - ${num(item.miles).toFixed(1)} mi`, action: "edit-mileage", id: item.id });
      }
    });
    state.clients.forEach((item) => {
      if (match([item.name, item.company, item.email, item.phone, item.notes])) {
        results.push({ type: "Client", date: item.updated_at?.slice(0, 10) || "", title: item.name, detail: item.company || item.email || "Client", action: "edit-client", id: item.id });
      }
    });
    results.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const limited = results.slice(0, 40);
    if (!limited.length) return emptyState("No matching records", "Try a vendor, client, invoice number, purpose, or amount.");
    return `<ul class="search-result-list">${limited.map((item) => `
      <li><button type="button" data-action="${item.action}" data-id="${item.id}">
        <span class="type-chip type-${item.type.toLowerCase()}">${item.type}</span>
        <span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></span>
        <time>${item.date ? shortDate(item.date) : ""}</time>
      </button></li>`).join("")}</ul>`;
  }

  function duplicateFor(formType, payload, id) {
    if (formType === "expense") {
      return state.expenses.find((item) =>
        item.id !== id &&
        item.expense_date === payload.expense_date &&
        num(item.amount) === num(payload.amount) &&
        item.vendor.trim().toLowerCase() === payload.vendor.trim().toLowerCase()
      );
    }
    if (formType === "income") {
      return state.income.find((item) =>
        item.id !== id && (
          (payload.invoice_number && item.invoice_number?.trim().toLowerCase() === payload.invoice_number.trim().toLowerCase()) ||
          (item.income_date === payload.income_date &&
            num(item.amount) === num(payload.amount) &&
            item.payer_name.trim().toLowerCase() === payload.payer_name.trim().toLowerCase())
        )
      );
    }
    if (formType === "mileage") {
      return state.mileage_entries.find((item) =>
        item.id !== id &&
        item.mileage_date === payload.mileage_date &&
        num(item.miles) === num(payload.miles) &&
        item.origin.trim().toLowerCase() === payload.origin.trim().toLowerCase() &&
        item.destination.trim().toLowerCase() === payload.destination.trim().toLowerCase()
      );
    }
    return null;
  }

  function requireDuplicateConfirmation(form, type, payload, id) {
    const duplicate = duplicateFor(type, payload, id);
    if (!duplicate || form.dataset.saveDuplicate === "confirmed") return false;
    const warning = $("[data-duplicate-warning]", form);
    warning.hidden = false;
    warning.innerHTML = `<strong>Possible duplicate found.</strong><span>A record with the same date, amount, and identifying details already exists. Review it, or submit again to save anyway.</span>`;
    form.dataset.saveDuplicate = "confirmed";
    const submit = $('button[type="submit"]', form);
    submit.textContent = "Save anyway";
    submit.disabled = false;
    warning.scrollIntoView({ behavior: "smooth", block: "center" });
    return true;
  }

  async function uploadAttachments(files, type, recordId) {
    const validFiles = [...files].filter((file) => file.size > 0);
    for (const file of validFiles) {
      if (file.size > 15728640) throw new Error(`${file.name} is larger than 15 MB.`);
      if (state.demo) {
        state.attachments.push({
          id: uid(),
          owner_id: state.user.id,
          record_type: type,
          expense_id: type === "expense" ? recordId : null,
          income_id: type === "income" ? recordId : null,
          file_name: file.name,
          mime_type: file.type || null,
          size_bytes: file.size,
          created_at: new Date().toISOString(),
        });
        continue;
      }
      await apiRequest(
        `/attachments?recordType=${encodeURIComponent(type)}&recordId=${encodeURIComponent(recordId)}`,
        {
          method: "POST",
          body: file,
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "X-File-Name": encodeURIComponent(file.name),
          },
        }
      );
    }
  }
  async function refreshAfterSave(message) {
    if (!state.demo) await loadData();
    state.expenses.sort((a, b) => b.expense_date.localeCompare(a.expense_date));
    state.income.sort((a, b) => b.income_date.localeCompare(a.income_date));
    state.mileage_entries.sort((a, b) => b.mileage_date.localeCompare(a.mileage_date));
    $("#record-dialog").close();
    toast(message);
    renderRoute();
  }

  async function saveExpense(form) {
    const data = new FormData(form);
    const id = form.dataset.id || null;
    const files = form.elements.attachments.files;
    const selectedProjectId = clean(data.get("project_id"));
    const selectedProject = byId(state.projects, selectedProjectId);
    const payload = {
      expense_date: data.get("expense_date"),
      vendor: String(data.get("vendor")).trim(),
      amount: num(data.get("amount")),
      program: String(data.get("program") || "HopeSojourns"),
      category_id: clean(data.get("category_id")),
      description: clean(data.get("description")),
      business_purpose: clean(data.get("business_purpose")),
      payment_method: clean(data.get("payment_method")),
      client_id: selectedProject?.client_id || clean(data.get("client_id")),
      project_id: selectedProjectId,
      tax_year: num(data.get("tax_year")),
      reimbursable: form.elements.reimbursable.checked,
      reimbursed: form.elements.reimbursed.checked,
      deductibility_percent: num(data.get("deductibility_percent")),
      record_status: data.get("record_status"),
      cpa_review: form.elements.cpa_review.checked,
      cpa_notes: clean(data.get("cpa_notes")),
      notes: clean(data.get("notes")),
    };
    if (payload.reimbursed && !payload.reimbursable) {
      throw new Error("An expense must be marked reimbursable before it can be marked reimbursed.");
    }
    if (requireDuplicateConfirmation(form, "expense", payload, id)) return;
    const record = await saveRow("expenses", payload, id);
    await uploadAttachments(files, "expense", record.id);
    await refreshAfterSave(id ? "Expense updated." : "Expense saved.");
  }

  async function saveIncome(form) {
    const data = new FormData(form);
    const id = form.dataset.id || null;
    const existing = id ? byId(state.income, id) : null;
    const files = form.elements.attachments.files;
    const selectedProjectId = clean(data.get("project_id"));
    const selectedProject = byId(state.projects, selectedProjectId);
    const initialPayment = id ? 0 : num(data.get("initial_payment_amount"));
    const receivedToDate = id ? amountPaid(id) : initialPayment;
    const invoiceAmount = num(data.get("amount"));
    const payload = {
      income_date: data.get("income_date"),
      client_id: selectedProject?.client_id || clean(data.get("client_id")),
      project_id: selectedProjectId,
      payer_name: String(data.get("payer_name")).trim(),
      invoice_number: clean(data.get("invoice_number")),
      invoice_date: clean(data.get("invoice_date")),
      due_date: clean(data.get("due_date")),
      amount: invoiceAmount,
      program: String(data.get("program") || "HopeSojourns"),
      payment_status: existing?.payment_status === "void"
        ? "void"
        : receivedToDate <= 0
          ? "unpaid"
          : receivedToDate < invoiceAmount
            ? "partial"
            : "paid",
      description: clean(data.get("description")),
      payment_method: id ? existing?.payment_method : clean(data.get("payment_method")),
      tax_year: num(data.get("tax_year")),
      record_status: data.get("record_status"),
      cpa_review: form.elements.cpa_review.checked,
      cpa_notes: clean(data.get("cpa_notes")),
      notes: clean(data.get("notes")),
    };
    if (requireDuplicateConfirmation(form, "income", payload, id)) return;
    const record = await saveRow("income", payload, id);
    if (!id && initialPayment > 0) {
      await saveRow("income_payments", {
        income_id: record.id,
        payment_date: record.income_date,
        amount: initialPayment,
        payment_method: clean(data.get("payment_method")),
        reference_number: clean(data.get("payment_reference")),
        notes: null,
      });
    }
    await uploadAttachments(files, "income", record.id);
    await refreshAfterSave(id ? "Income record updated." : "Income record saved.");
  }

  function showMileageDuplicateWarning(form, message) {
    const warning = $("[data-duplicate-warning]", form);
    warning.hidden = false;
    warning.innerHTML = `<strong>Possible duplicate found.</strong><span>${escapeHtml(message)}</span>`;
    form.dataset.saveDuplicate = "confirmed";
    const submit = $('button[type="submit"]', form);
    submit.textContent = "Save anyway";
    submit.disabled = false;
    warning.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function createDemoTripBatch(payload) {
    const stamp = new Date().toISOString();
    const batchId = uid();
    let templateId = payload.template_id;
    if (payload.template_name) {
      if (state.trip_templates.some((item) => item.name.trim().toLowerCase() === payload.template_name.toLowerCase())) {
        const error = new Error("A saved trip with that name already exists.");
        error.code = "DUPLICATE_TEMPLATE";
        throw error;
      }
      templateId = uid();
      state.trip_templates.push({
        id: templateId,
        owner_id: state.user.id,
        name: payload.template_name,
        origin: payload.origin,
        destination: payload.destination,
        business_purpose: payload.business_purpose,
        miles: payload.miles,
        program: payload.program,
        toll_amount: payload.toll_amount,
        toll_vendor: payload.toll_vendor,
        payment_method: payload.toll_payment_method,
        client_id: payload.client_id,
        project_id: payload.project_id,
        notes: payload.notes,
        is_active: true,
        created_at: stamp,
        updated_at: stamp,
      });
    }
    const tollCategory = state.categories.find((category) => category.name.toLowerCase() === "tolls");
    if (payload.toll_amount > 0 && !tollCategory) throw new Error("Add a Tolls expense category before logging tolls.");
    payload.dates.forEach((date) => {
      state.mileage_entries.push({
        id: uid(),
        owner_id: state.user.id,
        mileage_date: date,
        origin: payload.origin,
        destination: payload.destination,
        business_purpose: payload.business_purpose,
        miles: payload.miles,
        program: payload.program,
        client_id: payload.client_id,
        project_id: payload.project_id,
        tax_year: Number(date.slice(0, 4)),
        record_status: payload.record_status,
        cpa_review: payload.cpa_review,
        cpa_notes: payload.cpa_notes,
        notes: payload.notes,
        trip_batch_id: batchId,
        trip_template_id: templateId,
        created_at: stamp,
        updated_at: stamp,
      });
      if (payload.toll_amount > 0) {
        state.expenses.push({
          id: uid(),
          owner_id: state.user.id,
          expense_date: date,
          vendor: payload.toll_vendor || "Tolls",
          amount: payload.toll_amount,
          program: payload.program,
          category_id: tollCategory.id,
          description: `Tolls: ${payload.origin} to ${payload.destination}`,
          business_purpose: payload.business_purpose,
          payment_method: payload.toll_payment_method,
          client_id: payload.client_id,
          project_id: payload.project_id,
          tax_year: Number(date.slice(0, 4)),
          reimbursable: false,
          reimbursed: false,
          deductibility_percent: 100,
          record_status: payload.record_status,
          cpa_review: payload.cpa_review,
          cpa_notes: payload.cpa_notes,
          notes: payload.notes,
          trip_batch_id: batchId,
          trip_template_id: templateId,
          created_at: stamp,
          updated_at: stamp,
        });
      }
    });
    return {
      mileageCount: payload.dates.length,
      tollCount: payload.toll_amount > 0 ? payload.dates.length : 0,
    };
  }

  async function saveMileage(form) {
    const data = new FormData(form);
    const id = form.dataset.id || null;
    const selectedProjectId = clean(data.get("project_id"));
    const selectedProject = byId(state.projects, selectedProjectId);
    const basePayload = {
      origin: String(data.get("origin")).trim(),
      destination: String(data.get("destination")).trim(),
      business_purpose: String(data.get("business_purpose")).trim(),
      miles: num(data.get("miles")),
      program: String(data.get("program") || "HopeSojourns"),
      client_id: selectedProject?.client_id || clean(data.get("client_id")),
      project_id: selectedProjectId,
      record_status: data.get("record_status"),
      cpa_review: form.elements.cpa_review.checked,
      cpa_notes: clean(data.get("cpa_notes")),
      notes: clean(data.get("notes")),
    };

    if (id) {
      const payload = {
        ...basePayload,
        mileage_date: data.get("mileage_date"),
        tax_year: num(data.get("tax_year")),
      };
      if (requireDuplicateConfirmation(form, "mileage", payload, id)) return;
      await saveRow("mileage_entries", payload, id);
      await refreshAfterSave("Mileage entry updated.");
      return;
    }

    const dates = selectedMileageDates(form);
    const payload = {
      dates,
      ...basePayload,
      toll_amount: num(data.get("toll_amount")),
      toll_vendor: clean(data.get("toll_vendor")) || "Tolls",
      toll_payment_method: clean(data.get("toll_payment_method")),
      template_id: clean(data.get("trip_template_id")),
      template_name: form.elements.save_as_template.checked ? String(data.get("template_name")).trim() : null,
      allow_duplicates: form.dataset.saveDuplicate === "confirmed",
    };
    if (!payload.allow_duplicates) {
      const duplicateDate = dates.find((date) => duplicateFor("mileage", {
        ...basePayload,
        mileage_date: date,
      }, null));
      if (duplicateDate) {
        showMileageDuplicateWarning(
          form,
          `A matching mileage entry already exists for ${shortDate(duplicateDate)}. Review the dates, or save again to include it.`
        );
        return;
      }
    }

    let result;
    if (state.demo) {
      result = createDemoTripBatch(payload);
    } else {
      try {
        result = await apiRequest("/trips/batch", { method: "POST", body: payload });
      } catch (error) {
        if (error.code === "POSSIBLE_DUPLICATE" && !payload.allow_duplicates) {
          const duplicateDates = [...new Set((error.details?.duplicates || []).map((item) => item.date))];
          const detail = duplicateDates.length
            ? `Possible matches were found on ${duplicateDates.map(shortDate).join(", ")}. Review the dates, or save again to include them.`
            : error.message;
          showMileageDuplicateWarning(form, detail);
          return;
        }
        throw error;
      }
    }
    const mileageLabel = result.mileageCount === 1 ? "1 mileage entry" : `${result.mileageCount} mileage entries`;
    const tollLabel = result.tollCount
      ? (result.tollCount === 1 ? " and 1 toll expense" : ` and ${result.tollCount} toll expenses`)
      : "";
    await refreshAfterSave(`${mileageLabel}${tollLabel} saved.`);
  }
  async function saveClient(form) {
    const data = new FormData(form);
    const id = form.dataset.id || null;
    await saveRow("clients", {
      name: String(data.get("name")).trim(),
      company: clean(data.get("company")),
      email: clean(data.get("email")),
      phone: clean(data.get("phone")),
      notes: clean(data.get("notes")),
      is_active: form.elements.is_active.checked,
    }, id);
    await refreshAfterSave(id ? "Client updated." : "Client added.");
  }

  async function saveProject(form) {
    const data = new FormData(form);
    const id = form.dataset.id || null;
    const clientId = String(data.get("client_id") || "");
    if (!clientId) throw new Error("Choose a client before saving the project.");
    await saveRow("projects", {
      client_id: clientId,
      name: String(data.get("name")).trim(),
      description: clean(data.get("description")),
      start_date: clean(data.get("start_date")),
      end_date: clean(data.get("end_date")),
      is_active: form.elements.is_active.checked,
    }, id);
    await refreshAfterSave(id ? "Project updated." : "Project added.");
  }

  async function savePayment(form) {
    const data = new FormData(form);
    const incomeId = form.dataset.incomeId;
    const item = byId(state.income, incomeId);
    const paymentAmount = num(data.get("amount"));
    const outstanding = Math.max(0, num(item.amount) - amountPaid(item.id));
    if (paymentAmount > outstanding && outstanding > 0 && !form.dataset.overpaymentConfirmed) {
      const confirmed = window.confirm(`This payment is ${money(paymentAmount - outstanding)} more than the outstanding balance. Save it as an overpayment?`);
      if (!confirmed) return;
      form.dataset.overpaymentConfirmed = "true";
    }
    await saveRow("income_payments", {
      income_id: incomeId,
      payment_date: data.get("payment_date"),
      amount: paymentAmount,
      payment_method: clean(data.get("payment_method")),
      reference_number: clean(data.get("reference_number")),
      notes: clean(data.get("notes")),
    });
    if (state.demo) {
      item.payment_status = amountPaid(item.id) >= num(item.amount) ? "paid" : "partial";
    }
    await refreshAfterSave("Payment recorded.");
  }

  async function saveCategory(form) {
    const data = new FormData(form);
    const id = form.dataset.id || null;
    await saveRow("categories", {
      name: String(data.get("name")).trim(),
      tax_line: clean(data.get("tax_line")),
      color: data.get("color"),
      is_active: form.elements.is_active.checked,
      sort_order: num(data.get("sort_order")),
    }, id);
    await refreshAfterSave(id ? "Category updated." : "Category added.");
  }

  async function saveMileageRate(form) {
    const data = new FormData(form);
    const id = form.dataset.id || null;
    const payload = {
      effective_from: String(data.get("effective_from")),
      effective_to: String(data.get("effective_to")),
      rate_per_mile: num(data.get("rate_per_mile")),
      label: clean(data.get("label")),
      is_active: form.elements.is_active.checked,
    };
    if (payload.effective_to < payload.effective_from) {
      throw new Error("The ending date must be on or after the starting date.");
    }
    if (payload.is_active) {
      const overlap = state.mileage_rates.find((item) =>
        item.id !== id &&
        item.is_active &&
        !(item.effective_to < payload.effective_from || item.effective_from > payload.effective_to)
      );
      if (overlap) {
        const error = new Error("This date range overlaps another active mileage rate.");
        error.code = "MILEAGE_RATE_OVERLAP";
        throw error;
      }
    }
    await saveRow("mileage_rates", payload, id);
    await refreshAfterSave(id ? "Mileage rate updated." : "Mileage rate added.");
  }

  async function saveSettings(form) {
    const data = new FormData(form);
    const payload = {
      business_name: String(data.get("business_name")).trim(),
      default_tax_year: num(data.get("default_tax_year")),
      currency_code: String(data.get("currency_code")).trim().toUpperCase(),
      contact_email: clean(data.get("contact_email")),
    };
    if (state.demo) {
      state.settings = { ...state.settings, ...payload, updated_at: new Date().toISOString() };
    } else {
      const result = await apiRequest("/settings", { method: "PATCH", body: payload });
      state.settings = result.settings;
    }
    $("[data-active-tax-year]").textContent = taxYear();
    toast("Settings saved.");
    renderRoute();
  }

  async function removeAttachment(id, ask = true) {
    const item = byId(state.attachments, id);
    if (!item) return;
    if (ask && !window.confirm(`Remove ${item.file_name}? This cannot be undone.`)) return;
    if (state.demo) {
      state.attachments = state.attachments.filter((attachment) => attachment.id !== id);
    } else {
      await apiRequest(`/attachments/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadData();
    }
    toast("Attachment removed.");
    $("#record-dialog").close();
    renderRoute();
  }

  async function viewAttachment(id) {
    const item = byId(state.attachments, id);
    if (!item) return;
    if (state.demo) {
      toast("Sample attachments are not stored in the local preview.", "info");
      return;
    }
    window.open(`${API_BASE}/attachments/${encodeURIComponent(id)}`, "_blank", "noopener,noreferrer");
  }
  async function deleteRecord(type, id) {
    const labels = { expense: "expense", income: "income record and its payments", mileage: "mileage entry", client: "client and its projects", project: "project" };
    if (!window.confirm(`Delete this ${labels[type]}? This cannot be undone.`)) return;
    if ((type === "expense" || type === "income") && state.demo) {
      const key = `${type}_id`;
      state.attachments = state.attachments.filter((item) => item[key] !== id);
      if (type === "income") {
        state.income_payments = state.income_payments.filter((payment) => payment.income_id !== id);
      }
    }
    const table = { expense: "expenses", income: "income", mileage: "mileage_entries", client: "clients", project: "projects" }[type];
    await deleteRow(table, id);
    if (!state.demo) await loadData();
    if ($("#record-dialog").open) $("#record-dialog").close();
    toast(`${statusLabel(type)} deleted.`);
    renderRoute();
  }

  async function deletePayment(id) {
    if (!window.confirm("Delete this payment? The invoice balance and status will be recalculated.")) return;
    const payment = byId(state.income_payments, id);
    const incomeItem = byId(state.income, payment?.income_id);
    await deleteRow("income_payments", id);
    if (state.demo && incomeItem) {
      const received = amountPaid(incomeItem.id);
      incomeItem.payment_status = received <= 0 ? "unpaid" : received < num(incomeItem.amount) ? "partial" : "paid";
    }
    if (!state.demo) await loadData();
    if ($("#record-dialog").open) $("#record-dialog").close();
    toast("Payment deleted.");
    renderRoute();
  }

  async function deleteTripTemplate(button) {
    const form = button.closest("form[data-form='mileage']");
    const id = form?.elements.trip_template_id?.value;
    if (!id) return;
    const template = byId(state.trip_templates, id);
    if (!window.confirm('Delete the saved trip "' + (template?.name || "Favorite trip") + '"? Existing mileage and toll records will not be deleted.')) return;
    await deleteRow("trip_templates", id);
    if (!state.demo) await loadData();
    $("#record-dialog").close();
    toast("Favorite trip deleted.");
    mileageForm();
  }

  async function deleteMileageRate(id) {
    const item = byId(state.mileage_rates, id);
    if (!item) return;
    if (!window.confirm(`Delete the mileage rate for ${shortDate(item.effective_from)} through ${shortDate(item.effective_to)}? Trips will remain, but deductions for dates without another rate will show as missing.`)) return;
    await deleteRow("mileage_rates", id);
    if (!state.demo) await loadData();
    if ($("#record-dialog").open) $("#record-dialog").close();
    toast("Mileage rate deleted.");
    renderRoute();
  }

  async function toggleCategory(id) {
    const item = byId(state.categories, id);
    await saveRow("categories", { is_active: !item.is_active }, id);
    if (!state.demo) await loadData();
    toast(item.is_active ? "Category deactivated." : "Category activated.");
    renderRoute();
  }

  function filterVisibleRows(input) {
    const query = input.value.trim().toLowerCase();
    const container = input.closest(".view");
    const rows = $$("[data-search-row]", container);
    let visible = 0;
    rows.forEach((row) => {
      const show = !query || row.dataset.searchRow.includes(query);
      row.hidden = !show;
      if (show) visible += 1;
    });
    const empty = $(".no-search-results", container);
    if (empty) empty.hidden = visible > 0;
  }

  async function handleAction(button) {
    const action = button.dataset.action;
    const id = button.dataset.id;
    if (!action) return;
    const closeSearchForRecord = () => {
      if ($("#search-dialog").open) $("#search-dialog").close();
    };
    switch (action) {
      case "donor-splits": await window.DonationSplits.open({load:()=>apiRequest('/donation-splits/'+encodeURIComponent(id)),save:body=>apiRequest('/donation-splits/'+encodeURIComponent(id),{method:'PUT',body}),onSaved:()=>toast('Donor allocations saved. The original payment is unchanged.','success')});break;
      case "add-expense": expenseForm(); break;
      case "edit-expense": closeSearchForRecord(); expenseForm(byId(state.expenses, id)); break;
      case "delete-expense": await deleteRecord("expense", id); break;
      case "add-income": incomeForm(); break;
      case "edit-income": closeSearchForRecord(); incomeForm(byId(state.income, id)); break;
      case "delete-income": await deleteRecord("income", id); break;
      case "record-payment": paymentForm(byId(state.income, id)); break;
      case "delete-payment": await deletePayment(id); break;
      case "add-mileage": mileageForm(); break;
      case "edit-mileage": closeSearchForRecord(); mileageForm(byId(state.mileage_entries, id)); break;
      case "delete-mileage": await deleteRecord("mileage", id); break;
      case "delete-trip-template": await deleteTripTemplate(button); break;
      case "add-client": clientForm(); break;
      case "edit-client": closeSearchForRecord(); clientForm(byId(state.clients, id)); break;
      case "delete-client": await deleteRecord("client", id); break;
      case "add-project":
        if (!state.clients.some((client) => client.is_active)) {
          toast("Add an active client before creating a project.", "info");
          clientForm();
        } else {
          projectForm(null, button.dataset.clientId || "");
        }
        break;
      case "edit-project": projectForm(byId(state.projects, id)); break;
      case "delete-project": await deleteRecord("project", id); break;
      case "add-mileage-rate": mileageRateForm(); break;
      case "edit-mileage-rate": mileageRateForm(byId(state.mileage_rates, id)); break;
      case "delete-mileage-rate": await deleteMileageRate(id); break;
      case "add-category": categoryForm(); break;
      case "edit-category": categoryForm(byId(state.categories, id)); break;
      case "toggle-category": await toggleCategory(id); break;
      case "view-attachment": await viewAttachment(id); break;
      case "remove-attachment": await removeAttachment(id); break;
      case "close-dialog": $("#record-dialog").close(); break;
      case "close-search": $("#search-dialog").close(); break;
      case "report-preset": applyReportPreset(button.dataset.preset); break;
      case "open-report-preset": applyReportPreset(button.dataset.preset); location.hash = "#/reports"; break;
      case "reset-report": state.reportFilters = initialReportFilters(); renderRoute(); break;
      case "export-csv": exportCsv(); break;
      case "export-xlsx": exportXlsx(); break;
      case "export-pdf": exportPdf(); break;
      default:
        if (invoicePortal) await invoicePortal.handleAction(button);
        break;
    }
  }

  async function handleForm(form) {
    const handlers = {
      expense: saveExpense,
      income: saveIncome,
      mileage: saveMileage,
      client: saveClient,
      project: saveProject,
      payment: savePayment,
      category: saveCategory,
      "mileage-rate": saveMileageRate,
      settings: saveSettings,
      password: savePassword,
    };
    const handler = handlers[form.dataset.form] || invoicePortal?.formHandler(form.dataset.form);
    if (!handler) return;
    showFormError(form);
    setBusy(form, true, form.dataset.form === "invoice" ? "Saving invoice..." : "Saving...");
    try {
      await handler(form);
    } catch (error) {
      console.error(error);
      const message = friendlyError(error, "The record could not be saved.");
      showFormError(form, message);
      toast(message, "error");
      setBusy(form, false);
    }
  }

  async function handleLogin(form) {
    const data = new FormData(form);
    const message = $("#auth-message");
    message.textContent = "";
    setBusy(form, true, "Signing in...");
    try {
      const session = await apiRequest("/login", {
        method: "POST",
        body: {
          userId: String(data.get("userId")),
          password: String(data.get("password")),
          rememberMe: form.elements.remember_me.checked,
        },
      });
      await establishSession(session);
    } catch (error) {
      message.textContent = friendlyError(error, "Sign-in failed.");
      setBusy(form, false);
    }
  }

  async function savePassword(form) {
    if (state.demo) {
      toast("Password changes are disabled in the local preview.", "info");
      return;
    }
    const data = new FormData(form);
    const newPassword = String(data.get("new_password"));
    const confirmPassword = String(data.get("confirm_password"));
    if (newPassword !== confirmPassword) throw new Error("The new passwords do not match.");
    await apiRequest("/password", {
      method: "POST",
      body: {
        currentPassword: String(data.get("current_password")),
        newPassword,
        confirmPassword,
      },
    });
    form.reset();
    toast("Admin password updated. Other sessions were signed out.");
  }
  function togglePasswordVisibility(button) {
    const input = $("input", button.closest(".password-input-wrap"));
    if (!input) return;
    const showPassword = input.type === "password";
    input.type = showPassword ? "text" : "password";
    const actionLabel = showPassword ? "Hide password" : "Show password";
    button.setAttribute("aria-label", actionLabel);
    button.setAttribute("aria-pressed", String(showPassword));
    button.title = actionLabel;
    input.focus({ preventScroll: true });
  }

  function preventDialogBackdropDismissal() {
    document.querySelectorAll("dialog").forEach((dialog) => dialog.setAttribute("closedby", "closerequest"));
    document.addEventListener("click", (event) => {
      if (!(event.target instanceof HTMLDialogElement) || !event.target.open) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }

  function bindGlobalEvents() {
    window.addEventListener("hashchange", () => {
      if (state.user) renderRoute();
    });
    document.addEventListener("click", async (event) => {
      const passwordToggle = event.target.closest("[data-password-toggle]");
      if (passwordToggle) {
        event.preventDefault();
        togglePasswordVisibility(passwordToggle);
        return;
      }
      const actionButton = event.target.closest("[data-action]");
      if (actionButton) {
        event.preventDefault();
        try {
          await handleAction(actionButton);
        } catch (error) {
          console.error(error);
          const message = friendlyError(error);
          showFormError(actionButton.closest("form"), message);
          toast(message, "error");
        }
      }
    });
    document.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (event.target.id === "login-form") {
        await handleLogin(event.target);
      } else {
        await handleForm(event.target);
      }
    });
    document.addEventListener("input", (event) => {
      if (event.target.matches("[data-table-search]")) filterVisibleRows(event.target);
      if (event.target.matches("[data-global-search]")) {
        $("[data-global-search-results]").innerHTML = globalSearchResults(event.target.value);
      }
      invoicePortal?.handleInput(event);
      const form = event.target.closest("[data-form]");
      if (form && form.dataset.saveDuplicate) {
        delete form.dataset.saveDuplicate;
        const warning = $("[data-duplicate-warning]", form);
        if (warning) warning.hidden = true;
        const submit = $('button[type="submit"]', form);
        if (submit?.dataset.defaultLabel) submit.textContent = submit.dataset.defaultLabel;
      }
      if (form?.dataset.form === "mileage" && !form.dataset.id) {
        if (event.target.name === "mileage_date") syncNewMileageForm(form, true);
        else updateMileagePreview(form);
      }
      if (event.target.form?.id === "report-filter-form") {
        state.reportFilters[event.target.name] = event.target.value;
        state.reportFilters.preset = "custom";
        $("#report-results").innerHTML = renderReportResults();
      }
    });
    document.addEventListener("change", (event) => {
      invoicePortal?.handleChange(event);
      const mileageBatchForm = event.target.closest("form[data-form='mileage']");
      if (mileageBatchForm && !mileageBatchForm.dataset.id) {
        if (event.target.name === "trip_template_id") {
          applyTripTemplate(mileageBatchForm, event.target.value);
        }
        if (event.target.name === "project_id" && event.target.value) {
          const project = byId(state.projects, event.target.value);
          if (project) mileageBatchForm.elements.client_id.value = project.client_id;
        }
        syncNewMileageForm(mileageBatchForm, event.target.name === "mileage_date");
      }
      if (event.target.form?.id === "report-filter-form") {
        state.reportFilters[event.target.name] = event.target.value;
        state.reportFilters.preset = "custom";
        $("#report-results").innerHTML = renderReportResults();
      }
    });
    $("#menu-button").addEventListener("click", () => {
      const open = $("#sidebar").classList.toggle("is-open");
      $("#menu-button").setAttribute("aria-expanded", String(open));
    });
    $("#global-search-button").addEventListener("click", openGlobalSearch);
    $("#sign-out").addEventListener("click", async () => {
      if (state.demo) {
        toast("The local preview does not have an active sign-in.", "info");
        return;
      }
      try {
        await apiRequest("/logout", { method: "POST" });
      } finally {
        state.user = null;
        state.session = null;
        state.csrfToken = null;
        showOnly("auth-view");
        $("#auth-message").textContent = "You have been signed out.";
      }
    });
    preventDialogBackdropDismissal();
  }

  init().catch((error) => {
    console.error(error);
    showOnly("setup-view");
  });
})();
