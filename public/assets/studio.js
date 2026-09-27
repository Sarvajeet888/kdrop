/* Presentation only. Pairing, encryption and transfer remain owned by app.js. */
(() => {
  const toggle = document.getElementById('motionToggle');
  let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
  try { paused = paused || localStorage.getItem('kdrop-motion-paused') === '1'; } catch {}
  function render() {
    document.body.classList.toggle('motion-paused', paused);
    toggle.setAttribute('aria-pressed', String(paused));
    toggle.textContent = paused ? 'Resume motion' : 'Pause motion';
  }
  toggle.addEventListener('click', () => {
    paused = !paused;
    try { localStorage.setItem('kdrop-motion-paused', paused ? '1' : '0'); } catch {}
    render();
  });
  render();
  ['ctaSend', 'ctaReceive'].forEach(id => {
    document.getElementById(id).addEventListener('click', () => {
      const card = document.getElementById('cardPair');
      card.classList.add('is-highlighted');
      setTimeout(() => card.classList.remove('is-highlighted'), 1500);
    });
  });
  const tabs = [...document.querySelectorAll('#tabs [role="tab"]')];
  function syncTabs() { tabs.forEach(tab => tab.tabIndex = tab.getAttribute('aria-selected') === 'true' ? 0 : -1); }
  tabs.forEach((tab, index) => tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') next = 1 - index;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next === undefined || document.getElementById('cardSend').classList.contains('off')) return;
    event.preventDefault(); tabs[next].click(); tabs[next].focus();
  }));
  new MutationObserver(syncTabs).observe(document.getElementById('tabs'), {subtree:true, attributes:true, attributeFilter:['aria-selected']});
  syncTabs();
})();
