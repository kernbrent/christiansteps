(function initializeGivingLetters(global) {
  "use strict";

  const TEMPLATE_URL = "resources/ChristianSteps-Giving-Letter-Template.docx";
  const WORD_NAMESPACE = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const PRODUCTS = { HopeSojourns: "Hope Sojourns", JoshBeyondBorders: "Josh Beyond Borders", ChristianSteps: "Christian Steps" };
  const state = { api: null, setBusy: null, toast: null, donors: [], filtered: [], years: [] };
  const byId = id => document.getElementById(id);
  const money = value => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));
  const amountText = value => Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const safeFileName = value => String(value || "Donor").normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "Donor";

  function donorKey(transaction) {
    const email = String(transaction.counterpartyEmail || "").trim().toLowerCase();
    if (email) return `email:${email}`;
    return [transaction.counterpartyName, transaction.addressLine1, transaction.postalCode]
      .map(value => String(value || "").trim().toLowerCase()).join("|");
  }

  function buildDonors(transactions) {
    const groups = new Map();
    for (const transaction of transactions) {
      const key = donorKey(transaction);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(transaction);
    }
    return Array.from(groups.entries()).map(([key, gifts]) => {
      const preferred = gifts.find(gift => gift.addressLine1 || gift.city || gift.postalCode) || gifts[0];
      return {
        key,
        name: preferred.counterpartyName || preferred.shippingName || "Donor",
        email: preferred.counterpartyEmail || gifts.find(gift => gift.counterpartyEmail)?.counterpartyEmail || "",
        addressLine1: preferred.addressLine1 || "",
        addressLine2: preferred.addressLine2 || "",
        city: preferred.city || "",
        region: preferred.region || "",
        postalCode: preferred.postalCode || "",
        gifts,
        total: Math.round(gifts.reduce((sum, gift) => sum + Number(gift.gross || 0), 0) * 100) / 100,
      };
    }).sort((left, right) => left.name.localeCompare(right.name, "en-US"));
  }

  function addressText(donor) {
    const locality = [donor.city, donor.region].filter(Boolean).join(", ");
    return [donor.addressLine1, donor.addressLine2, [locality, donor.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  }

  function selectedDonors() {
    const keys = new Set(Array.from(document.querySelectorAll("[data-donor-select]:checked"), input => input.value));
    return state.donors.filter(donor => keys.has(donor.key));
  }

  function updateSelectionCount() {
    const selected = selectedDonors().length;
    byId("donor-selection-count").textContent = `${selected} donor${selected === 1 ? "" : "s"} selected`;
    byId("generate-letters-button").disabled = selected === 0;
  }

  function renderDonors() {
    const query = byId("letter-search").value.trim().toLowerCase();
    state.filtered = state.donors.filter(donor => !query || `${donor.name} ${donor.email} ${addressText(donor)}`.toLowerCase().includes(query));
    const body = byId("donor-body");
    body.replaceChildren();
    for (const donor of state.filtered) {
      const row = document.createElement("tr");
      const checkCell = row.insertCell();
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = donor.key;
      checkbox.dataset.donorSelect = "true";
      checkbox.setAttribute("aria-label", `Select ${donor.name}`);
      checkbox.addEventListener("change", updateSelectionCount);
      checkCell.append(checkbox);
      const donorCell = row.insertCell();
      const person = document.createElement("span");
      person.className = "person-cell";
      const strong = document.createElement("strong");
      strong.textContent = donor.name;
      const small = document.createElement("small");
      small.textContent = donor.gifts.map(gift => PRODUCTS[gift.product] || gift.product).filter((value, index, values) => values.indexOf(value) === index).join(", ");
      person.append(strong, small);
      donorCell.append(person);
      const addressCell = row.insertCell();
      const address = addressText(donor);
      addressCell.textContent = address || "Address missing—review before mailing";
      if (!address) addressCell.className = "address-warning";
      row.insertCell().textContent = String(donor.gifts.length);
      const totalCell = row.insertCell();
      totalCell.className = "number-cell";
      totalCell.textContent = money(donor.total);
      const emailCell = row.insertCell();
      const envelope = document.createElement("button");
      envelope.type = "button";
      envelope.className = "envelope-button";
      envelope.textContent = "✉";
      envelope.title = donor.email ? `Email ${donor.name}` : "No email address is available";
      envelope.setAttribute("aria-label", envelope.title);
      envelope.disabled = !donor.email;
      envelope.addEventListener("click", () => global.CSEmailTools.open(donor, Number(byId("letter-year").value)));
      emailCell.append(envelope);
      row.dataset.search = `${donor.name} ${donor.email}`;
      body.append(row);
    }
    byId("donor-message").textContent = state.donors.length
      ? `${state.filtered.length} of ${state.donors.length} donors shown. A missing address can still be generated, but should be corrected before mailing.`
      : "No completed contributions were found for this year.";
    byId("select-all-donors").checked = false;
    updateSelectionCount();
  }

  async function loadDonors() {
    const year = Number(byId("letter-year").value);
    state.setBusy(true, `Loading ${year} donors…`);
    try {
      const result = await state.api(`/donors?year=${year}`);
      state.donors = buildDonors(result.transactions || []);
      renderDonors();
    } catch (error) {
      byId("donor-message").textContent = error.message;
    } finally {
      state.setBusy(false);
    }
  }

  function wordTextNodes(root) {
    return Array.from(root.getElementsByTagNameNS(WORD_NAMESPACE, "t"));
  }

  function replaceText(root, replacements) {
    for (const node of wordTextNodes(root)) {
      let value = node.textContent || "";
      for (const [placeholder, replacement] of Object.entries(replacements)) value = value.split(placeholder).join(replacement);
      node.textContent = value.replace(/�/g, "—");
    }
  }

  function replaceAmounts(root, value) {
    const nodes = wordTextNodes(root);
    for (let index = 0; index < nodes.length; index += 1) {
      if (!(nodes[index].textContent || "").includes("[AMOUNT]")) continue;
      nodes[index].textContent = (nodes[index].textContent || "").replace("[AMOUNT]", amountText(value));
      const next = nodes[index + 1];
      if (next?.textContent?.startsWith(".00")) next.textContent = next.textContent.slice(3);
    }
  }

  function replaceGiftRow(row, gift) {
    const date = new Date(gift.transactionDate).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric", timeZone: "America/Chicago" });
    const documentXml = row.ownerDocument;
    let properties = Array.from(row.childNodes).find(node => node.localName === "pPr");
    if (!properties) {
      properties = documentXml.createElementNS(WORD_NAMESPACE, "w:pPr");
      row.prepend(properties);
    }
    const priorTabs = Array.from(properties.childNodes).find(node => node.localName === "tabs");
    priorTabs?.remove();
    const tabs = documentXml.createElementNS(WORD_NAMESPACE, "w:tabs");
    for (const position of [1440, 3600, 5760]) {
      const tab = documentXml.createElementNS(WORD_NAMESPACE, "w:tab");
      tab.setAttributeNS(WORD_NAMESPACE, "w:val", "left");
      tab.setAttributeNS(WORD_NAMESPACE, "w:pos", String(position));
      tabs.append(tab);
    }
    properties.append(tabs);
    Array.from(row.childNodes).filter(node => node !== properties).forEach(node => node.remove());
    const values = [date, `$${amountText(gift.gross)}`, PRODUCTS[gift.product] || gift.product || "Ministry", "PayPal"];
    values.forEach((value, index) => {
      const run = documentXml.createElementNS(WORD_NAMESPACE, "w:r");
      const text = documentXml.createElementNS(WORD_NAMESPACE, "w:t");
      text.textContent = value;
      run.append(text);
      if (index < values.length - 1) run.append(documentXml.createElementNS(WORD_NAMESPACE, "w:tab"));
      row.append(run);
    });
  }

  function buildDonorNodes(sourceNodes, donor, year) {
    const nodes = sourceNodes.map(node => node.cloneNode(true));
    const detailIndex = nodes.findIndex(node => (node.textContent || "").includes("[DATE]") && (node.textContent || "").includes("[AMOUNT]"));
    if (detailIndex >= 0) {
      const template = nodes[detailIndex];
      const rows = donor.gifts.map(gift => {
        const row = template.cloneNode(true);
        replaceGiftRow(row, gift);
        return row;
      });
      nodes.splice(detailIndex, 1, ...rows);
    }
    for (const node of nodes) {
      replaceText(node, {
        "[FIRST] [LAST]": donor.name,
        "[STREET ADDRESS]": donor.addressLine1,
        "[CITY]": donor.city,
        "[ST]": donor.region,
        "[ZIP]": donor.postalCode,
        "[YEAR]": String(year),
      });
      replaceAmounts(node, donor.total);
    }
    return nodes;
  }

  function pageBreak(documentXml) {
    const paragraph = documentXml.createElementNS(WORD_NAMESPACE, "w:p");
    const run = documentXml.createElementNS(WORD_NAMESPACE, "w:r");
    const br = documentXml.createElementNS(WORD_NAMESPACE, "w:br");
    br.setAttributeNS(WORD_NAMESPACE, "w:type", "page");
    run.append(br);
    paragraph.append(run);
    return paragraph;
  }

  async function createDocument(donors, year) {
    const response = await fetch(TEMPLATE_URL, { credentials: "same-origin" });
    if (!response.ok) throw new Error("The Christian Steps giving-letter template could not be loaded.");
    const entries = await global.CSOfficePackage.unpackPackage(await response.arrayBuffer());
    const documentEntry = entries.find(entry => entry.name === "word/document.xml");
    if (!documentEntry) throw new Error("The giving-letter template is missing its document content.");
    const decoder = new TextDecoder();
    const parser = new DOMParser();
    const documentXml = parser.parseFromString(decoder.decode(documentEntry.bytes), "application/xml");
    if (documentXml.querySelector("parsererror")) throw new Error("The giving-letter template could not be read.");
    const body = documentXml.getElementsByTagNameNS(WORD_NAMESPACE, "body")[0];
    const children = Array.from(body.childNodes);
    const sectionProperties = children.find(node => node.nodeType === Node.ELEMENT_NODE && node.localName === "sectPr");
    const sourceNodes = children.filter(node => node !== sectionProperties);
    body.replaceChildren();
    donors.forEach((donor, index) => {
      if (index) body.append(pageBreak(documentXml));
      body.append(...buildDonorNodes(sourceNodes, donor, year));
    });
    if (sectionProperties) body.append(sectionProperties);
    documentEntry.bytes = new TextEncoder().encode(new XMLSerializer().serializeToString(documentXml));
    return global.CSOfficePackage.packPackage(entries);
  }

  function download(buffer, donors, year) {
    const label = donors.length === 1 ? safeFileName(donors[0].name) : `${donors.length}-Donors`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
    link.download = `Christian-Steps-${year}-Giving-Letters-${label}.docx`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
  }

  async function generate() {
    const donors = selectedDonors();
    const year = Number(byId("letter-year").value);
    if (!donors.length) return;
    state.setBusy(true, `Creating ${donors.length} giving letter${donors.length === 1 ? "" : "s"}…`);
    try {
      download(await createDocument(donors, year), donors, year);
      state.toast(`${donors.length} giving letter${donors.length === 1 ? " was" : "s were"} created.`);
    } catch (error) {
      byId("donor-message").textContent = error.message;
    } finally {
      state.setBusy(false);
    }
  }

  function setYears(years) {
    state.years = years.length ? years : [new Date().getFullYear()];
    const select = byId("letter-year");
    const prior = select.value;
    select.replaceChildren(...state.years.map(year => {
      const option = document.createElement("option");
      option.value = String(year);
      option.textContent = String(year);
      return option;
    }));
    if (state.years.includes(Number(prior))) select.value = prior;
  }

  function init(options) {
    Object.assign(state, options);
    byId("load-donors-button").addEventListener("click", loadDonors);
    byId("letter-search").addEventListener("input", renderDonors);
    byId("generate-letters-button").addEventListener("click", generate);
    byId("select-all-donors").addEventListener("change", event => {
      document.querySelectorAll("[data-donor-select]").forEach(input => { input.checked = event.target.checked; });
      updateSelectionCount();
    });
    setYears(options.years || []);
  }

  async function open(years) {
    setYears(years || state.years);
    byId("letters-dialog").showModal();
    await loadDonors();
  }

  global.CSGivingLetters = Object.freeze({ init, open, buildDonors, createDocument });
})(window);
