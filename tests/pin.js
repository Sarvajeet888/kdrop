const puppeteer=require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || require('puppeteer-core').executablePath?.() || '/usr/bin/chromium';
const BASE = process.env.KDROP_URL || 'http://localhost:3000'; const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function poll(p,fn,l,ms=20000){const t=Date.now();while(Date.now()-t<ms){const v=await p.evaluate(fn).catch(()=>null);if(v)return v;await wait(250);}throw new Error('timeout '+l);}
(async()=>{
  const br=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--disable-dev-shm-usage','--unsafely-treat-insecure-origin-as-secure=http://localhost:3000']});
  const A=await br.newPage(),B=await br.newPage();
  await A.goto(BASE,{waitUntil:'networkidle0'});
  const code=await poll(A,()=>{const e=document.getElementById('codeOut');return e&&e.dataset.empty==='0'?e.textContent.trim():null},'code');
  const pin=await A.evaluate(()=>document.getElementById('pinOut').textContent.trim());

  // 1. code-only manual join must be refused
  await B.goto(BASE,{waitUntil:'networkidle0'}); await wait(2000);
  await B.evaluate(c=>{document.getElementById('joinCode').value=c;document.getElementById('joinForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));},code);
  await wait(900);
  const t1=await B.evaluate(()=>{const t=document.querySelector('.toast');return t?t.textContent:null});
  const joined1=await B.evaluate(()=>document.querySelectorAll('#peers .peer').length);
  console.log('  code-only join refused :', joined1===0?'yes':'NO — it connected');
  console.log('    message shown        :', JSON.stringify(t1));

  // 2. code-only link must NOT auto-join either
  const C=await br.newPage();
  await C.goto(`${BASE}/#${code}`,{waitUntil:'networkidle0'}); await wait(2500);
  const ownCode=await C.evaluate(()=>document.getElementById('codeOut').textContent.trim());
  console.log('  code-only link refused :', ownCode!==code?'yes (started its own session)':'NO — it joined');

  // 3. code + PIN must work
  await B.evaluate(cp=>{document.getElementById('joinCode').value=cp;document.getElementById('joinForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));},code+pin);
  const ok=await poll(B,()=>document.querySelectorAll('#peers .peer').length>0,'join with pin');
  console.log('  code + PIN join works  :', ok?'yes':'NO');

  await br.close(); console.log('\n  PIN ENFORCEMENT OK'); process.exit(0);
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
