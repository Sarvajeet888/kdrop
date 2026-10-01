// Run with jsdom available: NODE_PATH=<dev modules> node tests/desktop-ui.js
// Exercises the real desktop DOM and JS, with only the native IPC boundary mocked.
const {JSDOM}=require('jsdom');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.join(__dirname,'../desktop/ui');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const script=fs.readFileSync(path.join(root,'app.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  const dom=new JSDOM(html,{runScripts:'outside-only'});const w=dom.window;
  let listener;const calls=[];
  w.__TAURI__={core:{invoke:async(name,args)=>{calls.push({name,args});if(name==='choose')return args.folder?'C:/Received':'C:/movie.mp4';}},
    event:{listen:async(name,handler)=>{assert.equal(name,'transfer');listener=handler;}}};
  w.eval(script);const $=id=>w.document.getElementById(id);
  $('receive').click();await tick();assert.match($('status').textContent,/Choose a destination/);
  $('folder').click();await tick();$('address').value='192.168.1.10:45871';$('receive').click();await tick();
  assert.equal(calls.at(-1).name,'receive');assert.equal(calls.at(-1).args.directory,'C:/Received');
  assert($('send').disabled);
  listener({payload:{type:'pairing',uri:'kdrop://pair/test',qr:'<svg xmlns="http://www.w3.org/2000/svg"/>'}});
  assert(!$('pairing').hidden);assert.equal($('code').value,'kdrop://pair/test');
  listener({payload:{type:'offer',name:'<img onerror=alert(1)>',size:123}});
  assert(!$('approval').hidden);assert.equal($('offer').querySelector('img'),null);
  $('yes').click();await tick();assert.equal(calls.at(-1).args.accepted,true);
  listener({payload:{type:'progress',progress:{received:50,total:100,bytes_per_second:1048576,note:'Measured route'}}});
  assert.equal($('progress').value,50);assert.match($('speed').textContent,/1.0 MiB\/s received/);
  listener({payload:{type:'complete',path:'C:/Received/movie.mp4'}});assert.equal($('progress').value,100);
  listener({payload:{type:'idle'}});assert(!$('send').disabled);assert($('pairing').hidden);assert.equal($('code').value,'');
  $('file').click();await tick();$('peer').value='kdrop://pair/test';$('send').click();await tick();
  assert.equal(calls.at(-1).name,'send');assert.equal(calls.at(-1).args.path,'C:/movie.mp4');
  $('stop').click();await tick();assert.equal(calls.at(-1).name,'cancel');dom.window.close();
  const preview=new JSDOM(html,{runScripts:'outside-only'});preview.window.eval(script);
  assert(preview.window.document.getElementById('send').disabled);preview.window.close();
  console.log('Desktop DOM: pickers, pairing, approval, escaped filenames, progress, stop and browser guard PASS');
})().catch(error=>{console.error(error);process.exitCode=1});
