(() => {
  'use strict';
  const tableScroll = document.getElementById('giving-table-scroll');
  const floating = document.getElementById('giving-floating-scroll');
  if (!tableScroll || !floating) return;
  const table = tableScroll.querySelector('table');
  const track = floating.firstElementChild;
  let frame = 0;
  function update() {
    frame = 0;
    const rect = tableScroll.getBoundingClientRect();
    const view = window.visualViewport;
    const top = view?.offsetTop || 0;
    const bottom = top + (view?.height || window.innerHeight);
    const left = Math.max(rect.left, (view?.offsetLeft || 0) + 8);
    const right = Math.min(rect.right, (view?.offsetLeft || 0) + (view?.width || window.innerWidth) - 8);
    const range = tableScroll.scrollWidth - tableScroll.clientWidth;
    // Use the table's own scrollbar when its bottom is already within reach.
    floating.hidden = !tableScroll.getClientRects().length || range < 2 || right <= left || rect.top >= bottom - 55 || rect.bottom <= bottom - 12;
    if (floating.hidden) return;
    floating.style.left = `${left}px`;
    floating.style.width = `${right - left}px`;
    floating.style.bottom = `${Math.max(12, window.innerHeight - bottom + 12)}px`;
    track.style.width = `${floating.clientWidth + range}px`;
    floating.scrollLeft = tableScroll.scrollLeft;
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }
  floating.addEventListener('scroll', () => {
    if (!floating.hidden && Math.abs(tableScroll.scrollLeft - floating.scrollLeft) > 1) tableScroll.scrollLeft = floating.scrollLeft;
  }, {passive:true});
  tableScroll.addEventListener('scroll', () => {
    if (!floating.hidden && Math.abs(floating.scrollLeft - tableScroll.scrollLeft) > 1) floating.scrollLeft = tableScroll.scrollLeft;
  }, {passive:true});
  floating.addEventListener('keydown', event => {
    const steps = {ArrowLeft:-80, ArrowRight:80, Home:-Infinity, End:Infinity};
    if (!(event.key in steps)) return;
    event.preventDefault();
    const step = steps[event.key];
    tableScroll.scrollLeft = step === -Infinity ? 0 : step === Infinity ? tableScroll.scrollWidth : tableScroll.scrollLeft + step;
    floating.scrollLeft = tableScroll.scrollLeft;
  });
  window.addEventListener('scroll', schedule, {passive:true});
  window.addEventListener('resize', schedule, {passive:true});
  window.visualViewport?.addEventListener('resize', schedule, {passive:true});
  window.visualViewport?.addEventListener('scroll', schedule, {passive:true});
  new ResizeObserver(schedule).observe(tableScroll);
  new ResizeObserver(schedule).observe(table);
  new MutationObserver(schedule).observe(document.getElementById('portal-view'), {attributes:true, attributeFilter:['hidden']});
  schedule();
})();
