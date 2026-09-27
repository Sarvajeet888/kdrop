const puppeteer=require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || require('puppeteer-core').executablePath?.() || '/usr/bin/chromium';
const BASE = process.env.KDROP_URL || 'http://localhost:3000'; const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function poll(p,fn,l,ms=60000){const t=Date.now();while(Date.now()-t<ms){const v=await p.evaluate(fn).catch(()=>null);if(v)return v;await wait(200);}throw new Error('timeout '+l);}
const MB=8;

(async()=>{
  const br=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--disable-dev-shm-usage','--unsafely-treat-insecure-origin-as-secure=http://localhost:3000']});
  const A=await br.newPage(),B=await br.newPage(); const errs=[];
  for(const [n,p] of [['A',A],['B',B]]){ p.on('pageerror',e=>errs.push(n+': '+e.message));
    p.on('console',m=>{const x=m.text(); if(/kdrop|resume|mismatch/i.test(x)) console.log('  ['+n+']',x);}); }

  await A.goto(BASE,{waitUntil:'networkidle0'});
  const code=await poll(A,()=>{const e=document.getElementById('codeOut');return e&&e.dataset.empty==='0'?e.textContent.trim():null},'code');
  const pin=await A.evaluate(()=>document.getElementById('pinOut').textContent.trim());
  await B.goto(`${BASE}/#${code}${pin}`,{waitUntil:'networkidle0'});
  await B.evaluate(()=>{const o=new MutationObserver(()=>{const s=document.getElementById('ask');if(!s.hidden){o.disconnect();document.getElementById('askYes').click();}});o.observe(document.getElementById('ask'),{attributes:true});});
  await poll(A,()=>/Direct|Relayed/.test(document.getElementById('traceState').textContent)?1:null,'link');
  console.log('  paired, link up');

  // Track resume events on the sender
  await A.evaluate(()=>{window.__ev=[];});

  await A.evaluate(async(N)=>{
    const b=new Uint8Array(N); for(let i=0;i<N;i++) b[i]=(i*13+5)&0xff;
    const dt=new DataTransfer(); dt.items.add(new File([b],'big.bin'));
    const i=document.getElementById('fileInput'); i.files=dt.files;
    i.dispatchEvent(new Event('change',{bubbles:true}));
  }, MB*1024*1024);

  // wait until part-way through
  const mid = await poll(A,()=>{
    const st=document.querySelector('#transfers .t .st');
    if(!st) return null;
    const m=st.textContent.match(/([\d.]+)\s*MB of/);
    return m && parseFloat(m[1])>1.5 ? st.textContent : null;
  },'partial',60000);
  console.log('  interrupting at:',mid);

  // Kill the data channel AND the signalling socket on the sender — a real drop.
  await A.evaluate(()=>{
    for(const l of window.__kdropLinks||[]) {}
  });
  const killed = await A.evaluate(()=>{
    // reach into the module via the exposed debug hook
    if(!window.__kdrop) return 'no hook';
    const {state,signal}=window.__kdrop;
    for(const l of state.links.values()){ try{l.dc&&l.dc.close();}catch{} try{l.pc&&l.pc.close();}catch{} }
    try{ signal.ws.close(); }catch{}
    return 'killed';
  });
  console.log('  connection dropped:',killed);

  // it must come back on its own and finish
  const done = await poll(A,()=>{
    const r=document.querySelector('#transfers .t');
    if(!r) return null;
    if(r.classList.contains('failed')) return 'FAILED: '+r.querySelector('.st').textContent;
    return r.classList.contains('done')?'done':null;
  },'recovery',120000);
  console.log('  sender after drop:',done);
  if(done!=='done') throw new Error(done);

  const diag = await B.evaluate(()=>{
    const r=document.querySelector('#transfers .t');
    return { st: r?r.querySelector('.st').textContent:'no row',
             cls: r?r.className:'-',
             recv: window.__kdrop && window.__kdrop.state.activeRecv ?
               {got: window.__kdrop.state.activeRecv.current?window.__kdrop.state.activeRecv.current.got:null,
                received: window.__kdrop.state.activeRecv.received,
                total: window.__kdrop.state.activeRecv.total} : 'none' };
  });
  console.log('  receiver diag:',JSON.stringify(diag));

  const rdone = await poll(B,()=>{
    const r=document.querySelector('#transfers .t');
    if(!r) return null;
    if(r.classList.contains('failed')) return 'FAILED';
    return r.classList.contains('done')?'done':null;
  },'receiver',60000);
  console.log('  receiver:',rdone);

  const chk = await B.evaluate(async(N)=>{
    const a=document.querySelector('#transfers .save'); if(!a) return {err:'no save link'};
    const v=new Uint8Array(await (await fetch(a.href)).arrayBuffer());
    if(v.length!==N) return {err:'size '+v.length+' expected '+N};
    for(let i=0;i<v.length;i+=997) if(v[i]!==((i*13+5)&0xff)) return {err:'byte '+i};
    if(v[N-1]!==(((N-1)*13+5)&0xff)) return {err:'last byte'};
    return {ok:1,size:v.length};
  }, MB*1024*1024);
  if(chk.err) throw new Error('AFTER RESUME, DATA CORRUPT: '+chk.err);
  console.log('  bytes verified after resume:',chk.size,'(every 997th + last)');

  await br.close();
  if(errs.length) errs.forEach(e=>console.log('  err: '+e));
  console.log('\n  RESUME TEST PASSED');
  process.exit(0);
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
