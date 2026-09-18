"use strict";

(() => {
  const encoder = new TextEncoder();
  const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  const escapeXml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

  const money = (value, currency = "USD") => new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

  const number = (value) => new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

  const longDate = (value) => {
    if (!value) return "";
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${value}T12:00:00Z`));
  };

  const compactDateRange = (start, end) => {
    if (!start || !end) return "";
    const startDate = new Date(`${start}T12:00:00Z`);
    const endDate = new Date(`${end}T12:00:00Z`);
    const sameYear = startDate.getUTCFullYear() === endDate.getUTCFullYear();
    const sameMonth = sameYear && startDate.getUTCMonth() === endDate.getUTCMonth();
    if (sameMonth) {
      const month = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(startDate);
      return `${month} ${startDate.getUTCDate()}-${endDate.getUTCDate()}, ${endDate.getUTCFullYear()}`;
    }
    if (sameYear) {
      const first = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(startDate);
      const last = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(endDate);
      return `${first}-${last}`;
    }
    return `${longDate(start)}-${longDate(end)}`;
  };

  const plainText = (value) => String(value ?? "").replace(/\r\n?/g, "\n");

  function run(value, { bold = false, italic = false, color = null, size = null, underline = false } = {}) {
    const properties = [
      bold ? "<w:b/>" : "",
      italic ? "<w:i/>" : "",
      color ? `<w:color w:val="${color}"/>` : "",
      size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : "",
      underline ? '<w:u w:val="single"/>' : "",
    ].join("");
    const pieces = plainText(value).split("\n");
    return pieces.map((piece, index) => `${index ? "<w:r><w:br/></w:r>" : ""}<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ""}<w:t xml:space="preserve">${escapeXml(piece)}</w:t></w:r>`).join("");
  }

  function paragraph(value = "", options = {}) {
    const { style = null, align = null, before = 0, after = 120, line = 276, keepNext = false, indent = 0, italic = false, bold = false, color = null, size = null } = options;
    const isHeading = style === "Heading2";
    const pPr = [
      style ? `<w:pStyle w:val="${style}"/>` : "",
      align ? `<w:jc w:val="${align}"/>` : "",
      `<w:spacing w:before="${before}" w:after="${after}" w:line="${line}" w:lineRule="auto"/>`,
      keepNext ? "<w:keepNext/>" : "",
      "<w:suppressAutoHyphens/>",
      indent ? `<w:ind w:left="${indent}"/>` : "",
    ].join("");
    return `<w:p><w:pPr>${pPr}</w:pPr>${run(value, {
      italic,
      bold: bold || isHeading,
      color: color || (isHeading ? "0B2B78" : null),
      size: size || (isHeading ? 36 : null),
    })}</w:p>`;
  }

  function pageConditionalRun(value, { bold = false, color = null, size = null } = {}) {
    const fieldResultProperties = [
      bold ? "<w:b/>" : "",
      color ? `<w:color w:val="${color}"/>` : "",
      size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : "",
    ].join("");
    const condition = ` > 1 "${plainText(value).replaceAll("\n", " ")}" "" \\* MERGEFORMAT `;
    return `<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> IF </w:instrText></w:r><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:instrText xml:space="preserve">${escapeXml(condition)}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r>${fieldResultProperties ? `<w:rPr>${fieldResultProperties}</w:rPr>` : ""}<w:t xml:space="preserve"></w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  }

  function cell(content, width, { shade = null, bold = false, color = null, size = null, align = null, margins = 100, vertical = "center", gridSpan = 1 } = {}) {
    const paragraphs = Array.isArray(content)
      ? content.join("")
      : paragraph(content, { bold, color, size, align, after: 60, line: 260 });
    return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${gridSpan > 1 ? `<w:gridSpan w:val="${gridSpan}"/>` : ""}<w:vAlign w:val="${vertical}"/>${shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : ""}<w:tcMar><w:top w:w="${margins}" w:type="dxa"/><w:left w:w="${margins}" w:type="dxa"/><w:bottom w:w="${margins}" w:type="dxa"/><w:right w:w="${margins}" w:type="dxa"/></w:tcMar></w:tcPr>${paragraphs}</w:tc>`;
  }

  function table(rows, widths, { borders = true, layout = "fixed", after = 160 } = {}) {
    const borderXml = borders
      ? '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="D9D9D9"/><w:left w:val="single" w:sz="4" w:color="D9D9D9"/><w:bottom w:val="single" w:sz="4" w:color="D9D9D9"/><w:right w:val="single" w:sz="4" w:color="D9D9D9"/><w:insideH w:val="single" w:sz="4" w:color="D9D9D9"/><w:insideV w:val="single" w:sz="4" w:color="D9D9D9"/></w:tblBorders>'
      : '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>';
    const trailingParagraph = after === null ? "" : paragraph("", { after });
    return `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((sum, value) => sum + value, 0)}" w:type="dxa"/><w:tblLayout w:type="${layout}"/>${borderXml}<w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>${rows.join("")}</w:tbl>${trailingParagraph}`;
  }

  const tableRow = (cells, { header = false, cantSplit = true } = {}) => `<w:tr><w:trPr>${header ? '<w:tblHeader w:val="true"/>' : ""}${cantSplit ? "<w:cantSplit/>" : ""}</w:trPr>${cells.join("")}</w:tr>`;

  function drawing(relationshipId, name, widthEmu, heightEmu, id) {
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${widthEmu}" cy="${heightEmu}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="${escapeXml(name)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${escapeXml(name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }

  function imageParagraph(relationshipId, name, widthEmu, heightEmu, id, align = "left", after = 40, keepNext = false) {
    return `<w:p><w:pPr><w:jc w:val="${align}"/><w:spacing w:after="${after}"/>${keepNext ? "<w:keepNext/>" : ""}</w:pPr>${drawing(relationshipId, name, widthEmu, heightEmu, id)}</w:p>`;
  }

  const imageDetails = (mimeType, fallback = "png") => {
    const mime = String(mimeType || "image/png").toLowerCase().split(";")[0];
    if (mime === "image/jpeg" || mime === "image/jpg") return { extension: "jpg", contentType: "image/jpeg" };
    if (mime === "image/png") return { extension: "png", contentType: "image/png" };
    return { extension: fallback, contentType: mime || `image/${fallback}` };
  };

  const asBytes = (value) => value instanceof Uint8Array ? value : new Uint8Array(value);

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let value = n;
      for (let k = 0; k < 8; k += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      table[n] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(dateValue) {
    const value = dateValue instanceof Date ? dateValue : new Date();
    const year = Math.max(1980, value.getFullYear());
    return {
      time: ((value.getHours() & 31) << 11) | ((value.getMinutes() & 63) << 5) | ((value.getSeconds() / 2) & 31),
      date: (((year - 1980) & 127) << 9) | (((value.getMonth() + 1) & 15) << 5) | (value.getDate() & 31),
    };
  }

  function bytesWriter(length) {
    const bytes = new Uint8Array(length);
    const view = new DataView(bytes.buffer);
    return { bytes, view };
  }

  function concat(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    parts.forEach((part) => { result.set(part, offset); offset += part.length; });
    return result;
  }

  function zip(entries, stamp) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    const dt = dosDateTime(stamp);
    entries.forEach(([name, content]) => {
      const nameBytes = encoder.encode(name);
      const data = typeof content === "string" ? encoder.encode(content) : asBytes(content);
      const crc = crc32(data);
      const local = bytesWriter(30);
      local.view.setUint32(0, 0x04034b50, true);
      local.view.setUint16(4, 20, true);
      local.view.setUint16(6, 0x0800, true);
      local.view.setUint16(8, 0, true);
      local.view.setUint16(10, dt.time, true);
      local.view.setUint16(12, dt.date, true);
      local.view.setUint32(14, crc, true);
      local.view.setUint32(18, data.length, true);
      local.view.setUint32(22, data.length, true);
      local.view.setUint16(26, nameBytes.length, true);
      local.view.setUint16(28, 0, true);
      locals.push(local.bytes, nameBytes, data);

      const central = bytesWriter(46);
      central.view.setUint32(0, 0x02014b50, true);
      central.view.setUint16(4, 20, true);
      central.view.setUint16(6, 20, true);
      central.view.setUint16(8, 0x0800, true);
      central.view.setUint16(10, 0, true);
      central.view.setUint16(12, dt.time, true);
      central.view.setUint16(14, dt.date, true);
      central.view.setUint32(16, crc, true);
      central.view.setUint32(20, data.length, true);
      central.view.setUint32(24, data.length, true);
      central.view.setUint16(28, nameBytes.length, true);
      central.view.setUint16(30, 0, true);
      central.view.setUint16(32, 0, true);
      central.view.setUint16(34, 0, true);
      central.view.setUint16(36, 0, true);
      central.view.setUint32(38, 0, true);
      central.view.setUint32(42, offset, true);
      centrals.push(central.bytes, nameBytes);
      offset += 30 + nameBytes.length + data.length;
    });
    const centralBytes = concat(centrals);
    const end = bytesWriter(22);
    end.view.setUint32(0, 0x06054b50, true);
    end.view.setUint16(4, 0, true);
    end.view.setUint16(6, 0, true);
    end.view.setUint16(8, entries.length, true);
    end.view.setUint16(10, entries.length, true);
    end.view.setUint32(12, centralBytes.length, true);
    end.view.setUint32(16, offset, true);
    end.view.setUint16(20, 0, true);
    return concat([...locals, centralBytes, end.bytes]);
  }

  function rateLabel(item, currency) {
    if (item.billing_type === "hourly") return `${money(item.unit_rate, currency)}/hour`;
    if (item.cadence === "weekly") return `${money(item.unit_rate, currency)}/week`;
    if (item.cadence === "monthly") return `${money(item.unit_rate, currency)}/month`;
    return money(item.unit_rate, currency);
  }

  function headerXml(invoice, hasClientLogo) {
    const clientLogo = hasClientLogo
      ? imageParagraph("rId2", "Client logo", 548640, 548640, 2, "right", 20)
      : "";
    const right = [
      clientLogo,
      paragraph(invoice.client_name, { bold: true, color: "A01D35", size: 28, align: "right", after: 100, line: 300 }),
      paragraph("Invoice", { size: 26, align: "right", after: 40 }),
    ];
    const row = tableRow([
      cell([imageParagraph("rId1", "Christian Steps Ministries logo", 731520, 731520, 1, "left", 0)], 3000, { margins: 0, vertical: "center" }),
      cell(right, 6360, { margins: 0, vertical: "center" }),
    ], { cantSplit: true });
    const headerTable = table([row], [3000, 6360], { borders: false, after: 20 });
    const rule = '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="7" w:space="1" w:color="0B2B78"/></w:pBdr><w:spacing w:before="0" w:after="80"/></w:pPr></w:p>';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">${headerTable}${rule}</w:hdr>`;
  }

  function footerXml(invoice) {
    const year = String(invoice.created_date || "").slice(0, 4) || new Date().getFullYear();
    const topRule = '<w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="7" w:space="1" w:color="0B2B78"/></w:pBdr><w:spacing w:after="50"/></w:pPr></w:p>';
    const pageField = '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="0"/></w:pPr><w:r><w:t xml:space="preserve">Page </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>';
    const rowOne = tableRow([
      cell(longDate(invoice.created_date), 3120, { margins: 0 }),
      cell([pageField], 3120, { margins: 0 }),
      cell("", 3120, { margins: 0 }),
    ]);
    const rowTwo = tableRow([
      cell(`\u00A9${year} Christian Steps Ministries`, 7800, { margins: 0 }),
      cell([imageParagraph("rId1", "Christian Steps Ministries logo", 731520, 548640, 3, "right", 0)], 1560, { margins: 0, vertical: "center" }),
    ]);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">${topRule}${table([rowOne, rowTwo], [3120, 3120, 3120], { borders: false, after: 0 })}</w:ftr>`;
  }

  function documentXml(invoice) {
    const currency = invoice.currency_code || "USD";
    const metadata = [
      ["Invoice number", invoice.invoice_number],
      ["Created", longDate(invoice.created_date)],
      ["Billing period", compactDateRange(invoice.period_start, invoice.period_end)],
      ["Contract", invoice.contract_name],
      ["Due", invoice.due_date ? longDate(invoice.due_date) : (invoice.payment_terms || "Upon receipt")],
      ["PO / reference", invoice.purchase_order || "-"],
    ];
    const metadataRows = [];
    for (let index = 0; index < metadata.length; index += 3) {
      const shade = index === 0 ? "F3F7FB" : null;
      metadataRows.push(tableRow(metadata.slice(index, index + 3).map(([label, value]) => cell([
        paragraph(String(label).toUpperCase(), { bold: true, color: "4B5E70", size: 18, after: 20, line: 220 }),
        paragraph(value, { after: 0, line: 260 }),
      ], 3120, { shade, margins: 60, vertical: "center" }))));
    }

    const widths = [4800, 1800, 900, 1860];
    const invoiceRows = [tableRow([
      cell("Services", widths[0], { bold: true, color: "FFFFFF", shade: "0B2B78", margins: 80 }),
      cell("Rate", widths[1], { bold: true, color: "FFFFFF", shade: "0B2B78", align: "right", margins: 80 }),
      cell("Qty", widths[2], { bold: true, color: "FFFFFF", shade: "0B2B78", align: "center", margins: 80 }),
      cell("Amount", widths[3], { bold: true, color: "FFFFFF", shade: "0B2B78", align: "right", margins: 80 }),
    ], { header: true })];
    (invoice.items || []).forEach((item, index) => {
      const service = [paragraph(item.work_type, { bold: true, after: item.description ? 30 : 0, line: 260 })];
      if (item.description) service.push(paragraph(item.description, { after: 0, line: 260 }));
      const shade = index % 2 ? "F7FAFD" : null;
      invoiceRows.push(tableRow([
        cell(service, widths[0], { shade, margins: 90 }),
        cell(rateLabel(item, currency), widths[1], { shade, align: "right", margins: 90 }),
        cell(number(item.quantity), widths[2], { shade, align: "center", margins: 90 }),
        cell(money(item.line_total ?? Number(item.quantity) * Number(item.unit_rate), currency), widths[3], { shade, bold: true, align: "right", margins: 90 }),
      ]));
    });
    invoiceRows.push(tableRow([
      cell("Total due", widths[0] + widths[1] + widths[2], { gridSpan: 3, bold: true, shade: "EAF0F6", align: "right", margins: 100 }),
      cell(money(invoice.total_amount, currency), widths[3], { bold: true, color: "FFFFFF", shade: "0B2B78", align: "right", margins: 100 }),
    ]));

    const signatureRows = [
      tableRow([
        cell([
          paragraph("Christian Steps Ministries", { after: 0, keepNext: true }),
          imageParagraph("rId12", "Brent Kern signature", 1650000, 300000, 10, "left", 0, true),
          paragraph("By: Brent D. Kern", { after: 0, keepNext: true }),
        ], 6100, { margins: 0 }),
        cell([paragraph(`Date: ${longDate(invoice.created_date)}`, { after: 0, keepNext: true })], 3260, { margins: 0, vertical: "bottom" }),
      ]),
      tableRow([
        cell([paragraph("Client", { before: 10, after: 10 }), paragraph("By: ______________________________", { after: 0 })], 6100, { margins: 0 }),
        cell([paragraph("Date: ____________", { after: 0 })], 3260, { margins: 0, vertical: "bottom" }),
      ]),
    ];

    const paymentInfo = invoice.payment_instructions
      ? `${paragraph("Payment instructions", { bold: true, color: "0B2B78", after: 30 })}${paragraph(invoice.payment_instructions, { after: 60 })}`
      : "";
    const terms = invoice.payment_terms
      ? paragraph(`Terms: ${invoice.payment_terms}`, { italic: true, after: 60 })
      : "";
    const summary = invoice.summary || `This invoice covers ${invoice.contract_name} services provided to ${invoice.client_name} for ${compactDateRange(invoice.period_start, invoice.period_end)}.`;

    // Word has no conditional page-break element. A keep-with-next chain across
    // the heading, note, and first signature row leaves the section here when it
    // fits or moves the complete section to the next page when it does not.
    const signatureNote = `<w:p><w:pPr><w:spacing w:before="0" w:after="10" w:line="260" w:lineRule="auto"/><w:keepNext/><w:suppressAutoHyphens/></w:pPr>${pageConditionalRun(`Total due (continued): ${money(invoice.total_amount, currency)}  |  `, { bold: true, color: "0B2B78", size: 22 })}${run("Electronic signature and email confirmation is sufficient", { italic: true })}</w:p>`;

    const body = [
      paragraph("1. Summary", { style: "Heading2", before: 80, after: 100, keepNext: true }),
      paragraph(summary, { after: 130, line: 300 }),
      paragraph("2. Invoice", { style: "Heading2", before: 40, after: 100, keepNext: true }),
      table(invoiceRows, widths, { borders: true, after: 70 }),
      terms,
      paymentInfo,
      paragraph("Invoice details", { bold: true, color: "0B2B78", size: 24, before: 60, after: 40, keepNext: true }),
      table(metadataRows, [3120, 3120, 3120], { borders: true, after: 0 }),
      paragraph("3. Signatures", { style: "Heading2", before: 0, after: 20, keepNext: true }),
      signatureNote,
      table(signatureRows, [6100, 3260], { borders: false, after: null }),
      paragraph("", { after: 0, line: 20 }),
      '<w:sectPr><w:headerReference w:type="default" r:id="rId10"/><w:footerReference w:type="default" r:id="rId11"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1260" w:right="1080" w:bottom="1260" w:left="1080" w:header="180" w:footer="180" w:gutter="0"/><w:cols w:space="720"/><w:docGrid w:linePitch="360"/></w:sectPr>',
    ].join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}</w:body></w:document>`;
  }

  function stylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="160" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:color w:val="0B2B78"/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style></w:styles>`;
  }

  function contentTypes(clientLogo) {
    const details = clientLogo ? imageDetails(clientLogo.mimeType) : null;
    const clientDefault = details && details.extension !== "png" && details.extension !== "jpg"
      ? `<Default Extension="${details.extension}" ContentType="${escapeXml(details.contentType)}"/>`
      : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>${clientDefault}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  }

  function fileNameForInvoice(invoice) {
    const client = String(invoice.client_name || "Client").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const numberPart = String(invoice.invoice_number || "Invoice").replace(/[^A-Za-z0-9_-]+/g, "-");
    return `${client || "Client"}-${numberPart || "Invoice"}.docx`;
  }

  function buildInvoiceDocument(invoice, assets) {
    if (!invoice || !Array.isArray(invoice.items) || !invoice.items.length) throw new Error("Invoice lines are required.");
    if (!assets?.businessLogo || !assets?.signature) throw new Error("Christian Steps branding is required.");
    const logoBytes = asBytes(assets.businessLogo.bytes ?? assets.businessLogo);
    const signatureBytes = asBytes(assets.signature.bytes ?? assets.signature);
    const clientLogo = invoice.include_client_logo && assets.clientLogo ? assets.clientLogo : null;
    const clientDetails = clientLogo ? imageDetails(clientLogo.mimeType) : null;
    const stamp = new Date(`${invoice.created_date || new Date().toISOString().slice(0, 10)}T12:00:00Z`);
    const entries = [
      ["[Content_Types].xml", contentTypes(clientLogo)],
      ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>'],
      ["docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(invoice.invoice_number)} - ${escapeXml(invoice.client_name)}</dc:title><dc:subject>Consulting invoice</dc:subject><dc:creator>Christian Steps Ministries</dc:creator><cp:lastModifiedBy>Christian Steps Admin Portal</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${stamp.toISOString()}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${stamp.toISOString()}</dcterms:modified></cp:coreProperties>`],
      ["docProps/app.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Christian Steps Admin Portal</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><Company>Christian Steps Ministries</Company><AppVersion>1.0</AppVersion></Properties>'],
      ["word/document.xml", documentXml(invoice)],
      ["word/styles.xml", stylesXml()],
      ["word/settings.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:updateFields w:val="true"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'],
      ["word/header1.xml", headerXml(invoice, Boolean(clientLogo))],
      ["word/footer1.xml", footerXml(invoice)],
      ["word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId11" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/><Relationship Id="rId12" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/signature.png"/></Relationships>'],
      ["word/_rels/header1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/business-logo.png"/>${clientLogo ? `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/client-logo.${clientDetails.extension}"/>` : ""}</Relationships>`],
      ["word/_rels/footer1.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/business-logo.png"/></Relationships>'],
      ["word/media/business-logo.png", logoBytes],
      ["word/media/signature.png", signatureBytes],
    ];
    if (clientLogo) entries.push([`word/media/client-logo.${clientDetails.extension}`, asBytes(clientLogo.bytes)]);
    return new Blob([zip(entries, stamp)], { type: DOCX_MIME });
  }

  globalThis.ChristianStepsInvoiceDocx = {
    buildInvoiceDocument,
    compactDateRange,
    fileNameForInvoice,
    longDate,
  };
})();
