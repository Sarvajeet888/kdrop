// Requires Playwright and a running K-Drop server; see TRANSFER-FIXES.md.
const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROME_PATH||undefined,args:['--no-sandbox','--disable-gpu']});try{
const c=await b.newContext();await c.addInitScript(()=>{window.RTCPeerConnection=function(){throw Error('Force relay')};});const a=await c.newPage(),r=await c.newPage();
await r.addInitScript(()=>{window.parts=[];window.showDirectoryPicker=async()=>({getFileHandle:async()=>({createWritable:async()=>({write:async blob=>{await new Promise(r=>setTimeout(r,40));window.parts.push(blob);},close:async()=>{},abort:async()=>{}})})});});
await a.goto(process.env.KDROP_URL||'http://localhost:3000');await a.waitForFunction(()=>document.querySelector('#codeOut').dataset.empty==='0');await r.goto(await a.locator('#linkOut').inputValue());await a.waitForFunction(()=>!document.querySelector('#cardSend').classList.contains('off'));
await a.evaluate(()=>{const bytes=new Uint8Array(40*1048576);for(let i=0;i<bytes.length;i++)bytes[i]=(i*13+5)&255;const dt=new DataTransfer();dt.items.add(new File([bytes],'resume.bin'));const input=document.querySelector('#fileInput');input.files=dt.files;input.dispatchEvent(new Event('change'));});
await r.locator('#askYes').click();await r.waitForFunction(()=>window.__kdrop.state.activeRecv?.received>=2*1048576);
await a.evaluate(()=>window.__kdrop.signal.ws.close());console.log('Socket interrupted after receiver saved >2 MiB');
await a.waitForFunction(()=>document.querySelector('#transfers .t')?.matches('.done,.failed'),null,{timeout:60000});console.log('sender',await a.locator('#transfers .t').innerText());
await r.waitForFunction(()=>document.querySelector('#transfers .t')?.matches('.done,.failed'),null,{timeout:5000});
const result=await r.evaluate(async()=>{const bytes=new Uint8Array(await new Blob(window.parts).arrayBuffer());let valid=bytes.length===40*1048576;for(let i=0;i<bytes.length;i++)if(bytes[i]!==((i*13+5)&255)){valid=false;break;}return{valid,size:bytes.length,status:document.querySelector('#transfers .t').className};});console.log(result);if(!result.valid||!result.status.includes('done'))throw Error('Resume failed');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1});
