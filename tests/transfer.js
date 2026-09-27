const puppeteer=require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || require('puppeteer-core').executablePath?.() || '/usr/bin/chromium';
const BASE = process.env.KDROP_URL || 'http://localhost:3000'; const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function poll(p,fn,l,ms=45000){const t=Date.now();while(Date.now()-t<ms){const v=await p.evaluate(fn).catch(()=>null);if(v)return v;await wait(300);}throw new Error('timeout: '+l);}

async function run(breakRTC,label,mb){
  const br=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--disable-dev-shm-usage','--unsafely-treat-insecure-origin-as-secure=http://localhost:3000']});
  const A=await br.newPage(),B=await br.newPage(); const errs=[];
  for(const [n,p] of [['A',A],['B',B]]){p.on('pageerror',e=>errs.push(n+': '+e.message));
    if(breakRTC) await p.evaluateOnNewDocument(()=>{window.RTCPeerConnection=function(){throw new Error('blocked')}});}
  await A.goto(BASE,{waitUntil:'networkidle0'});
  const code=await poll(A,()=>{const e=document.getElementById('codeOut');return e&&e.dataset.empty==='0'?e.textContent.trim():null},'code');
  const pin=await A.evaluate(()=>document.getElementById('pinOut').textContent.trim());
  await B.goto(`${BASE}/#${code}${pin}`,{waitUntil:'networkidle0'});
  await B.evaluate(()=>{const o=new MutationObserver(()=>{const s=document.getElementById('ask');if(!s.hidden){o.disconnect();document.getElementById('askYes').click();}});o.observe(document.getElementById('ask'),{attributes:true});});
  const route=await poll(A,()=>{const s=document.getElementById('traceState');const t=s?s.textContent:'';return /Direct|Relayed/.test(t)?t:null},'route');
  await A.evaluate(async(N)=>{const b=new Uint8Array(N);for(let i=0;i<N;i++)b[i]=(i*29+11)&0xff;
    const dt=new DataTransfer();dt.items.add(new File([b],'check.bin'));const inp=document.getElementById('fileInput');inp.files=dt.files;inp.dispatchEvent(new Event('change',{bubbles:true}));},mb*1024*1024);
  const s=await poll(A,()=>{const r=document.querySelector('#transfers .t');return r&&r.classList.contains('done')?r.querySelector('.st').textContent:null},'send',120000);
  const r=await poll(B,()=>{const r=document.querySelector('#transfers .t');if(!r)return null;if(r.classList.contains('failed'))return 'FAILED';return r.classList.contains('done')?r.querySelector('.st').textContent:null},'recv',120000);
  if(r==='FAILED') throw new Error(label+': transfer failed');
  const chk=await B.evaluate(async(N)=>{const a=document.querySelector('#transfers .save');if(!a)return{err:'no link'};
    const v=new Uint8Array(await (await fetch(a.href)).arrayBuffer());
    if(v.length!==N)return{err:'size '+v.length};
    for(const i of [0,1,4095,65535,N-1]) if(v[i]!==((i*29+11)&0xff))return{err:'byte '+i};
    return{ok:1,size:v.length};},mb*1024*1024);
  if(chk.err) throw new Error(label+': '+chk.err);
  // text
  await A.evaluate(()=>{document.getElementById('tabText').click();document.getElementById('noteBox').value='signal over noise';document.getElementById('sendNote').click();});
  const note=await poll(B,()=>{const n=document.querySelector('#notes .received-note div');return n?n.textContent:null},'note');
  await br.close();
  console.log(`  ${label}: route=${route.trim()} | ${mb}MB verified | text=${JSON.stringify(note)} | pageerrors=${errs.length}`);
  if(errs.length) errs.forEach(e=>console.log('    '+e));
}

(async()=>{
  console.log('K-Drop test suite');
  await run(false,'direct  ',6);
  await run(true ,'relayed ',3);
  console.log('\nALL TRANSFER TESTS PASSED');
  process.exit(0);
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
