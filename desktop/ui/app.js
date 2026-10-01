'use strict';
const $ = id => document.getElementById(id);
let folder = '', file = '', busy = false;
const setBusy = value => { busy = value; for (const id of ['receive','send','folder','file']) $(id).disabled = value; };
const status = message => { $('status').textContent = message; };
async function command(name, args) {
  try { return await window.__TAURI__.core.invoke(name, args); }
  catch (error) { status(String(error)); throw error; }
}
function wire(id, action) { $(id).onclick = () => Promise.resolve().then(action).catch(() => {}); }
if (!window.__TAURI__) {
  status('Open this interface in the KDrop desktop application. Browser preview cannot transfer files.');
  setBusy(true); $('stop').disabled = true;
} else {
  wire('folder', async () => { const p = await command('choose', {folder:true}); if(p){folder=p;$('destination').textContent=p;} });
  wire('file', async () => { const p = await command('choose', {folder:false}); if(p){file=p;$('filename').textContent=p;} });
  wire('receive', async () => {
    if (!folder) return status('Choose a destination folder first.');
    setBusy(true); try { await command('receive', {directory:folder,address:$('address').value.trim()}); status('Starting local receiver…'); }
    catch { setBusy(false); }
  });
  wire('send', async () => {
    if (!file) return status('Choose a file first.');
    setBusy(true); try { await command('send', {pairing:$('peer').value.trim(),path:file}); }
    catch { setBusy(false); }
  });
  wire('stop', () => { status('Stopping…'); return command('cancel'); });
  for(const [id,accepted] of [['yes',true],['no',false]]) wire(id, async () => {
    $('approval').hidden=true; await command('approve',{accepted});
  });
  window.__TAURI__.event.listen('transfer', ({payload:p}) => {
    if(p.type==='pairing') {
      $('code').value=p.uri; $('qr').src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(p.qr);
      $('pairing').hidden=false;status('Waiting for a sender. Keep this window open.');
    }
    if(p.type==='offer') { $('offer').textContent=`Receive ${p.name} (${(p.size/1048576).toFixed(1)} MiB)?`; $('approval').hidden=false; }
    if(p.type==='progress') { const s=p.progress; $('approval').hidden=true; $('progress').value=s.total?s.received/s.total*100:100;
      $('speed').textContent=`${(s.bytes_per_second/1048576).toFixed(1)} MiB/s received · Direct TLS`;
      $('explanation').textContent=s.note;status(`${s.received.toLocaleString()} of ${s.total.toLocaleString()} bytes received`); }
    if(p.type==='complete') { $('approval').hidden=true; $('progress').value=100;status(`Verified and saved: ${p.path}`); }
    if(p.type==='error') { $('approval').hidden=true;status(p.message); }
    if(p.type==='status') status(p.message);
    if(p.type==='idle') { setBusy(false);$('approval').hidden=true;$('pairing').hidden=true;$('code').value='';$('qr').removeAttribute('src');if(p.error)status(p.error); }
  }).catch(error=>status(String(error)));
}
