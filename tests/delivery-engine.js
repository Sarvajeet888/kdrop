// Built-in Node test: node tests/delivery-engine.js (Node 18+).
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {File}=require('node:buffer');
const {webcrypto}=require('node:crypto');
if(!globalThis.crypto)globalThis.crypto=webcrypto;
if(!globalThis.CustomEvent)globalThis.CustomEvent=class extends Event{constructor(t,o){super(t);this.detail=o.detail}};
globalThis.window=globalThis;
const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
async function engine(){const root=path.join(__dirname,'../public/assets');const filename=url(fs.readFileSync(path.join(root,'filename.js'),'utf8'));return import(url(fs.readFileSync(path.join(root,'core.js'),'utf8').replace("'./filename.js'",JSON.stringify(filename))));}
(async()=>{
 const {Link,Sender,Receiver}=await engine();
 // Exercise the real direct transport handlers with asynchronous, ordered delivery.
 for(const diskFailure of [false,true]){
  const a=new Link({send:()=>true},'receiver'),b=new Link({send:()=>true},'sender');
  for(const l of[a,b]){l.mode='direct';l.pc={sctp:{maxMessageSize:65536}};}
  const channel=target=>({readyState:'open',bufferedAmount:0,send:data=>queueMicrotask(()=>target.incoming(typeof data==='string'?data:data.slice().buffer))});
  a.dc=channel(b);b.dc=channel(a);
  const bytes=new Uint8Array(12*1048576);for(let i=0;i<bytes.length;i++)bytes[i]=i&255;
  const sender=new Sender(a,[new File([bytes],'direct.bin'),new File([],'empty.bin')]);sender.receiptTimeout=2000;
  const receiver=new Receiver(b,{bid:sender.bid,files:sender.manifest(),total:bytes.length,receipts:1});
  let active=0,max=0,writes=0,closed=false;const chunks=[];
  receiver.dirHandle={getFileHandle:async()=>({createWritable:async()=>({
   write:async blob=>{max=Math.max(max,++active);await new Promise(r=>setTimeout(r,2));if(diskFailure)throw Error('Disk full');chunks.push(await blob.arrayBuffer());writes++;active--;},
   close:async()=>{assert.equal(active,0);closed=true;},abort:async()=>{}
  })})};
  a.on('ctl',({msg})=>sender.onReceipt(msg));b.on('ctl',({msg,hold})=>hold(receiver.onControl(msg)));b.on('bytes',({buf,hold})=>hold(receiver.onBytes(buf)));
  const events=[];sender.on('done',()=>{assert(closed);events.push('done')});sender.on('failed',()=>events.push('failed'));receiver.begin();await sender.run();
  if(diskFailure){assert.deepEqual(events,['failed']);assert(!closed);}else{assert.deepEqual(events,['done']);assert.equal(max,1);assert.equal(writes,12);assert.equal(receiver.results.length,2);assert.deepEqual(new Uint8Array(await new Blob(chunks).arrayBuffer()),bytes);}
  console.log('Direct transport simulation, '+(diskFailure?'disk failure':'12 MiB exact bytes, serialized writes, confirmed close')+': PASS');
 }
 // Missing confirmation must never become success.
 const sender=new Sender({send:()=>true,sendBytes:()=>{},drain:()=>{},chunkSize:65536,mode:'direct'},[new File(['abc'],'x')]);sender.receiptTimeout=30;
 let done=false,failed=false;sender.on('done',()=>done=true);sender.on('failed',()=>failed=true);await sender.run();assert(failed&&!done);console.log('Missing receiver receipt: PASS');
 // Closing a blocked data channel must reject its wait rather than enqueue more bytes.
 const link=new Link({send:()=>true},'peer');link.mode='direct';link.dc=new EventTarget();link.dc.readyState='open';link.dc.bufferedAmount=5*1048576;
 const pending=link.drain();link.dc.readyState='closed';await assert.rejects(pending,/closed/);console.log('Closed channel backpressure: PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
