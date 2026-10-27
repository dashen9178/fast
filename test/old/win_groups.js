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
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='r5';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`); await sleep(200);
  await ev(`document.getElementById('createGo').click();'ok'`); await sleep(1200);
  await ev(`document.getElementById('tabBlocks').click();'ok'`); await sleep(1500);
  await ev(`Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom('<xml xmlns="https://developers.google.com/blockly/xml"><block type="controls_if" x="60" y="40"></block></xml>'),blocklyWs);'ok'`);
  await sleep(200);
  async function mut(ei,el){
    return ev(`(function(){ Blockly.Events.setGroup(false);
      var b=blocklyWs.getTopBlocks(true)[0];
      b.loadExtraState({elseIfCount:${ei},hasElse:${el?'true':'false'}});
      var e=new Blockly.Events.BlockChange(b,'mutation',null,null,JSON.stringify({elseif:${ei},else:${el?1:0}}));
      e.recordUndo=true; Blockly.Events.fire(e); Blockly.Events.setGroup(false);
      window.__lastGroup=G;
      return e.group; })()`);
  }
  const g1=await mut(1,false); await sleep(120);
  const g2=await mut(2,false); await sleep(120);
  const g3=await mut(2,true); await sleep(120);
  console.log('groups:',g1,g2,g3, g1===g2||g2===g3?'SAME':'distinct');
  const stack = await ev(`(function(){ var db=blocklyWs.undoStack_||blocklyWs.undoStack; return db.slice(-12).map(function(e){return e.type+':'+(e.group||'').slice(-4)+(e.element?'/'+e.element:'');}).join(' | '); })()`);
  console.log('UNDO STACK:', stack);
  ws.close(); process.exit(0);
})().catch(e=>{console.error('ERR',e);process.exit(1);});
