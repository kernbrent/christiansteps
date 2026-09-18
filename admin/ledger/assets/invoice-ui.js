"use strict";

(() => {
  const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const ARTIFACT_LABELS = {
    contract: "Contract",
    mou: "MOU",
    logo: "Logo",
    invoice: "Invoice",
    signature: "Signature",
    other: "Other",
  };

  window.createChristianStepsInvoicePortal = (context) => {
    const {
      state, $, $$, apiRequest, loadData, renderRoute, dialogFrame, toast, escapeHtml, money,
      shortDate, statusBadge, clientName, projectName, optionList, clean, num, uid, today, taxYear,
      amountPaid,
    } = context;

    const itemRows = (invoiceId) => state.invoice_items
      .filter((item) => item.invoice_id === invoiceId)
      .sort((a, b) => num(a.sort_order) - num(b.sort_order));
    const clientArtifacts = (clientId, types = null) => state.client_artifacts.filter((artifact) =>
      artifact.client_id === clientId && (!types || types.includes(artifact.artifact_type))
    );
    const invoiceArtifacts = (invoiceId) => state.client_artifacts.filter((artifact) =>
      artifact.linked_invoice_id === invoiceId && artifact.artifact_type === "invoice"
    );
    const profilesForClient = (clientId) => state.invoice_profiles.filter((profile) => profile.client_id === clientId);
    const invoiceForIncome = (incomeId) => state.invoices.find((invoice) => invoice.income_id === incomeId);

    function computedStatus(invoice) {
      if (invoice.status === "void") return "void";
      const paid = amountPaid(invoice.income_id);
      if (paid >= num(invoice.total_amount)) return "paid";
      if (paid > 0) return "partial";
      if (invoice.due_date && invoice.due_date < today()) return "overdue";
      return "pending";
    }

    function nextInvoiceNumber() {
      const year = new Date().getFullYear();
      const used = state.invoices.map((invoice) => invoice.invoice_number);
      let sequence = state.invoices.filter((invoice) => String(invoice.created_date).startsWith(String(year))).length + 1;
      let candidate = "";
      do {
        candidate = `CS-${year}-${String(sequence).padStart(3, "0")}`;
        sequence += 1;
      } while (used.includes(candidate));
      return candidate;
    }

    function addDays(value, days) {
      const date = new Date(`${value}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    }

    function profileItems(profile) {
      try {
        const items = JSON.parse(profile?.items_json || "[]");
        return Array.isArray(items) ? items : [];
      } catch {
        return [];
      }
    }

    function seedDemoData() {
      if (state.invoices.length || !state.clients.length) return;
      const client = state.clients[0];
      const project = state.projects.find((item) => item.client_id === client.id) || null;
      const stamp = new Date().toISOString();
      const income = state.income.find((item) => item.client_id === client.id) || state.income[0];
      if (!income) return;
      const invoice = {
        id: uid(), owner_id: state.user.id, client_id: client.id, project_id: project?.id || null,
        program: income.program || "HopeSojourns",
        profile_id: null, income_id: income.id, invoice_number: income.invoice_number || nextInvoiceNumber(),
        created_date: income.invoice_date || income.income_date, period_start: income.invoice_date || income.income_date,
        period_end: income.invoice_date || income.income_date, due_date: income.due_date, contract_name: income.description || "Consulting Services",
        purchase_order: null, summary: `Consulting services provided to ${client.name}.`, payment_terms: "Net 30",
        payment_instructions: "Please remit payment using the method specified in the engagement agreement.",
        include_client_logo: 0, client_logo_artifact_id: null, summary_source_artifact_id: null,
        total_amount: income.amount, status: income.payment_status === "unpaid" ? "pending" : income.payment_status,
        local_folder_name: null, notes: null, created_at: stamp, updated_at: stamp,
      };
      state.invoices.push(invoice);
      state.invoice_items.push({
        id: uid(), owner_id: state.user.id, invoice_id: invoice.id, sort_order: 0, billing_type: "fixed",
        cadence: "one_time", work_type: "Consulting Services", description: income.description || "Professional services",
        quantity: 1, unit_rate: income.amount, line_total: income.amount, created_at: stamp, updated_at: stamp,
      });
    }

    function renderInvoices() {
      const rows = state.invoices.map((invoice) => {
        const status = computedStatus(invoice);
        const documents = invoiceArtifacts(invoice.id).length;
        const paid = amountPaid(invoice.income_id);
        const haystack = [invoice.invoice_number, clientName(invoice.client_id), invoice.contract_name, invoice.program, invoice.period_start, invoice.period_end, status].join(" ").toLowerCase();
        return `<tr data-search-row="${escapeHtml(haystack)}">
          <td><strong>${escapeHtml(invoice.invoice_number)}</strong><small>${invoice.program === "ChristianSteps" ? "Christian Steps" : "Hope Sojourns"} · Created ${shortDate(invoice.created_date)}</small></td>
          <td><strong>${escapeHtml(clientName(invoice.client_id))}</strong><small>${escapeHtml(projectName(invoice.project_id))}</small></td>
          <td><strong>${escapeHtml(invoice.contract_name)}</strong><small>${shortDate(invoice.period_start)} - ${shortDate(invoice.period_end)}</small></td>
          <td>${statusBadge(status)}<small>${invoice.due_date ? `Due ${shortDate(invoice.due_date)}` : escapeHtml(invoice.payment_terms || "")}</small></td>
          <td><span class="receipt-badge ${documents ? "receipt-present" : "receipt-missing"}">${documents ? `${documents} Word file${documents === 1 ? "" : "s"}` : "Not generated"}</span></td>
          <td class="number"><strong>${money(invoice.total_amount)}</strong><small>${money(paid)} received</small></td>
          <td class="row-actions invoice-actions">
            <button type="button" data-action="generate-invoice" data-id="${invoice.id}">Word</button>
            ${status !== "paid" && status !== "void" ? `<button type="button" data-action="mark-invoice-paid" data-id="${invoice.id}">Paid</button>` : ""}
            <button type="button" data-action="edit-invoice" data-id="${invoice.id}">Edit</button>
            ${paid <= 0 && (status === "pending" || status === "overdue") ? `<button type="button" data-action="delete-invoice" data-id="${invoice.id}">Delete</button>` : ""}
          </td>
        </tr>`;
      }).join("");
      const profileCards = state.invoice_profiles.length
        ? `<div class="invoice-profile-strip">${state.invoice_profiles.map((profile) => `<article><span>Saved starting point</span><strong>${escapeHtml(profile.name)}</strong><small>${escapeHtml(clientName(profile.client_id))} &middot; ${escapeHtml(profile.contract_name)}</small><div><button type="button" data-action="use-invoice-profile" data-id="${profile.id}">Use</button><button type="button" data-action="delete-invoice-profile" data-id="${profile.id}">Remove</button></div></article>`).join("")}</div>`
        : "";
      return `<section class="view invoice-view">
        <div class="section-heading-row split-heading"><div><p class="section-kicker">Client billing</p><h2>Invoices</h2><p>Create a Word invoice, save it to the client folder, and keep Income in sync automatically.</p></div><div class="standalone-metric"><span>Pending total</span><strong>${money(state.invoices.filter((invoice) => ["pending", "overdue", "partial"].includes(computedStatus(invoice))).reduce((sum, invoice) => sum + Math.max(0, num(invoice.total_amount) - amountPaid(invoice.income_id)), 0))}</strong><small>Across open invoices</small></div></div>
        <div class="invoice-folder-note"><strong>Local client folders</strong><span>Choose a folder once per client. The browser remembers the folder on this device; if folder access is unavailable, Word files download normally.</span></div>
        ${context.pageToolbar("invoices", "Search invoice, client, contract, period, or status", "add-invoice", "Create invoice", '<a class="secondary-button" href="#/artifacts">Files &amp; logos</a>')}
        ${profileCards}
        <div class="panel table-panel">${state.invoices.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Invoice</th><th>Client</th><th>Contract / period</th><th>Status</th><th>Word document</th><th class="number">Amount</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows}</tbody></table></div><p class="no-search-results" hidden>No invoices match this search.</p>` : context.emptyState("No invoices yet", "Create an invoice and the pending amount will also appear on the Income tab.", "add-invoice", "Create invoice")}</div>
      </section>`;
    }

    function renderArtifacts() {
      const rows = state.client_artifacts.map((artifact) => {
        const invoice = artifact.linked_invoice_id ? state.invoices.find((item) => item.id === artifact.linked_invoice_id) : null;
        const haystack = [artifact.display_name, artifact.file_name, artifact.artifact_type, clientName(artifact.client_id), projectName(artifact.project_id), invoice?.invoice_number, artifact.notes].join(" ").toLowerCase();
        return `<tr data-search-row="${escapeHtml(haystack)}">
          <td><span class="type-chip type-artifact">${escapeHtml(ARTIFACT_LABELS[artifact.artifact_type] || artifact.artifact_type)}</span></td>
          <td><strong>${escapeHtml(artifact.display_name)}</strong><small>${escapeHtml(artifact.file_name || artifact.source_url || "")}</small></td>
          <td>${artifact.client_id ? escapeHtml(clientName(artifact.client_id)) : "Christian Steps (business)"}<small>${escapeHtml(projectName(artifact.project_id))}</small></td>
          <td>${invoice ? `<strong>${escapeHtml(invoice.invoice_number)}</strong>` : "-"}</td>
          <td>${shortDate(String(artifact.created_at || "").slice(0, 10))}</td>
          <td class="row-actions"><button type="button" data-action="view-client-artifact" data-id="${artifact.id}">Open</button><button type="button" data-action="delete-client-artifact" data-id="${artifact.id}">Remove</button></td>
        </tr>`;
      }).join("");
      return `<section class="view artifact-view">
        <div class="section-heading-row"><div><p class="section-kicker">Client file library</p><h2>Contracts, MOUs, logos &amp; invoices</h2><p>Keep every billing-related file connected to the correct client and project.</p></div></div>
        ${context.pageToolbar("client files", "Search file, client, project, invoice, or notes", "add-client-artifact", "Add file", '<button class="secondary-button" type="button" data-action="add-client-artifact" data-artifact-type="logo">+ Add logo</button><button class="secondary-button" type="button" data-action="add-client-artifact" data-artifact-type="signature">+ Business signature</button>')}
        <div class="panel table-panel">${state.client_artifacts.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Type</th><th>File</th><th>Client / project</th><th>Invoice</th><th>Added</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows}</tbody></table></div><p class="no-search-results" hidden>No files match this search.</p>` : context.emptyState("No client files yet", "Upload a contract, MOU, logo, or other billing document.", "add-client-artifact", "Add file")}</div>
      </section>`;
    }

    const cadenceOptions = (selected) => [
      ["one_time", "One-time fixed"], ["weekly", "Weekly fixed"], ["monthly", "Monthly fixed"],
    ].map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");

    function lineEditorRow(item = {}, index = 0) {
      const billingType = item.billing_type || "fixed";
      return `<div class="invoice-line-row" data-invoice-line>
        <label class="field">Billing type<select name="line_billing_type"><option value="fixed" ${billingType === "fixed" ? "selected" : ""}>Fixed rate</option><option value="hourly" ${billingType === "hourly" ? "selected" : ""}>Hourly</option></select></label>
        <label class="field" data-cadence-field ${billingType === "hourly" ? "hidden" : ""}>Fixed period<select name="line_cadence">${cadenceOptions(item.cadence || "weekly")}</select></label>
        <label class="field field-grow">Type of work<input name="line_work_type" maxlength="240" required value="${escapeHtml(item.work_type || "")}" placeholder="Weekly Consulting Services"></label>
        <label class="field">${billingType === "hourly" ? "Hours" : "Units"}<input name="line_quantity" type="number" min="0.01" step="0.01" required value="${escapeHtml(item.quantity ?? 1)}"></label>
        <label class="field">${billingType === "hourly" ? "Hourly rate" : "Rate"}<input name="line_unit_rate" type="number" min="0" step="0.01" required value="${escapeHtml(item.unit_rate ?? "")}"></label>
        <label class="field field-wide">Description<textarea name="line_description" rows="2" placeholder="Services included in this line">${escapeHtml(item.description || "")}</textarea></label>
        <div class="invoice-line-total"><span>Line total</span><strong data-line-total>${money(num(item.line_total ?? num(item.quantity || 1) * num(item.unit_rate)))}</strong></div>
        <button class="invoice-line-remove" type="button" data-action="remove-invoice-line" aria-label="Remove billing line" ${index === 0 ? "" : ""}>Remove</button>
      </div>`;
    }

    function artifactSelectOptions(clientId, selected, types, emptyLabel) {
      return optionList(clientArtifacts(clientId, types), selected, emptyLabel, (artifact) => artifact.display_name);
    }

    function invoiceForm(item = null, selectedProfile = null) {
      const firstClient = state.clients.find((client) => client.is_active);
      const profile = selectedProfile || (item?.profile_id ? state.invoice_profiles.find((entry) => entry.id === item.profile_id) : null);
      const createdDate = item?.created_date || today();
      const record = item || {
        client_id: profile?.client_id || firstClient?.id || "",
        project_id: profile?.project_id || "",
        program: profile?.program || "HopeSojourns",
        profile_id: profile?.id || "",
        invoice_number: nextInvoiceNumber(),
        created_date: createdDate,
        period_start: createdDate,
        period_end: createdDate,
        due_date: createdDate,
        contract_name: profile?.contract_name || "",
        purchase_order: profile?.purchase_order || "",
        summary: profile?.summary_template || "",
        payment_terms: profile?.payment_terms || "Due on Receipt",
        payment_instructions: profile?.payment_instructions || "",
        include_client_logo: profile?.include_client_logo || 0,
        client_logo_artifact_id: profile?.client_logo_artifact_id || "",
        summary_source_artifact_id: profile?.summary_source_artifact_id || "",
        local_folder_name: profile?.local_folder_name || "",
        notes: profile?.notes || "",
      };
      const lines = item ? itemRows(item.id) : (profile ? profileItems(profile) : [{ billing_type: "fixed", cadence: "weekly", work_type: "Consulting Services", description: "", quantity: 1, unit_rate: "", line_total: 0 }]);
      const clientId = record.client_id || "";
      dialogFrame(
        item ? `Edit ${record.invoice_number}` : "Create client invoice",
        "Enter the variable details, review the calculated total, then generate the Word document.",
        `<form class="record-form invoice-form" data-form="invoice" data-id="${item?.id || ""}" novalidate>
          <div class="form-section invoice-starting-point"><h3>Start from saved details</h3><div class="form-grid">
            <label class="field field-grow">Saved starting point<select name="profile_id"><option value="">Blank invoice</option>${state.invoice_profiles.map((entry) => `<option value="${entry.id}" ${entry.id === record.profile_id ? "selected" : ""}>${escapeHtml(clientName(entry.client_id))} - ${escapeHtml(entry.name)}</option>`).join("")}</select></label>
            <p class="field-help">Choose a saved form to fill the client, contract, billing lines, logo, and payment details.</p>
          </div></div>
          <div class="form-section"><h3>Invoice & client</h3><div class="form-grid">
            <label class="field">Client<select name="client_id" required>${optionList(state.clients.filter((client) => client.is_active || client.id === clientId), clientId, "Choose client")}</select></label>
            <label class="field">Project<select name="project_id">${optionList(state.projects.filter((project) => project.client_id === clientId && project.is_active), record.project_id, "No project")}</select></label>
            <label class="field">Ministry<select name="program" required><option value="HopeSojourns" ${record.program === "HopeSojourns" ? "selected" : ""}>Hope Sojourns</option><option value="ChristianSteps" ${record.program === "ChristianSteps" ? "selected" : ""}>Christian Steps</option></select></label>
            <label class="field">Invoice number<input name="invoice_number" required maxlength="100" value="${escapeHtml(record.invoice_number)}"></label>
            <label class="field field-grow">Contract name<input name="contract_name" required maxlength="240" value="${escapeHtml(record.contract_name)}"></label>
            <label class="field">Invoice created<input name="created_date" type="date" required value="${escapeHtml(record.created_date)}"><small>This is also your signature date.</small></label>
            <label class="field">Period start<input name="period_start" type="date" required value="${escapeHtml(record.period_start)}"></label>
            <label class="field">Period finish<input name="period_end" type="date" required value="${escapeHtml(record.period_end)}"></label>
            <label class="field">Due date<input name="due_date" type="date" value="${escapeHtml(record.due_date || "")}"></label>
            <label class="field">Payment terms<input name="payment_terms" value="${escapeHtml(record.payment_terms || "")}" placeholder="Net 30"></label>
            <label class="field">PO / reference<input name="purchase_order" value="${escapeHtml(record.purchase_order || "")}" placeholder="Optional"></label>
          </div></div>
          <div class="form-section"><div class="form-section-heading"><h3>Billing lines</h3><button class="secondary-button" type="button" data-action="add-invoice-line">+ Add fixed or hourly line</button></div><div class="invoice-lines" data-invoice-lines>${lines.map(lineEditorRow).join("")}</div><div class="invoice-total-preview"><span>Calculated invoice total</span><strong data-invoice-total>${money(lines.reduce((sum, line) => sum + num(line.line_total ?? num(line.quantity) * num(line.unit_rate)), 0))}</strong><small>Recalculated again before saving.</small></div></div>
          <div class="form-section"><h3>Summary & source material</h3><div class="form-grid">
            <label class="field field-wide">Summary<textarea name="summary" rows="5" placeholder="Describe the services and billing period.">${escapeHtml(record.summary || "")}</textarea></label>
            <label class="field field-grow">Contract or MOU used for this summary<select name="summary_source_artifact_id">${artifactSelectOptions(clientId, record.summary_source_artifact_id, ["contract", "mou"], "No linked source document")}</select><small>Selecting a source keeps the document tied to this invoice for future summarization and review.</small></label>
            <button class="secondary-button field-action" type="button" data-action="add-summary-source">Upload contract / MOU</button>
            <label class="field field-wide">Payment instructions<textarea name="payment_instructions" rows="2" placeholder="Optional payment or remittance instructions">${escapeHtml(record.payment_instructions || "")}</textarea></label>
          </div></div>
          <div class="form-section"><h3>Client logo & local folder</h3>
            <div class="check-grid"><label><input name="include_client_logo" type="checkbox" ${record.include_client_logo ? "checked" : ""}> Include client logo in the Word invoice</label></div>
            <div class="form-grid" data-client-logo-fields ${record.include_client_logo ? "" : "hidden"}>
              <label class="field">Saved client logo<select name="client_logo_artifact_id">${artifactSelectOptions(clientId, record.client_logo_artifact_id, ["logo"], "Choose saved logo")}</select></label>
              <label class="field field-grow file-field">Upload a new logo<input name="client_logo_file" type="file" accept="image/png,image/jpeg"><small>PNG or JPG, up to 15 MB.</small></label>
              <label class="field field-wide">Or logo URL<input name="client_logo_url" type="url" placeholder="https://..."><small>Leave both blank to reuse the saved logo selected above.</small></label>
            </div>
            <div class="form-grid folder-reference-grid"><label class="field field-wide">Client folder reference<input name="local_folder_name" maxlength="240" value="${escapeHtml(record.local_folder_name || "")}" placeholder="Metro Relief / Billing"><small>You can type a folder name or path as a reference even when direct folder access is unavailable.</small></label></div>
            <div class="client-folder-row"><div><strong data-folder-name>Client folder: checking this device...</strong><small data-folder-help>The folder permission remains local to this browser.</small></div><button class="secondary-button" type="button" data-action="choose-invoice-folder">Choose client folder</button></div>
          </div>
          ${item ? "" : `<div class="form-section"><h3>Payment status</h3>
            <div class="check-grid"><label><input name="mark_paid_on_create" type="checkbox"> This invoice has already been paid</label></div>
            <div class="form-grid" data-initial-payment-fields hidden>
              <label class="field">Payment date<input name="initial_payment_date" type="date" value="${escapeHtml(createdDate)}"></label>
              <label class="field">Payment method<select name="initial_payment_method">${context.methodOptions("")}</select></label>
              <label class="field field-grow">Payment reference<input name="initial_payment_reference" maxlength="180" placeholder="Check, transfer, or confirmation number"></label>
            </div>
          </div>`}
          <div class="form-section"><h3>Save for next time</h3><div class="check-grid"><label><input name="save_as_profile" type="checkbox"> Save these details as a reusable starting point</label></div><div class="form-grid" data-profile-name hidden><label class="field field-grow">Starting-point name<input name="save_profile_name" maxlength="160" placeholder="Metro Relief weekly consulting"></label></div><label class="field field-wide">Internal notes<textarea name="notes" rows="2">${escapeHtml(record.notes || "")}</textarea></label></div>
          <div class="duplicate-warning" data-invoice-message hidden></div>
          <p class="form-message invoice-submit-message" data-form-error role="alert" hidden></p>
          <div class="form-footer"><button class="secondary-button" type="button" data-action="close-dialog">Cancel</button><button class="secondary-button" type="button" data-action="preview-invoice">Preview invoice</button><button class="button" type="submit">${item ? "Save invoice changes" : "Create invoice"}</button></div>
        </form>`,
        "dialog-wide invoice-dialog"
      );
      const form = $("form[data-form='invoice']");
      refreshInvoiceForm(form);
      showStoredFolderName(form).catch(() => {});
    }

    function artifactForm(type = "contract", clientId = "") {
      const selectedClient = type === "signature" ? "" : (clientId || state.clients.find((client) => client.is_active)?.id || "");
      dialogFrame("Add client file", "Upload a private file or save a public HTTPS link.", `<form class="record-form" data-form="client-artifact"><div class="form-section"><div class="form-grid">
        <label class="field">Type<select name="artifact_type"><option value="contract" ${type === "contract" ? "selected" : ""}>Contract</option><option value="mou" ${type === "mou" ? "selected" : ""}>MOU</option><option value="logo" ${type === "logo" ? "selected" : ""}>Client logo</option><option value="signature" ${type === "signature" ? "selected" : ""}>Business signature</option><option value="other" ${type === "other" ? "selected" : ""}>Other</option></select></label>
        <label class="field">Client<select name="client_id" ${type === "signature" ? "disabled" : "required"}>${optionList(state.clients.filter((client) => client.is_active), selectedClient, type === "signature" ? "Christian Steps (business-wide)" : "Choose client")}</select></label>
        <label class="field">Project<select name="project_id">${optionList(state.projects.filter((project) => project.client_id === selectedClient && project.is_active), "", "No project")}</select></label>
        <label class="field field-grow">Display name<input name="display_name" required maxlength="240" placeholder="2026 Consulting SOW"></label>
        <label class="field field-wide file-field">Choose file<input name="artifact_file" type="file" accept="image/png,image/jpeg,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"><small>Up to 15 MB.</small></label>
        <label class="field field-wide">Or public HTTPS URL<input name="source_url" type="url" placeholder="https://..."></label>
        <label class="field field-wide">Notes<textarea name="notes" rows="3"></textarea></label>
      </div></div><div class="form-footer"><button class="secondary-button" type="button" data-action="close-dialog">Cancel</button><button class="button" type="submit">Save client file</button></div></form>`, "dialog-wide");
    }

    function paymentForm(invoice) {
      const outstanding = Math.max(0, num(invoice.total_amount) - amountPaid(invoice.income_id));
      dialogFrame(`Mark ${invoice.invoice_number} paid`, `This records the remaining ${money(outstanding)} as Income received.`, `<form class="record-form" data-form="invoice-payment" data-id="${invoice.id}"><div class="form-section"><div class="form-grid">
        <label class="field">Payment date<input name="payment_date" type="date" required value="${today()}"></label>
        <label class="field">Payment method<select name="payment_method">${context.methodOptions("")}</select></label>
        <label class="field">Reference<input name="reference_number" placeholder="Check or transfer reference"></label>
        <label class="field field-wide">Notes<textarea name="notes" rows="2"></textarea></label>
      </div><div class="payment-confirmation"><span>Amount to record</span><strong>${money(outstanding)}</strong></div></div><div class="form-footer"><button class="secondary-button" type="button" data-action="close-dialog">Cancel</button><button class="button" type="submit">Mark paid &amp; update Income</button></div></form>`);
    }

    function collectLines(form) {
      return $$('[data-invoice-line]', form).map((row) => {
        const billingType = row.querySelector('[name="line_billing_type"]').value;
        return {
          billing_type: billingType,
          cadence: billingType === "fixed" ? row.querySelector('[name="line_cadence"]').value : null,
          work_type: row.querySelector('[name="line_work_type"]').value.trim(),
          description: clean(row.querySelector('[name="line_description"]').value),
          quantity: num(row.querySelector('[name="line_quantity"]').value),
          unit_rate: num(row.querySelector('[name="line_unit_rate"]').value),
        };
      });
    }

    function refreshLine(row) {
      const type = row.querySelector('[name="line_billing_type"]').value;
      row.querySelector('[data-cadence-field]').hidden = type === "hourly";
      const quantityLabel = row.querySelector('[name="line_quantity"]').closest("label");
      const rateLabel = row.querySelector('[name="line_unit_rate"]').closest("label");
      quantityLabel.childNodes[0].nodeValue = type === "hourly" ? "Hours" : "Units";
      rateLabel.childNodes[0].nodeValue = type === "hourly" ? "Hourly rate" : "Rate";
      row.querySelector('[data-line-total]').textContent = money(num(row.querySelector('[name="line_quantity"]').value) * num(row.querySelector('[name="line_unit_rate"]').value));
    }

    function refreshInvoiceForm(form) {
      if (!form) return;
      $$('[data-invoice-line]', form).forEach(refreshLine);
      const total = collectLines(form).reduce((sum, line) => sum + line.quantity * line.unit_rate, 0);
      $('[data-invoice-total]', form).textContent = money(total);
      $('[data-client-logo-fields]', form).hidden = !form.elements.include_client_logo.checked;
      $('[data-profile-name]', form).hidden = !form.elements.save_as_profile.checked;
      form.elements.save_profile_name.required = form.elements.save_as_profile.checked;
      const paidCheckbox = form.elements.mark_paid_on_create;
      const paymentFields = $('[data-initial-payment-fields]', form);
      if (paidCheckbox && paymentFields) {
        paymentFields.hidden = !paidCheckbox.checked;
        form.elements.initial_payment_date.required = paidCheckbox.checked;
        if (paidCheckbox.checked && !form.elements.initial_payment_date.value) {
          form.elements.initial_payment_date.value = form.elements.created_date.value;
        }
      }
      $$('[data-action="remove-invoice-line"]', form).forEach((button) => { button.disabled = $$('[data-invoice-line]', form).length === 1; });
    }

    function updateClientChoices(form) {
      const clientId = form.elements.client_id.value;
      const projectValue = form.elements.project_id.value;
      form.elements.project_id.innerHTML = optionList(state.projects.filter((project) => project.client_id === clientId && project.is_active), projectValue, "No project");
      form.elements.client_logo_artifact_id.innerHTML = artifactSelectOptions(clientId, form.elements.client_logo_artifact_id.value, ["logo"], "Choose saved logo");
      form.elements.summary_source_artifact_id.innerHTML = artifactSelectOptions(clientId, form.elements.summary_source_artifact_id.value, ["contract", "mou"], "No linked source document");
      showStoredFolderName(form).catch(() => {});
    }

    function applyProfile(form, profileId) {
      const profile = state.invoice_profiles.find((entry) => entry.id === profileId);
      if (!profile) return;
      form.elements.client_id.value = profile.client_id;
      updateClientChoices(form);
      form.elements.project_id.value = profile.project_id || "";
      form.elements.program.value = profile.program || "HopeSojourns";
      form.elements.contract_name.value = profile.contract_name || "";
      form.elements.purchase_order.value = profile.purchase_order || "";
      form.elements.summary.value = profile.summary_template || "";
      form.elements.payment_terms.value = profile.payment_terms || "";
      form.elements.payment_instructions.value = profile.payment_instructions || "";
      form.elements.include_client_logo.checked = Boolean(profile.include_client_logo);
      form.elements.client_logo_artifact_id.value = profile.client_logo_artifact_id || "";
      form.elements.summary_source_artifact_id.value = profile.summary_source_artifact_id || "";
      form.elements.local_folder_name.value = profile.local_folder_name || "";
      form.elements.notes.value = profile.notes || "";
      $('[data-invoice-lines]', form).innerHTML = profileItems(profile).map(lineEditorRow).join("");
      refreshInvoiceForm(form);
    }

    function openFolderDatabase() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open("christiansteps-admin-local", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("client-folders");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    async function folderHandle(clientId) {
      if (!clientId || !window.indexedDB) return null;
      const db = await openFolderDatabase();
      return new Promise((resolve, reject) => {
        const request = db.transaction("client-folders", "readonly").objectStore("client-folders").get(clientId);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    }

    async function storeFolderHandle(clientId, handle) {
      const db = await openFolderDatabase();
      return new Promise((resolve, reject) => {
        const request = db.transaction("client-folders", "readwrite").objectStore("client-folders").put(handle, clientId);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }

    function folderPickerId(clientId) {
      return String(clientId).replace(/-/g, "").slice(0, 32);
    }

    async function chooseFolderForForm(form) {
      const clientId = form.elements.client_id.value;
      if (!clientId) throw new Error("Choose a client before selecting its folder.");
      const label = $('[data-folder-name]', form);
      const help = $('[data-folder-help]', form);
      if (!window.showDirectoryPicker) {
        label.textContent = "Direct folder saving is unavailable in this browser";
        help.textContent = "Enter a folder reference above. Generated Word invoices will download so you can move them there.";
        return null;
      }
      try {
        const handle = await window.showDirectoryPicker({ id: folderPickerId(clientId), mode: "readwrite" });
        await storeFolderHandle(clientId, handle);
        form.elements.local_folder_name.value = handle.name;
        label.textContent = `Client folder: ${handle.name}`;
        help.textContent = "Direct saving is enabled for this client on this device.";
        return handle;
      } catch (error) {
        if (error?.name === "AbortError") {
          label.textContent = "Client folder selection was canceled";
          help.textContent = "No changes were made. You can type a folder reference above or try again.";
          return null;
        }
        throw error;
      }
    }

    async function showStoredFolderName(form) {
      const label = $('[data-folder-name]', form);
      const help = $('[data-folder-help]', form);
      if (!label) return;
      if (!window.showDirectoryPicker) {
        label.textContent = "Direct folder saving is unavailable in this browser";
        if (help) help.textContent = "Enter a folder reference above. Generated Word invoices will download normally.";
        return;
      }
      const handle = await folderHandle(form.elements.client_id.value);
      label.textContent = handle ? `Client folder: ${handle.name}` : "Client folder: not chosen yet";
      if (help) help.textContent = handle ? "Direct saving is enabled for this client on this device." : "Choose a folder once, or enter a folder reference above.";
    }

    async function uploadArtifact({ type, clientId, projectId = "", invoiceId = "", displayName, notes = "", file = null, sourceUrl = "" }) {
      if (state.demo) {
        const artifact = { id: uid(), owner_id: state.user.id, client_id: clientId, project_id: projectId || null, linked_invoice_id: invoiceId || null, artifact_type: type, display_name: displayName, file_name: file?.name || null, mime_type: file?.type || (sourceUrl ? "image/external" : null), size_bytes: file?.size || null, source_url: sourceUrl || null, notes: notes || null, is_current: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), _blob: file || null };
        state.client_artifacts.unshift(artifact);
        return artifact;
      }
      const query = new URLSearchParams({ type, clientId, displayName });
      if (projectId) query.set("projectId", projectId);
      if (invoiceId) query.set("invoiceId", invoiceId);
      if (notes) query.set("notes", notes);
      if (file) {
        const result = await apiRequest(`/artifacts?${query}`, { method: "POST", body: file, headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) } });
        return result.artifact;
      }
      const result = await apiRequest(`/artifacts?${query}`, { method: "POST", body: { display_name: displayName, source_url: sourceUrl, notes: notes || null } });
      return result.artifact;
    }

    async function ensureLogo(form) {
      if (!form.elements.include_client_logo.checked) return null;
      const file = form.elements.client_logo_file.files[0];
      const sourceUrl = form.elements.client_logo_url.value.trim();
      if (file || sourceUrl) {
        const artifact = await uploadArtifact({ type: "logo", clientId: form.elements.client_id.value, projectId: form.elements.project_id.value, displayName: file?.name || `Logo for ${clientName(form.elements.client_id.value)}`, file, sourceUrl });
        return artifact.id;
      }
      const selected = form.elements.client_logo_artifact_id.value;
      if (!selected) throw new Error("Choose a saved client logo, upload one, or enter its HTTPS URL.");
      return selected;
    }

    let invoicePreviewObjectUrls = [];

    function releaseInvoicePreviewUrls() {
      invoicePreviewObjectUrls.forEach((url) => URL.revokeObjectURL(url));
      invoicePreviewObjectUrls = [];
    }

    function invoicePreviewBlobUrl(blob) {
      const url = URL.createObjectURL(blob);
      invoicePreviewObjectUrls.push(url);
      return url;
    }

    function invoicePreviewDraft(form) {
      if (!form.checkValidity()) {
        form.reportValidity();
        throw new Error("Complete the highlighted required fields before previewing the invoice.");
      }
      const items = collectLines(form).map((line) => ({
        ...line,
        line_total: line.quantity * line.unit_rate,
      }));
      if (form.elements.period_end.value < form.elements.period_start.value) {
        throw new Error("The invoice finish date must be on or after the start date.");
      }
      if (!items.length || items.some((line) => !line.work_type || line.quantity <= 0 || line.unit_rate < 0)) {
        throw new Error("Complete every billing line before previewing.");
      }
      const total = items.reduce((sum, line) => sum + line.line_total, 0);
      if (total <= 0) throw new Error("The invoice total must be greater than zero.");
      return {
        client_id: form.elements.client_id.value,
        program: form.elements.program.value,
        client_name: clientName(form.elements.client_id.value),
        project_name: projectName(form.elements.project_id.value),
        invoice_number: form.elements.invoice_number.value.trim(),
        created_date: form.elements.created_date.value,
        period_start: form.elements.period_start.value,
        period_end: form.elements.period_end.value,
        due_date: clean(form.elements.due_date.value),
        contract_name: form.elements.contract_name.value.trim(),
        purchase_order: clean(form.elements.purchase_order.value),
        summary: clean(form.elements.summary.value),
        payment_terms: clean(form.elements.payment_terms.value),
        payment_instructions: clean(form.elements.payment_instructions.value),
        include_client_logo: form.elements.include_client_logo.checked,
        currency_code: state.settings?.currency_code || "USD",
        total_amount: total,
        items,
      };
    }

    async function invoicePreviewClientLogo(form) {
      if (!form.elements.include_client_logo.checked) return { url: "", pending: false };
      const file = form.elements.client_logo_file.files[0];
      if (file) return { url: invoicePreviewBlobUrl(file), pending: false };
      const sourceUrl = form.elements.client_logo_url.value.trim();
      if (sourceUrl) {
        if (!/^https:\/\//i.test(sourceUrl)) throw new Error("The client logo URL must begin with https://.");
        return { url: "", pending: true };
      }
      const logoId = form.elements.client_logo_artifact_id.value;
      const artifact = state.client_artifacts.find((entry) => entry.id === logoId);
      if (!artifact) throw new Error("Choose a saved client logo, upload one, or enter its HTTPS URL before previewing.");
      if (state.demo && artifact.source_url) return { url: "", pending: true };
      return { url: invoicePreviewBlobUrl(await artifactBlob(artifact)), pending: false };
    }

    function ensureInvoicePreviewDialog() {
      let dialog = $("#invoice-preview-dialog");
      if (dialog) return dialog;
      dialog = document.createElement("dialog");
      dialog.id = "invoice-preview-dialog";
      dialog.className = "invoice-preview-dialog";
      dialog.setAttribute("closedby", "closerequest");
      dialog.setAttribute("aria-labelledby", "invoice-preview-title");
      dialog.innerHTML = `<div class="invoice-preview-toolbar"><div><strong id="invoice-preview-title">Invoice preview</strong><span>Nothing has been saved. Close this preview to continue editing.</span></div><button class="button" type="button" data-action="close-invoice-preview">Back to invoice</button></div><div class="invoice-preview-scroll" data-invoice-preview-body></div>`;
      dialog.addEventListener("close", releaseInvoicePreviewUrls);
      document.body.append(dialog);
      return dialog;
    }

    async function previewInvoice(form, button) {
      if (!window.ChristianStepsInvoicePreview?.render) throw new Error("The invoice preview could not be loaded. Refresh the portal and try again.");
      const invoice = invoicePreviewDraft(form);
      const originalLabel = button.textContent;
      button.disabled = true;
      button.textContent = "Preparing preview...";
      releaseInvoicePreviewUrls();
      try {
        const [signature, clientLogo] = await Promise.all([
          brandingBlob("signature"),
          invoicePreviewClientLogo(form),
        ]);
        const dialog = ensureInvoicePreviewDialog();
        $("[data-invoice-preview-body]", dialog).innerHTML = window.ChristianStepsInvoicePreview.render(invoice, {
          businessLogoUrl: "../logo.png",
          clientLogoUrl: clientLogo.url,
          clientLogoPending: clientLogo.pending,
          signatureUrl: invoicePreviewBlobUrl(signature),
        });
        if (!dialog.open) dialog.showModal();
      } catch (error) {
        releaseInvoicePreviewUrls();
        throw error;
      } finally {
        button.disabled = false;
        button.textContent = originalLabel;
      }
    }

    async function saveInvoice(form) {
      if (!form.checkValidity()) {
        form.reportValidity();
        throw new Error("Complete the highlighted required fields before creating the invoice.");
      }
      const id = form.dataset.id || null;
      const logoId = await ensureLogo(form);
      const handle = await folderHandle(form.elements.client_id.value).catch(() => null);
      const payload = {
        client_id: form.elements.client_id.value,
        project_id: clean(form.elements.project_id.value),
        program: form.elements.program.value,
        profile_id: clean(form.elements.profile_id.value),
        invoice_number: form.elements.invoice_number.value.trim(),
        created_date: form.elements.created_date.value,
        period_start: form.elements.period_start.value,
        period_end: form.elements.period_end.value,
        due_date: clean(form.elements.due_date.value),
        contract_name: form.elements.contract_name.value.trim(),
        purchase_order: clean(form.elements.purchase_order.value),
        summary: clean(form.elements.summary.value),
        payment_terms: clean(form.elements.payment_terms.value),
        payment_instructions: clean(form.elements.payment_instructions.value),
        include_client_logo: form.elements.include_client_logo.checked,
        client_logo_artifact_id: logoId,
        summary_source_artifact_id: clean(form.elements.summary_source_artifact_id.value),
        local_folder_name: handle?.name || clean(form.elements.local_folder_name.value),
        notes: clean(form.elements.notes.value),
        items: collectLines(form),
        save_profile_name: form.elements.save_as_profile.checked ? form.elements.save_profile_name.value.trim() : null,
        mark_paid_on_create: !id && Boolean(form.elements.mark_paid_on_create?.checked),
        initial_payment_date: !id && form.elements.mark_paid_on_create?.checked ? form.elements.initial_payment_date.value : null,
        initial_payment_method: !id && form.elements.mark_paid_on_create?.checked ? clean(form.elements.initial_payment_method.value) : null,
        initial_payment_reference: !id && form.elements.mark_paid_on_create?.checked ? clean(form.elements.initial_payment_reference.value) : null,
      };
      if (payload.period_end < payload.period_start) throw new Error("The invoice finish date must be on or after the start date.");
      if (!payload.items.length || payload.items.some((line) => !line.work_type || line.quantity <= 0 || line.unit_rate < 0)) throw new Error("Complete every billing line before saving.");
      const total = payload.items.reduce((sum, line) => sum + line.quantity * line.unit_rate, 0);
      if (total <= 0) throw new Error("The invoice total must be greater than zero.");
      if (state.demo) {
        const stamp = new Date().toISOString();
        let invoice = id ? state.invoices.find((entry) => entry.id === id) : null;
        if (!invoice) {
          const incomeId = uid();
          invoice = { id: uid(), owner_id: state.user.id, income_id: incomeId, status: "pending", created_at: stamp };
          state.invoices.push(invoice);
          state.income.push({ id: incomeId, owner_id: state.user.id, income_date: payload.created_date, client_id: payload.client_id, project_id: payload.project_id, payer_name: clientName(payload.client_id), invoice_number: payload.invoice_number, invoice_date: payload.created_date, due_date: payload.due_date, amount: total, program: payload.program, payment_status: "unpaid", description: payload.contract_name, payment_method: null, tax_year: Number(payload.created_date.slice(0, 4)), record_status: "included", cpa_review: false, cpa_notes: null, notes: payload.notes, created_at: stamp, updated_at: stamp });
        }
        Object.assign(invoice, payload, { total_amount: total, updated_at: stamp });
        state.invoice_items = state.invoice_items.filter((line) => line.invoice_id !== invoice.id);
        payload.items.forEach((line, index) => state.invoice_items.push({ id: uid(), owner_id: state.user.id, invoice_id: invoice.id, sort_order: index, ...line, line_total: line.quantity * line.unit_rate, created_at: stamp, updated_at: stamp }));
        const income = state.income.find((entry) => entry.id === invoice.income_id);
        Object.assign(income, { income_date: payload.created_date, client_id: payload.client_id, project_id: payload.project_id, payer_name: clientName(payload.client_id), invoice_number: payload.invoice_number, invoice_date: payload.created_date, due_date: payload.due_date, amount: total, program: payload.program, description: payload.contract_name, tax_year: Number(payload.created_date.slice(0, 4)), notes: payload.notes, updated_at: stamp });
        if (!id && payload.mark_paid_on_create) {
          state.income_payments.push({ id: uid(), owner_id: state.user.id, income_id: invoice.income_id, payment_date: payload.initial_payment_date, amount: total, payment_method: payload.initial_payment_method, reference_number: payload.initial_payment_reference, notes: null, created_at: stamp, updated_at: stamp });
          invoice.status = "paid";
          invoice.paid_at = `${payload.initial_payment_date}T12:00:00.000Z`;
          income.payment_status = "paid";
        }
        if (payload.save_profile_name) {
          const existingProfile = state.invoice_profiles.find((entry) => entry.client_id === payload.client_id && entry.name.toLowerCase() === payload.save_profile_name.toLowerCase());
          const profile = existingProfile || { id: uid(), owner_id: state.user.id, client_id: payload.client_id, created_at: stamp };
          Object.assign(profile, { project_id: payload.project_id, program: payload.program, name: payload.save_profile_name, contract_name: payload.contract_name, summary_template: payload.summary, payment_terms: payload.payment_terms, payment_instructions: payload.payment_instructions, purchase_order: payload.purchase_order, include_client_logo: payload.include_client_logo ? 1 : 0, client_logo_artifact_id: payload.client_logo_artifact_id, summary_source_artifact_id: payload.summary_source_artifact_id, items_json: JSON.stringify(payload.items), local_folder_name: payload.local_folder_name, notes: payload.notes, is_active: 1, updated_at: stamp });
          if (!existingProfile) state.invoice_profiles.push(profile);
        }
      } else {
        await apiRequest(id ? `/invoices/${encodeURIComponent(id)}` : "/invoices", { method: id ? "PATCH" : "POST", body: payload });
        await loadData();
      }
      $("#record-dialog").close();
      toast(id
        ? "Invoice and linked Income record updated."
        : payload.mark_paid_on_create
          ? "Paid invoice created and added to Income."
          : "Pending invoice created and added to Income.");
      location.hash = "#/invoices";
      renderRoute();
    }

    async function saveArtifact(form) {
      const file = form.elements.artifact_file.files[0] || null;
      const sourceUrl = form.elements.source_url.value.trim();
      if (Boolean(file) === Boolean(sourceUrl)) throw new Error("Choose one file or enter one HTTPS URL.");
      await uploadArtifact({ type: form.elements.artifact_type.value, clientId: form.elements.client_id.value, projectId: form.elements.project_id.value, displayName: form.elements.display_name.value.trim(), notes: form.elements.notes.value.trim(), file, sourceUrl });
      if (!state.demo) await loadData();
      $("#record-dialog").close();
      toast("Client file saved.");
      renderRoute();
    }

    async function saveInvoicePayment(form) {
      const invoice = state.invoices.find((entry) => entry.id === form.dataset.id);
      if (!invoice) throw new Error("That invoice no longer exists.");
      const payload = { payment_date: form.elements.payment_date.value, payment_method: clean(form.elements.payment_method.value), reference_number: clean(form.elements.reference_number.value), notes: clean(form.elements.notes.value) };
      if (state.demo) {
        const outstanding = Math.max(0, num(invoice.total_amount) - amountPaid(invoice.income_id));
        state.income_payments.push({ id: uid(), owner_id: state.user.id, income_id: invoice.income_id, amount: outstanding, ...payload, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
        invoice.status = "paid";
        invoice.paid_at = `${payload.payment_date}T12:00:00.000Z`;
        const income = state.income.find((entry) => entry.id === invoice.income_id);
        if (income) income.payment_status = "paid";
      } else {
        await apiRequest(`/invoices/${encodeURIComponent(invoice.id)}/paid`, { method: "POST", body: payload });
        await loadData();
      }
      $("#record-dialog").close();
      toast("Invoice marked paid and Income updated.");
      renderRoute();
    }

    async function fetchBlob(path) {
      const response = await fetch(`${context.API_BASE}${path}`, { credentials: "include", headers: { Accept: "*/*" } });
      if (!response.ok) {
        const payload = (response.headers.get("content-type") || "").includes("application/json")
          ? await response.json()
          : null;
        throw new Error(payload?.error || "A private invoice asset could not be loaded.");
      }
      return response.blob();
    }

    async function artifactBlob(artifact) {
      if (state.demo && artifact?._blob) return artifact._blob;
      return fetchBlob(`/artifacts/${encodeURIComponent(artifact.id)}`);
    }

    async function brandingBlob(name) {
      if (!state.demo && name === "signature") return fetchBlob("/invoice-assets/signature");
      const path = name === "business-logo" ? "../logo.png" : "../../Images/brent-kern-signature.png";
      const response = await fetch(path);
      if (!response.ok) throw new Error("The local branding preview could not be loaded.");
      return response.blob();
    }

    async function saveBlobLocally(blob, fileName, clientId, preferredHandle = null) {
      let handle = preferredHandle || await folderHandle(clientId).catch(() => null);
      if (handle) {
        try {
          let permission = await handle.queryPermission({ mode: "readwrite" });
          if (permission !== "granted") permission = await handle.requestPermission({ mode: "readwrite" });
          if (permission === "granted") {
            const fileHandle = await handle.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
            return { mode: "folder", name: handle.name };
          }
        } catch (error) {
          console.warn("The saved client folder was unavailable; downloading the invoice instead.", error);
        }
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      return { mode: "download", name: fileName };
    }

    async function generateInvoice(invoice) {
      const preferredHandle = await folderHandle(invoice.client_id).catch(() => null);
      toast("Building the Word invoice...", "info");
      const logoArtifact = invoice.include_client_logo ? state.client_artifacts.find((artifact) => artifact.id === invoice.client_logo_artifact_id) : null;
      const [businessLogo, signature, clientLogo] = await Promise.all([
        brandingBlob("business-logo"),
        brandingBlob("signature"),
        logoArtifact ? artifactBlob(logoArtifact) : Promise.resolve(null),
      ]);
      const fullInvoice = {
        ...invoice,
        client_name: clientName(invoice.client_id),
        project_name: projectName(invoice.project_id),
        currency_code: state.settings?.currency_code || "USD",
        items: itemRows(invoice.id),
      };
      const blob = window.ChristianStepsInvoiceDocx.buildInvoiceDocument(fullInvoice, {
        businessLogo: { bytes: await businessLogo.arrayBuffer(), mimeType: businessLogo.type },
        signature: { bytes: await signature.arrayBuffer(), mimeType: signature.type },
        clientLogo: clientLogo ? { bytes: await clientLogo.arrayBuffer(), mimeType: clientLogo.type } : null,
      });
      const fileName = window.ChristianStepsInvoiceDocx.fileNameForInvoice(fullInvoice);
      if (!state.demo) {
        await uploadArtifact({ type: "invoice", clientId: invoice.client_id, projectId: invoice.project_id || "", invoiceId: invoice.id, displayName: fileName, file: new File([blob], fileName, { type: DOCX_MIME }) });
        await loadData();
      }
      const saved = await saveBlobLocally(blob, fileName, invoice.client_id, preferredHandle);
      toast(saved.mode === "folder" ? `Word invoice saved to ${saved.name}.` : "Word invoice downloaded. Choose a client folder next time to save directly.");
      renderRoute();
    }

    async function viewArtifact(artifact) {
      if (state.demo && artifact._blob) {
        window.open(URL.createObjectURL(artifact._blob), "_blank", "noopener,noreferrer");
        return;
      }
      if (artifact.source_url && state.demo) {
        window.open(artifact.source_url, "_blank", "noopener,noreferrer");
        return;
      }
      const blob = await artifactBlob(artifact);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }

    async function handleAction(button) {
      const action = button.dataset.action;
      const id = button.dataset.id;
      if (action === "add-invoice") { invoiceForm(); return true; }
      if (action === "edit-invoice") { invoiceForm(state.invoices.find((entry) => entry.id === id)); return true; }
      if (action === "use-invoice-profile") { invoiceForm(null, state.invoice_profiles.find((entry) => entry.id === id)); return true; }
      if (action === "mark-invoice-paid") { paymentForm(state.invoices.find((entry) => entry.id === id)); return true; }
      if (action === "generate-invoice") { await generateInvoice(state.invoices.find((entry) => entry.id === id)); return true; }
      if (action === "delete-invoice") {
        const invoice = state.invoices.find((entry) => entry.id === id);
        if (!invoice) return true;
        const status = computedStatus(invoice);
        const paid = amountPaid(invoice.income_id);
        if (paid > 0 || (status !== "pending" && status !== "overdue")) {
          throw new Error("Only unpaid pending or overdue invoices can be deleted.");
        }
        const wordFiles = invoiceArtifacts(invoice.id).length;
        const fileMessage = wordFiles ? ` and ${wordFiles} generated Word file${wordFiles === 1 ? "" : "s"}` : "";
        if (!window.confirm(`Delete invoice ${invoice.invoice_number}? This will also delete its linked unpaid Income entry${fileMessage}. This cannot be undone.`)) return true;
        if (state.demo) {
          state.client_artifacts = state.client_artifacts.filter((entry) => entry.linked_invoice_id !== invoice.id);
          state.invoice_items = state.invoice_items.filter((entry) => entry.invoice_id !== invoice.id);
          state.income = state.income.filter((entry) => entry.id !== invoice.income_id);
          state.invoices = state.invoices.filter((entry) => entry.id !== invoice.id);
        } else {
          await apiRequest(`/invoices/${encodeURIComponent(invoice.id)}`, { method: "DELETE" });
          await loadData();
        }
        toast("Invoice and linked unpaid Income entry deleted.");
        renderRoute();
        return true;
      }
      if (action === "add-client-artifact") { artifactForm(button.dataset.artifactType || "contract"); return true; }
      if (action === "add-summary-source") { const form = button.closest("form"); artifactForm("contract", form.elements.client_id.value); return true; }
      if (action === "add-invoice-line") { const form = button.closest("form"); $('[data-invoice-lines]', form).insertAdjacentHTML("beforeend", lineEditorRow({}, $$('[data-invoice-line]', form).length)); refreshInvoiceForm(form); return true; }
      if (action === "remove-invoice-line") { const form = button.closest("form"); if ($$('[data-invoice-line]', form).length > 1) button.closest('[data-invoice-line]').remove(); refreshInvoiceForm(form); return true; }
      if (action === "choose-invoice-folder") { await chooseFolderForForm(button.closest("form")); return true; }
      if (action === "preview-invoice") { await previewInvoice(button.closest("form"), button); return true; }
      if (action === "close-invoice-preview") { $("#invoice-preview-dialog")?.close(); return true; }
      if (action === "view-client-artifact") { await viewArtifact(state.client_artifacts.find((entry) => entry.id === id)); return true; }
      if (action === "delete-client-artifact") {
        const artifact = state.client_artifacts.find((entry) => entry.id === id);
        if (!artifact || !window.confirm(`Remove ${artifact.display_name}?`)) return true;
        if (state.demo) state.client_artifacts = state.client_artifacts.filter((entry) => entry.id !== id);
        else { await apiRequest(`/artifacts/${encodeURIComponent(id)}`, { method: "DELETE" }); await loadData(); }
        toast("Client file removed."); renderRoute(); return true;
      }
      if (action === "delete-invoice-profile") {
        const profile = state.invoice_profiles.find((entry) => entry.id === id);
        if (!profile || !window.confirm(`Remove the saved starting point "${profile.name}"? Existing invoices will not change.`)) return true;
        if (state.demo) state.invoice_profiles = state.invoice_profiles.filter((entry) => entry.id !== id);
        else { await apiRequest(`/invoice-profiles/${encodeURIComponent(id)}`, { method: "DELETE" }); await loadData(); }
        toast("Saved starting point removed."); renderRoute(); return true;
      }
      return false;
    }

    function handleInput(event) {
      const form = event.target.closest("form[data-form='invoice']");
      if (form) refreshInvoiceForm(form);
    }

    function handleChange(event) {
      const invoice = event.target.closest("form[data-form='invoice']");
      if (invoice) {
        if (event.target.name === "client_id") updateClientChoices(invoice);
        if (event.target.name === "profile_id" && event.target.value) applyProfile(invoice, event.target.value);
        if (event.target.name === "created_date") {
          const netMatch = invoice.elements.payment_terms.value.trim().match(/^Net\s+(\d+)$/i);
          invoice.elements.due_date.value = netMatch
            ? addDays(event.target.value, Number(netMatch[1]))
            : event.target.value;
          if (invoice.elements.initial_payment_date) invoice.elements.initial_payment_date.value = event.target.value;
        }
        if (event.target.name === "payment_terms") {
          const netMatch = event.target.value.trim().match(/^Net\s+(\d+)$/i);
          if (/^Due on Receipt$/i.test(event.target.value.trim())) invoice.elements.due_date.value = invoice.elements.created_date.value;
          else if (netMatch) invoice.elements.due_date.value = addDays(invoice.elements.created_date.value, Number(netMatch[1]));
        }
        refreshInvoiceForm(invoice);
      }
      const artifact = event.target.closest("form[data-form='client-artifact']");
      if (artifact && event.target.name === "artifact_type") {
        const businessWide = event.target.value === "signature";
        artifact.elements.client_id.disabled = businessWide;
        artifact.elements.client_id.required = !businessWide;
        if (businessWide) {
          artifact.elements.client_id.value = "";
          artifact.elements.project_id.value = "";
        }
      }
      if (artifact && event.target.name === "client_id") {
        artifact.elements.project_id.innerHTML = optionList(state.projects.filter((project) => project.client_id === event.target.value && project.is_active), "", "No project");
      }
    }

    function formHandler(name) {
      return { invoice: saveInvoice, "client-artifact": saveArtifact, "invoice-payment": saveInvoicePayment }[name] || null;
    }

    return {
      seedDemoData,
      renderInvoices,
      renderArtifacts,
      handleAction,
      handleInput,
      handleChange,
      formHandler,
      invoiceForIncome,
    };
  };
})();
