const BASE='http://127.0.0.1:8931/editor.html?z='+Date.now();
const PORT=9333;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const list=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
  const ws=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
  let seq=0;
  function cdp(method,params={}){return new Promise((res,rej)=>{const id=++seq;const h=(ev)=>{const m=JSON.parse(ev.data);if(m.id===id){ws.removeEventListener('message',h);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};ws.addEventListener('message',h);ws.send(JSON.stringify({id,method,params}));});}
  async function ev(e){const r=await cdp('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception&&r.exceptionDetails.exception.description||r.exceptionDetails.text);return r.result.value;}
  await cdp('Page.enable');
  await cdp('Page.navigate',{url:BASE}); await sleep(2500);
  await ev(`document.getElementById('btnNewApp').click();'ok'`); await sleep(400);
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='p2';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`); await sleep(200);
  await ev(`document.getElementById('createGo').click();'ok'`); await sleep(1200);
  await ev(`document.getElementById('tabBlocks').click();'ok'`); await sleep(1500);
  async function load(xml){ await ev(`blocklyWs.clear();Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(${JSON.stringify(xml)}),blocklyWs);'ok'`); await sleep(200); }
  async function path(){ return ev(`(function(){ var b=blocklyWs.getTopBlocks(true)[0]; var ren=blocklyWs.getRenderer(), info=ren.makeRenderInfo_(b); info.measure();
    var dr=ren.makeDrawer_(b,info); dr.drawOutline_(); return dr.outlinePath_; })()`); }

  await load(`<xml xmlns="https://developers.google.com/blockly/xml"><block type="controls_repeat_ext" x="60" y="40"></block></xml>`);
  console.log('REPEAT empty:\n'+await path());
  await load(`<xml xmlns="https://developers.google.com/blockly/xml"><block type="controls_repeat_ext" x="60" y="40">
    <statement name="DO"><block type="controls_repeat_ext"><value name="TIMES"><block type="math_number"><field name="NUM">10</field></block></value></block></statement></block></xml>`);
  console.log('REPEAT+nested:\n'+await path());
  await load(`<xml xmlns="https://developers.google.com/blockly/xml"><block type="controls_repeat_ext" x="60" y="40">
    <statement name="DO"><block type="act_set_brightness"><value name="V"><block type="math_number"><field name="NUM">80</field></block></value></block></statement></block></xml>`);
  console.log('REPEAT+brightness:\n'+await path());

  ws.close(); process.exit(0);
})().catch(e=>{console.error('ERR',e);process.exit(1);});
