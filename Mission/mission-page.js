if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js?v=5', { updateViaCache: 'none' })
    .then(registration => registration.update());
}

fetch('/header.html', { cache: 'no-store' }).then(r => r.text()).then(html => {
  const host = document.getElementById('siteHeader');
  if (!host) return;
  host.innerHTML = html;
  const button = host.querySelector('.nav-toggle');
  const nav = host.querySelector('ul.nav');
  if (button && nav) button.addEventListener('click', event => {
    event.stopPropagation();
    const isOpen = nav.classList.toggle('open');
    button.setAttribute('aria-expanded', String(isOpen));
  });
});
fetch('/footer.html', { cache: 'no-store' }).then(r => r.text()).then(html => {
  const host = document.getElementById('siteFooter');
  if (host) host.innerHTML = html;
});
