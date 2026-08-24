(function initializeEmailTools(global) {
  "use strict";

  const CHRISTIAN_STEPS_LOGO = "https://www.christiansteps.net/LogoFeetGreen.png";
  const HOPE_SOJOURNS_LOGO = "https://www.christiansteps.net/Images/hope-sojourns-logo.png";
  let currentMessage = null;

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character]));

  const money = (value) => new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
  }).format(Number(value || 0));

  function compose(donor, year) {
    const givenName = String(donor.name || "").trim().split(/\s+/)[0] || "Friend";
    const subject = `Your ${year} Christian Steps Ministries giving letter`;
    const introduction = `Dear ${givenName},`;
    const paragraph = `Thank you for your generous support of Christian Steps Ministries. Attached is your ${year} giving letter showing total contributions of ${money(donor.total)}.`;
    const reminder = "Please keep this letter with your tax records. If anything needs to be corrected, reply to this email and we will be glad to help.";
    const plainText = [
      introduction, "", paragraph, "", reminder, "", "With gratitude,", "",
      "Brent D Kern", "Christian Steps Ministries", "christianstepsministries@gmail.com",
      "www.christiansteps.net", "www.hopesojourns.com",
    ].join("\n");
    const html = `
      <div style="font-family:Arial,sans-serif;color:#17211e;line-height:1.55;max-width:680px">
        <p>${escapeHtml(introduction)}</p>
        <p>${escapeHtml(paragraph)}</p>
        <p>${escapeHtml(reminder)}</p>
        <p style="margin-top:22px">With gratitude,</p>
        <div style="border-top:1px solid #dce4e1;margin-top:18px;padding-top:15px">
          <strong style="font-size:16px;color:#123f33">Brent D Kern</strong><br>
          <span>Christian Steps Ministries</span><br>
          <a href="mailto:christianstepsministries@gmail.com">christianstepsministries@gmail.com</a><br>
          <a href="https://www.christiansteps.net">www.christiansteps.net</a><br>
          <a href="https://www.hopesojourns.com">www.hopesojourns.com</a>
          <div style="display:flex;align-items:center;gap:18px;margin-top:12px">
            <img src="${CHRISTIAN_STEPS_LOGO}" alt="Christian Steps Ministries" width="145" style="max-width:145px;max-height:54px;width:auto;height:auto">
            <img src="${HOPE_SOJOURNS_LOGO}" alt="Hope Sojourns" width="185" style="max-width:185px;max-height:54px;width:auto;height:auto">
          </div>
        </div>
      </div>`;
    return { to: donor.email || "", subject, plainText, html };
  }

  async function copy(message) {
    if (global.ClipboardItem && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({
        "text/plain": new Blob([message.plainText], { type: "text/plain" }),
        "text/html": new Blob([message.html], { type: "text/html" }),
      })]);
      return;
    }
    await navigator.clipboard.writeText(message.plainText);
  }

  function initDialog() {
    const dialog = document.getElementById("email-dialog");
    document.getElementById("copy-email-button").addEventListener("click", async () => {
      const status = document.getElementById("email-message");
      try {
        await copy(currentMessage);
        status.textContent = "The formatted message and signature were copied. Paste them into your email after attaching the giving letter.";
        status.style.color = "#126545";
      } catch {
        status.textContent = "Your browser could not copy the message. Open your email program to use the plain-text version.";
        status.style.color = "#a02929";
      }
    });
    document.getElementById("open-email-button").addEventListener("click", () => {
      if (!currentMessage) return;
      const mailto = `mailto:${encodeURIComponent(currentMessage.to)}?subject=${encodeURIComponent(currentMessage.subject)}&body=${encodeURIComponent(currentMessage.plainText)}`;
      global.location.href = mailto;
    });
    return dialog;
  }

  let dialog;
  function open(donor, year) {
    dialog ||= initDialog();
    currentMessage = compose(donor, year);
    document.getElementById("email-to").textContent = currentMessage.to || "No email address on the PayPal record";
    document.getElementById("email-subject").textContent = currentMessage.subject;
    document.getElementById("email-message").textContent = "";
    document.getElementById("open-email-button").disabled = !currentMessage.to;
    dialog.showModal();
  }

  global.CSEmailTools = Object.freeze({ compose, copy, open });
})(window);
