#!/usr/bin/env node
/**
 * Leaving the app and coming back.
 *
 * A phone suspends a background tab within seconds, which freezes the send
 * loop and usually drops the connection. Returning must pick the transfer up
 * rather than leaving it stalled on a frozen progress bar.
 *
 * What this does NOT test, because it is not possible: closing the tab. The
 * page and everything in it stop existing, and no web API survives that.
 */
'use strict';
const puppeteer = require('puppeteer-core');
const BASE = process.env.KDROP_URL || 'http://localhost:3000';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
process.env.CHROME_PATH = process.env.CHROME_PATH || '/usr/bin/chromium';

async function poll(p, fn, l, ms = 120000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await p.evaluate(fn).catch(() => null);
    if (v) return v;
    await wait(200);
  }
  throw new Error('timed out: ' + l);
}

(async()=>{
  const br=await puppeteer.launch({executablePath:process.env.CHROME_PATH,headless:'new',
    args:['--no-sandbox','--disable-dev-shm-usage','--unsafely-treat-insecure-origin-as-secure='+BASE]});
  const a=await br.newPage(),b=await br.newPage();
  a.on('pageerror',e=>console.log('[A]',e.message));
  await a.goto(BASE,{waitUntil:'networkidle0'});
  const code=await poll(a,()=>{const e=document.getElementById('codeOut');return e&&e.dataset.empty==='0'?e.textContent.trim():null},'code');
  const pin=await a.evaluate(()=>document.getElementById('pinOut').textContent.trim());
  await b.goto(`${BASE}/#${code}${pin}`,{waitUntil:'networkidle0'});
  await b.evaluate(()=>{const o=new MutationObserver(()=>{const s=document.getElementById('ask');if(!s.hidden){o.disconnect();document.getElementById('askYes').click();}});o.observe(document.getElementById('ask'),{attributes:true});});
  await poll(a,()=>/Direct|Relayed/.test(document.getElementById('traceState').textContent)?1:null,'link');

  const N=12*1024*1024;
  await a.evaluate(async(n)=>{const buf=new Uint8Array(n);for(let i=0;i<n;i+=512)buf[i]=i&255;
    const dt=new DataTransfer();dt.items.add(new File([buf],'bg.bin'));
    const i2=document.getElementById('fileInput');i2.files=dt.files;i2.dispatchEvent(new Event('change',{bubbles:true}));},N);
  await poll(a,()=>{const st=document.querySelector('#transfers .t .st');const m=st&&st.textContent.match(/([\d.]+)\s*MB of/);return m&&parseFloat(m[1])>2?1:null},'partial');
  console.log('  partway through, backgrounding the tab');

  // Simulate leaving: hide the page and kill the connection the way a phone does
  await a.evaluate(()=>{Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});
    document.dispatchEvent(new Event('visibilitychange'));
    const {state,signal}=window.__kdrop;
    for(const l of state.links.values()){try{l.dc&&l.dc.close()}catch{} try{l.pc&&l.pc.close()}catch{}}
    try{signal.ws.close()}catch{}});
  await wait(3000);

  console.log('  returning to the app');
  await a.evaluate(()=>{Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});
    document.dispatchEvent(new Event('visibilitychange'));});

  const res=await poll(a,()=>{const r=document.querySelector('#transfers .t');if(!r)return null;
    if(r.classList.contains('done'))return 'completed';
    if(r.classList.contains('failed'))return 'FAILED: '+r.querySelector('.st').textContent;return null},'recovery',150000);
  console.log('  result:',res);
  if(res!=='completed'){await br.close();process.exit(1);}

  await poll(b,()=>document.querySelector('#transfers .t.done')?1:null,'receiver',60000);
  const chk=await b.evaluate(async(n)=>{const l=document.querySelector('#transfers .save');if(!l)return{err:'no file'};
    const v=new Uint8Array(await(await fetch(l.href)).arrayBuffer());
    if(v.length!==n)return{err:'size '+v.length};
    for(let i=0;i<n;i+=512)if(v[i]!==(i&255))return{err:'byte '+i};return{ok:1};},N);
  console.log('  bytes verified:',chk.ok?'yes':'NO — '+chk.err);
  await br.close();
  process.exit(chk.ok?0:1);
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
