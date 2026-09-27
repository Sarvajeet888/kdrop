const puppeteer=require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || require('puppeteer-core').executablePath?.() || '/usr/bin/chromium';
const BASE = process.env.KDROP_URL || 'http://localhost:3000'; const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function poll(p,fn,l,ms=25000){const t=Date.now();while(Date.now()-t<ms){const v=await p.evaluate(fn).catch(()=>null);if(v)return v;await wait(250);}throw new Error('timeout '+l);}
(async()=>{
  const br=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--disable-dev-shm-usage','--unsafely-treat-insecure-origin-as-secure=http://localhost:3000']});
  const errs=[];

  // --- i18n: Hindi
  const H=await br.newPage(); H.on('pageerror',e=>errs.push('hi: '+e.message));
  await H.goto(BASE+'?lang=hi',{waitUntil:'networkidle0'}); await wait(1200);
  const hi=await H.evaluate(()=>({h1:document.querySelector('h1').textContent,lang:document.documentElement.lang,btn:document.getElementById('ctaSend').textContent}));
  console.log('  hindi h1     :',hi.h1);
  console.log('  hindi lang   :',hi.lang,'| cta:',hi.btn);

  // --- language switch persists
  await H.evaluate(()=>{const s=document.getElementById('langSelect');s.value='en';s.dispatchEvent(new Event('change'))});
  await wait(400);
  const back=await H.evaluate(()=>document.querySelector('h1').textContent);
  const saved=await H.evaluate(()=>localStorage.getItem('kdrop.lang'));
  console.log('  switch to en :',back,'| saved:',saved);

  // --- device detection
  const dev=await H.evaluate(()=>document.body.dataset.device);
  console.log('  device class :',dev);
  const P=await br.newPage();
  await P.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
  await P.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
  await P.goto(BASE,{waitUntil:'networkidle0'}); await wait(1200);
  const pd=await P.evaluate(()=>({d:document.body.dataset.device,t:document.getElementById('pairTitle').textContent}));
  console.log('  as iPhone    :',pd.d,'|',JSON.stringify(pd.t));

  // --- SEO pages
  const S=await br.newPage();
  await S.goto(BASE+'/iphone-to-windows.html',{waitUntil:'networkidle0'});
  const seo=await S.evaluate(()=>({t:document.title,h1:document.querySelector('h1').textContent,
    faq:!!document.querySelector('script[type="application/ld+json"]'),
    canon:document.querySelector('link[rel=canonical]').getAttribute('href'),
    steps:document.querySelectorAll('ol li').length, links:document.querySelectorAll('.routes a').length}));
  console.log('  seo page     :',JSON.stringify(seo.h1),'| steps:',seo.steps,'| schema:',seo.faq,'| crosslinks:',seo.links);

  // check the 8 pages differ
  const titles=[];
  for(const s of ['phone-to-pc','pc-to-phone','android-to-pc','iphone-to-pc','iphone-to-windows','mac-to-android','pc-to-pc','send-large-files']){
    await S.goto(`${BASE}/${s}.html`,{waitUntil:'domcontentloaded'});
    titles.push(await S.evaluate(()=>document.querySelector('.lede').textContent.slice(0,40)));
  }
  console.log('  unique ledes :',new Set(titles).size,'of',titles.length);

  // --- transfer history
  const A=await br.newPage(),B=await br.newPage();
  A.on('pageerror',e=>errs.push('A: '+e.message));
  await A.goto(BASE,{waitUntil:'networkidle0'});
  const code=await poll(A,()=>{const e=document.getElementById('codeOut');return e&&e.dataset.empty==='0'?e.textContent.trim():null},'code');
  const pin=await A.evaluate(()=>document.getElementById('pinOut').textContent.trim());
  await B.goto(`${BASE}/#${code}${pin}`,{waitUntil:'networkidle0'});
  await B.evaluate(()=>{const o=new MutationObserver(()=>{const s=document.getElementById('ask');if(!s.hidden){o.disconnect();document.getElementById('askYes').click();}});o.observe(document.getElementById('ask'),{attributes:true});});
  await poll(A,()=>document.getElementById('traceState').textContent.match(/Direct|Relayed/)?1:null,'link');
  await A.evaluate(()=>{const b=new Uint8Array(200000).fill(7);const dt=new DataTransfer();
    dt.items.add(new File([b],'holiday-photo.jpg'));const i=document.getElementById('fileInput');i.files=dt.files;i.dispatchEvent(new Event('change',{bubbles:true}));});
  await poll(A,()=>document.querySelector('#transfers .t.done')?1:null,'sent',60000);
  await wait(600);
  const hist=await A.evaluate(()=>({shown:!document.getElementById('cardHistory').hidden,
     rows:document.querySelectorAll('.hist-row').length,
     txt:(document.querySelector('.hist-row .nm')||{}).textContent,
     stored:JSON.parse(localStorage.getItem('kdrop.history.v1')||'[]').length}));
  console.log('  history      : shown='+hist.shown,'rows='+hist.rows,'first='+JSON.stringify(hist.txt),'stored='+hist.stored);
  const recvHist=await B.evaluate(()=>JSON.parse(localStorage.getItem('kdrop.history.v1')||'[]').map(e=>e.dir));
  console.log('  receiver hist:',JSON.stringify(recvHist));

  // clear
  await A.evaluate(()=>document.getElementById('clearHistory').click()); await wait(300);
  console.log('  after clear  :',await A.evaluate(()=>localStorage.getItem('kdrop.history.v1')));

  // --- PWA manifest
  const m=await (await fetch(BASE+'/manifest.webmanifest')).json();
  console.log('  manifest     :',m.short_name,'| icons:',m.icons.length,'| display:',m.display);

  await br.close();
  if(errs.length){console.log('\nERRORS:');errs.forEach(e=>console.log('  '+e));}
  console.log(errs.length?'\nFEATURES OK WITH ERRORS':'\nALL FEATURE TESTS PASSED');
  process.exit(errs.length?2:0);
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
