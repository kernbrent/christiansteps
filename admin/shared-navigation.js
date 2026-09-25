(() => {
  let observer;

  function addNavigationLink(nav, { href, label, mark, dataAttribute }) {
    const link = document.createElement("a");
    link.href = href;
    link.className = "quiet-button";
    link.textContent = label;
    if (dataAttribute) link.dataset[dataAttribute] = "true";

    if (nav.classList.contains("csm-portal-nav")) {
      const icon = document.createElement("span");
      icon.className = "csm-nav-mark";
      icon.textContent = mark;
      link.prepend(icon);
    } else if (nav.classList.contains("admin-nav")) {
      const icon = document.createElement("span");
      icon.className = "nav-mark";
      icon.textContent = mark;
      link.prepend(icon);
    }

    nav.append(link);
  }

  function show(session) {
    const user = session.user;
    if (!user) return;
    if (user.must_change_password) {
      location.replace("/admin/account/#password");
      return;
    }

    const finance = location.pathname.startsWith("/admin/ledger/");
    const section = finance ? "finances" : "giving";
    if (!user.is_admin && !["read", "edit"].includes(user.permissions[section])) {
      location.replace("/admin/account/");
      return;
    }

    const nav = document.querySelector(".admin-nav,.header-actions");
    if (nav && !nav.querySelector("[data-shared-account]")) {
      const canUseGiving = user.is_admin || ["read", "edit"].includes(user.permissions.giving);
      if (!document.querySelector('a[href="/admin/personal-gifts/"],a[href="personal-gifts/"]') && canUseGiving) {
        addNavigationLink(nav, {
          href: "/admin/personal-gifts/",
          label: "Personally received gifts",
          mark: "P",
        });
      }

      addNavigationLink(nav, {
        href: "/admin/account/",
        label: user.is_admin ? "My profile & users" : "My profile",
        mark: "A",
        dataAttribute: "sharedAccount",
      });

      if (user.can_switch && user.switch_url) {
        addNavigationLink(nav, {
          href: `${user.switch_url}?sourceOrigin=${encodeURIComponent(location.origin)}`,
          label: "Switch to Hope Sojourns",
          mark: "H",
        });
      }
    }

    const readOnly = !user.is_admin && user.permissions[section] === "read";
    function updatePermissions() {
      document.querySelectorAll("a").forEach((link) => {
        if (!user.is_admin && link.getAttribute("href") === "#/paypal" && !["read", "edit"].includes(user.permissions.giving)) {
          link.hidden = true;
        }
        if (!user.is_admin && link.getAttribute("href") === "/admin/ledger/" && !["read", "edit"].includes(user.permissions.finances)) {
          link.hidden = true;
        }
      });
      if (readOnly) {
        document.querySelectorAll("button,input,select,textarea").forEach((control) => {
          const isWriteControl =
            control.closest("[data-form],.record-form") ||
            control.matches('[data-action="edit"],[data-action="delete"],[data-action="add"],[data-action^="add-"],[data-action^="edit-"],[data-action^="delete-"],[data-action^="record-"],[data-action^="save-"],[data-action^="upload-"],[data-action^="remove-"],[data-action^="mark-"],[data-action="toggle-category"]') ||
            /^(Add |Create |Save|Delete|Remove|Import|Approve|Reject|Send |Upload|Replace|Mark |Record |Pull |Refresh full|Edit$)/i.test(control.textContent.trim());
          if (isWriteControl) {
            control.disabled = true;
            control.title = "Read-only access";
          }
        });
      }
    }

    observer?.disconnect();
    updatePermissions();
    observer = new MutationObserver(updatePermissions);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener("shared-session", (event) => show(event.detail));
  fetch("/api/admin/session", { cache: "no-store" })
    .then((response) => response.ok ? response.json() : null)
    .then((session) => session && show(session))
    .catch(() => {});
})();
