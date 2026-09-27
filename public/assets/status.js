/**
 * Status page logic.
 *
 * A separate file rather than an inline script: the Content Security Policy
 * allows scripts only from this origin, and inline blocks are refused. That is
 * the point of the policy, so the page bends to it rather than the reverse.
 */
const listEl = document.getElementById('list');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

async function load() {
  try {
    const res = await fetch('/api/status', { cache: 'no-store' });
    if (!res.ok) throw new Error('bad response');
    const d = await res.json();

    document.getElementById('headline').textContent = d.ok ? 'All systems operational' : 'Something is not right';
    document.getElementById('sub').textContent = d.ok
      ? 'Transfers should be working normally.'
      : 'One or more parts are reporting a problem. Details below.';

    listEl.innerHTML = d.components.map((c) => `
      <div class="status-row">
        <span class="pip ${c.ok ? 'up' : 'down'}" aria-hidden="true"></span>
        <span class="nm">${esc(c.name)}</span>
        <span class="mut">${esc(c.note || (c.ok ? 'Operational' : 'Unavailable'))}</span>
      </div>`).join('');

    const up = d.uptimeSec;
    const pretty = up > 86400 ? `${Math.floor(up / 86400)}d ${Math.floor((up % 86400) / 3600)}h`
                 : up > 3600  ? `${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m`
                 : `${Math.floor(up / 60)}m`;
    document.getElementById('meta').textContent =
      `Version ${d.version} · running for ${pretty} · memory ${d.memoryPressure} · checked ${new Date().toLocaleTimeString()}`;
  } catch {
    document.getElementById('headline').textContent = 'Cannot reach the server';
    document.getElementById('sub').textContent =
      'This page loaded, but the status check did not answer. Transfers already in progress between two devices may still be running.';
    listEl.innerHTML = '';
  }
}

load();
setInterval(load, 20000);
