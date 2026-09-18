"use strict";

(() => {
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function money(value, currency) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(Number(value || 0));
  }

  function quantity(value) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(value || 0));
  }

  function longDate(value) {
    if (globalThis.ChristianStepsInvoiceDocx?.longDate) return globalThis.ChristianStepsInvoiceDocx.longDate(value);
    if (!value) return "";
    return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })
      .format(new Date(`${value}T12:00:00Z`));
  }

  function dateRange(start, end) {
    if (globalThis.ChristianStepsInvoiceDocx?.compactDateRange) {
      return globalThis.ChristianStepsInvoiceDocx.compactDateRange(start, end);
    }
    return `${longDate(start)}-${longDate(end)}`;
  }

  function rateLabel(item, currency) {
    if (item.billing_type === "hourly") return `${money(item.unit_rate, currency)}/hour`;
    if (item.cadence === "weekly") return `${money(item.unit_rate, currency)}/week`;
    if (item.cadence === "monthly") return `${money(item.unit_rate, currency)}/month`;
    return money(item.unit_rate, currency);
  }

  function image(url, alt, className) {
    return url ? `<img class="${className}" src="${escapeHtml(url)}" alt="${escapeHtml(alt)}">` : "";
  }

  function render(invoice, assets = {}) {
    const currency = invoice.currency_code || "USD";
    const items = Array.isArray(invoice.items) ? invoice.items : [];
    const total = Number(invoice.total_amount ?? items.reduce(
      (sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_rate || 0),
      0
    ));
    const summary = invoice.summary || `This invoice covers ${invoice.contract_name} services provided to ${invoice.client_name} for ${dateRange(invoice.period_start, invoice.period_end)}.`;
    const metadata = [
      ["Invoice number", invoice.invoice_number],
      ["Created", longDate(invoice.created_date)],
      ["Billing period", dateRange(invoice.period_start, invoice.period_end)],
      ["Contract", invoice.contract_name],
      ["Due", invoice.due_date ? longDate(invoice.due_date) : (invoice.payment_terms || "Upon receipt")],
      ["PO / reference", invoice.purchase_order || "-"],
    ];

    return `<article class="invoice-preview-page" aria-label="Preview of invoice ${escapeHtml(invoice.invoice_number)}">
      <header class="invoice-preview-document-header">
        <div>${image(assets.businessLogoUrl, "Christian Steps Ministries", "invoice-preview-business-logo")}</div>
        <div class="invoice-preview-client-heading">
          ${image(assets.clientLogoUrl, `${invoice.client_name} logo`, "invoice-preview-client-logo") || (assets.clientLogoPending ? `<div class="invoice-preview-client-logo-placeholder" aria-label="Client logo from URL will appear after the invoice is created">Client logo<br><small>URL supplied</small></div>` : "")}
          <strong>${escapeHtml(invoice.client_name)}</strong>
          <span>Invoice</span>
        </div>
      </header>

      <section class="invoice-preview-section">
        <h2>1. Summary</h2>
        <p>${escapeHtml(summary)}</p>
      </section>

      <section class="invoice-preview-section">
        <h2>2. Invoice</h2>
        <table class="invoice-preview-billing-table">
          <thead><tr><th>Services</th><th>Rate</th><th>Qty</th><th>Amount</th></tr></thead>
          <tbody>
            ${items.map((item) => `<tr>
              <td><strong>${escapeHtml(item.work_type)}</strong>${item.description ? `<span>${escapeHtml(item.description)}</span>` : ""}</td>
              <td>${escapeHtml(rateLabel(item, currency))}</td>
              <td>${escapeHtml(quantity(item.quantity))}</td>
              <td><strong>${escapeHtml(money(item.line_total ?? Number(item.quantity || 0) * Number(item.unit_rate || 0), currency))}</strong></td>
            </tr>`).join("")}
            <tr class="invoice-preview-total-row"><th colspan="3">Total due</th><td>${escapeHtml(money(total, currency))}</td></tr>
          </tbody>
        </table>
        ${invoice.payment_terms ? `<p class="invoice-preview-terms">Terms: ${escapeHtml(invoice.payment_terms)}</p>` : ""}
        ${invoice.payment_instructions ? `<div class="invoice-preview-payment"><strong>Payment instructions</strong><p>${escapeHtml(invoice.payment_instructions)}</p></div>` : ""}
      </section>

      <section class="invoice-preview-details" aria-label="Invoice details">
        <h3>Invoice details</h3>
        <dl>${metadata.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
      </section>

      <section class="invoice-preview-signatures">
        <h2>3. Signatures</h2>
        <p class="invoice-preview-signature-note">Electronic signature and email confirmation is sufficient</p>
        <div class="invoice-preview-signature-row">
          <div><span>Christian Steps Ministries</span>${image(assets.signatureUrl, "Brent Kern signature", "invoice-preview-signature")}<span>By: Brent D. Kern</span></div>
          <span>Date: ${escapeHtml(longDate(invoice.created_date))}</span>
        </div>
        <div class="invoice-preview-signature-row invoice-preview-client-signature">
          <div><span>Client</span><span>By: ______________________________</span></div>
          <span>Date: ____________</span>
        </div>
      </section>

      <footer class="invoice-preview-document-footer">
        <span>${escapeHtml(longDate(invoice.created_date))}</span>
        <span>Page 1</span>
        <span>&copy;${escapeHtml(String(invoice.created_date || "").slice(0, 4) || new Date().getFullYear())} Christian Steps Ministries</span>
        ${image(assets.businessLogoUrl, "", "invoice-preview-footer-logo")}
      </footer>
    </article>`;
  }

  globalThis.ChristianStepsInvoicePreview = Object.freeze({ render });
})();
