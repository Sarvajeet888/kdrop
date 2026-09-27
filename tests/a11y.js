const puppeteer=require('puppeteer-core');
const CHROME = process.env.CHROME_PATH || require('puppeteer-core').executablePath?.() || '/usr/bin/chromium';
const BASE = process.env.KDROP_URL || 'http://localhost:3000'; const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const br=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--no-sandbox','--disable-dev-shm-usage','--unsafely-treat-insecure-origin-as-secure=http://localhost:3000']});
  const p=await br.newPage(); const errs=[];
  p.on('pageerror',e=>errs.push(e.message));
  await p.goto(BASE,{waitUntil:'networkidle0'}); await wait(2000);

  const a=await p.evaluate(()=>{
    const noAlt=[...document.querySelectorAll('img')].filter(i=>!i.alt).length;
    const btnNoName=[...document.querySelectorAll('button')].filter(b=>!b.textContent.trim()&&!b.getAttribute('aria-label')).length;
    const inpNoLabel=[...document.querySelectorAll('input:not([type=hidden]):not([type=file]),select,textarea')]
      .filter(i=>!i.getAttribute('aria-label')&&!i.labels?.length&&!i.placeholder).length;
    const h=[...document.querySelectorAll('h1,h2,h3')].map(x=>+x.tagName[1]);
    let jumps=0; for(let i=1;i<h.length;i++) if(h[i]-h[i-1]>1) jumps++;
    return {noAlt,btnNoName,inpNoLabel,h1:document.querySelectorAll('h1').length,jumps,
      lang:document.documentElement.lang, canvasLabel:!!document.getElementById('trace').getAttribute('aria-label')};
  });
  console.log('  images without alt   :',a.noAlt);
  console.log('  buttons without name :',a.btnNoName);
  console.log('  inputs without label :',a.inpNoLabel);
  console.log('  h1 count / heading jumps:',a.h1,'/',a.jumps);
  console.log('  lang set / canvas labelled:',a.lang,'/',a.canvasLabel);

  // touch targets
  const small=await p.evaluate(()=>[...document.querySelectorAll('button,a.btn,.tabs button')]
    .map(e=>e.getBoundingClientRect()).filter(r=>r.width>0&&(r.height<40)).length);
  console.log('  interactive < 40px tall:',small);

  // keyboard: tab reaches the primary action
  await p.keyboard.press('Tab'); await p.keyboard.press('Tab');
  const focused=await p.evaluate(()=>document.activeElement.tagName+':'+(document.activeElement.textContent||'').trim().slice(0,20));
  console.log('  keyboard focus lands on:',focused);

  // focus trap in the dialog
  const trap=await p.evaluate(async()=>{
    const sheet=document.getElementById('ask'); sheet.hidden=false;
    document.getElementById('askYes').focus();
    const before=document.activeElement.id;
    return {opened:!sheet.hidden, first:before};
  });
  console.log('  dialog focus starts at:',trap.first);
  await p.evaluate(()=>{document.getElementById('ask').hidden=true;});

  // reduced motion honoured
  await p.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  await p.reload({waitUntil:'networkidle0'}); await wait(1500);
  const rm=await p.evaluate(()=>window.__kdrop&&window.__kdrop.trace?window.__kdrop.trace.reduced:'n/a');
  console.log('  trace honours reduced motion:',rm);

  // contrast of key colours
  const c=await p.evaluate(()=>{
    const lum=(hex)=>{const n=parseInt(hex.slice(1),16),r=[(n>>16&255)/255,(n>>8&255)/255,(n&255)/255]
      .map(v=>v<=.03928?v/12.92:((v+.055)/1.055)**2.4);return .2126*r[0]+.7152*r[1]+.0722*r[2];};
    const ratio=(a,b)=>{const l1=lum(a),l2=lum(b);return ((Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)).toFixed(2);};
    const cs=getComputedStyle(document.documentElement);
    const v=(n)=>cs.getPropertyValue(n).trim();
    return {graphiteOnBone:ratio(v('--graphite'),v('--bone')),
            ironTextOnBone:ratio(v('--iron-text'),v('--bone')),
            vermTextOnBone:ratio(v('--vermillion-text'),v('--bone')),
            boneOnGraphite:ratio(v('--bone'),v('--graphite'))};
  });
  const pass=(x)=>parseFloat(x)>=4.5?'PASS':'FAIL';
  console.log('  contrast graphite/bone :',c.graphiteOnBone,pass(c.graphiteOnBone));
  console.log('  contrast iron-text/bone:',c.ironTextOnBone,pass(c.ironTextOnBone));
  console.log('  contrast verm-text/bone:',c.vermTextOnBone,pass(c.vermTextOnBone));
  console.log('  contrast bone/graphite :',c.boneOnGraphite,pass(c.boneOnGraphite));

  await br.close();
  if(errs.length) errs.forEach(e=>console.log('  err:',e));
  console.log('\n  A11Y CHECKS DONE');
  process.exit(0);
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
