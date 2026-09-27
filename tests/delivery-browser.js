// Optional: npm install --no-save playwright; npx playwright install chromium
// Start npm start, then node tests/delivery-browser.js. CHROME_PATH is optional.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const BASE=process.env.KDROP_URL||'http://localhost:3000';
(async()=>{
const b=await chromium.launch({executablePath:process.env.CHROME_PATH||undefined,args:['--no-sandbox','--disable-gpu','--allow-loopback-in-peer-connection','--disable-features=WebRtcHideLocalIpsWithMdns']});
try {
for(const s of [
 {name:'direct-memory',mb:16},{name:'relay-memory',relay:true,mb:16},
 {name:'direct-slow-disk',disk:true,mb:40},{name:'relay-slow-disk',relay:true,disk:true,mb:40},
 {name:'relay-disk-full',relay:true,disk:true,failure:'write',mb:40},
 {name:'relay-close-failure',relay:true,disk:true,failure:'close',mb:40}]) {
 const c=await b.newContext(),errors=[];
 if(s.relay)await c.addInitScript(()=>{window.RTCPeerConnection=function(){throw Error('Force relay')};});
 await c.route('**/api/config',route=>route.fulfill({json:{iceServers:[]}}));
 const a=await c.newPage(),r=await c.newPage();for(const p of[a,r])p.on('pageerror',e=>errors.push(e.message));
 if(s.disk)await r.addInitScript(({failure})=>{
  window.disk={parts:[],writes:0,active:0,maxActive:0,closed:false,earlyClose:false};
  window.showDirectoryPicker=async()=>({getFileHandle:async()=>({createWritable:async()=>({
   write:async data=>{const d=window.disk;d.maxActive=Math.max(d.maxActive,++d.active);await new Promise(r=>setTimeout(r,8));if(failure==='write')throw Error('Disk full');d.parts.push(data);d.writes++;d.active--;},
   close:async()=>{if(failure==='close')throw Error('Close failed');window.disk.earlyClose=window.disk.active>0;window.disk.closed=true;},abort:async()=>{}
  })})});
 },s);
 await a.goto(BASE);await a.waitForFunction(()=>document.querySelector('#codeOut').dataset.empty==='0');
 await r.goto(await a.locator('#linkOut').inputValue());await a.waitForFunction(()=>!document.querySelector('#cardSend').classList.contains('off'));
 const actual=await a.evaluate(()=>[...window.__kdrop.state.links.values()][0].mode);
 if(!s.relay && actual!=='direct'){console.log(s.name+': SKIP — environment could not establish WebRTC; fallback is '+actual);await c.close();continue;}
 const data=Buffer.alloc(s.mb*1048576);for(let i=0;i<data.length;i++)data[i]=(i*29+11)&255;
 const start=Date.now();await a.locator('#fileInput').setInputFiles({name:'delivery.bin',mimeType:'application/octet-stream',buffer:data});await r.locator('#askYes').click();
 if(s.failure){
  await a.locator('#transfers .t.failed').waitFor({timeout:45000});await r.locator('#transfers .t.failed').waitFor();
  assert.equal(await a.locator('#transfers .t.done').count(),0);assert.equal(await r.locator('#transfers .save').count(),0);
  console.log(s.name+': PASS, both devices report failure');
 }else{
  await a.locator('#transfers .t.done').waitFor({timeout:60000});await r.locator('#transfers .t.done').waitFor();
  const result=await r.evaluate(async({disk})=>{
   const blob=disk?new Blob(window.disk.parts):await(await fetch(document.querySelector('#transfers .save').href)).blob();
   const bytes=new Uint8Array(await blob.arrayBuffer());let valid=true;for(let i=0;i<bytes.length;i++)if(bytes[i]!==((i*29+11)&255)){valid=false;break;}
   return{valid,size:bytes.length,disk:disk?{writes:window.disk.writes,maxActive:window.disk.maxActive,closed:window.disk.closed,earlyClose:window.disk.earlyClose}:null};
  },s);
  assert(result.valid);assert.equal(result.size,data.length);if(result.disk){assert.equal(result.disk.maxActive,1);assert(result.disk.closed);assert(!result.disk.earlyClose);assert(result.disk.writes<=s.mb+1);}
  console.log(s.name+': PASS, exact bytes verified, '+((Date.now()-start)/1000).toFixed(2)+'s incl. UI/validation, '+JSON.stringify(result.disk));
 }
 assert.deepEqual(errors,[]);await c.close();
}
const p=await b.newPage();await p.goto(BASE);
const regression=await p.evaluate(async()=>{
 const {Sender,Link}=await import('/assets/core.js');const fake={send:()=>true,sendBytes:()=>{},drain:()=>{},chunkSize:65536,mode:'direct'};
 const sender=new Sender(fake,[new File(['hello'],'test.txt')]);sender.receiptTimeout=100;const events=[];sender.on('done',()=>events.push('done'));sender.on('failed',()=>events.push('failed'));await sender.run();
 const link=new Link({send:()=>true},'peer');link.mode='direct';link.pc={sctp:{maxMessageSize:8192}};return{events,smallFrame:link.chunkSize};
});assert.deepEqual(regression.events,['failed']);assert.equal(regression.smallFrame,8192);console.log('Missing delivery confirmation and small frame limit: PASS');
}finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
