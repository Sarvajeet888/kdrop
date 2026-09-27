const WebSocket = require('/home/claude/kdrop/node_modules/ws');
const BASE = (process.env.KDROP_URL || 'ws://localhost:3000/ws').replace(/^http/, 'ws');
const U = BASE.endsWith('/ws') ? BASE : BASE.replace(/\/$/, '') + '/ws';
const HTTP = U.replace(/^ws/, 'http').replace(/\/ws$/, '');
function mk(){return new Promise(r=>{const w=new WebSocket(U);w.q=[];w.w=[];
  w.on('message',(d,bin)=>{ if(bin){w.q.push({t:'__bin',d});} else {try{w.q.push(JSON.parse(d))}catch{}} pump(w);});
  w.on('open',()=>r(w)); w.on('error',()=>{});});}
function pump(w){for(let i=0;i<w.w.length;i++){const {t,res}=w.w[i];const j=w.q.findIndex(m=>m.t===t);
  if(j>=0){const m=w.q.splice(j,1)[0];w.w.splice(i,1);res(m);return pump(w);}}}
function on(w,t,ms=4000){return new Promise((res,rej)=>{w.w.push({t,res});pump(w);setTimeout(()=>rej(new Error('timeout '+t)),ms);});}
const s=(w,o)=>w.send(JSON.stringify(o));

(async()=>{
  console.log('K-Drop hardening checks\n');

  // 1. security headers
  const r = await fetch(HTTP+'/');
  const need=['content-security-policy','x-content-type-options','x-frame-options','referrer-policy','permissions-policy'];
  const missing=need.filter(h=>!r.headers.get(h));
  console.log('  security headers:', missing.length? 'MISSING '+missing.join(','):'all present');
  console.log('  x-powered-by hidden:', r.headers.get('x-powered-by')?'NO':'yes');

  // 2. QR generation is client-side so the pairing PIN never needs to be
  // submitted to a rendering endpoint. The old endpoint must stay absent.
  const qr = await fetch(HTTP+'/api/qr?d=' + encodeURIComponent(HTTP+'/#ABC123WXYZ'));
  console.log('  server QR endpoint absent:', qr.status===404?'yes':'NO ('+qr.status+')');

  // 3. health payload
  const h = await (await fetch(HTTP+'/api/health')).json();
  console.log('  health fields:', Object.keys(h).join(','));

  // 5. relay byte ceiling (MAX_RELAY_BYTES=100000 for this run)
  const a=await mk(), b=await mk(); await on(a,'hello'); await on(b,'hello');
  s(a,{t:'create'});
  const room=await Promise.race([on(a,'room',3000), on(a,'error',3000).then(e=>{throw new Error('create refused: '+e.reason)})]);
  s(b,{t:'join',code:room.code}); const j=await on(b,'joined'); const pj=await on(a,'peer-joined');
  s(a,{t:'relay-open',to:pj.peer.id}); await on(a,'relay-ready');
  const hit = on(a,'relay-limit',6000).then(m=>m).catch(()=>null);
  for(let i=0;i<40;i++){ a.send(Buffer.alloc(8192)); await new Promise(r=>setTimeout(r,15)); }
  const lim = await hit;
  console.log('  relay ceiling enforced:', lim?`yes (at ${lim.limit} bytes)`:'NO');

  // 6. socket cap (MAX_SOCKETS_PER_IP=4 for this run)
  const held=[]; let refused=false;
  for(let i=0;i<8;i++){ const c=await mk();
    const e=await on(c,'error',600).catch(()=>null);
    if(e&&e.reason==='too-many'){refused=true;break;} held.push(c); }
  console.log(`  socket cap: held ${held.length} then ${refused?'refused':'NOT REFUSED'}`);

  // 4. room rate limit — last, because it deliberately exhausts a quota.
  // Release the sockets held above first, or the socket cap blocks this.
  held.forEach(x=>{try{x.close()}catch{}}); held.length=0;
  try{a.close()}catch{} try{b.close()}catch{}
  await new Promise(r=>setTimeout(r,400));

  const w=await mk(); await on(w,'hello');
  let made=0, limited=false;
  for(let i=0;i<6;i++){
    w.q.length=0; w.w.length=0;            // clear stale waiters between rounds
    s(w,{t:'create'});
    await new Promise(r=>setTimeout(r,300));
    const got=w.q.find(m=>m.t==='room'||m.t==='error');
    if(got&&got.t==='room') made++;
    if(got&&got.reason==='rate-limited'){limited=true;break;}
  }
  w.q.length=0; w.w.length=0;
  console.log(`  room rate limit: made ${made} then ${limited?'blocked':'NOT BLOCKED'}`);


  [w,...held].forEach(x=>{try{x.close()}catch{}});
  console.log('\ndone'); process.exit(0);
})().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});
