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
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='r8';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`); await sleep(200);
  await ev(`document.getElementById('createGo').click();'ok'`); await sleep(1200);
  await ev(`document.getElementById('tabBlocks').click();'ok'`); await sleep(1500);
  await ev(`Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom('<xml xmlns="https://developers.google.com/blockly/xml"><block type="controls_if" x="60" y="40"></block></xml>'),blocklyWs);'ok'`);
  await sleep(200);
  // 完全镜像 editor.js applyBranch：oldVal 取 saveExtraState，先 fire 再 loadExtraState，唯一组
  async function mut(ei,hasElse){
    return ev(`(function(){
      var b=blocklyWs.getTopBlocks(true)[0];
      var oldState=b.saveExtraState?b.saveExtraState():{elseIfCount:b.elseifCount_||0,hasElse:!!b.elseCount_};
      var newState={elseIfCount:${ei},hasElse:${hasElse?'true':'false'}};
      var oldVal=JSON.stringify(oldState), newVal=JSON.stringify(newState);
      var g='ifmut_'+Date.now()+'_'+Math.floor(Math.random()*1e6);
      Blockly.Events.setGroup(g);
      try{ Blockly.Events.fire(new Blockly.Events.BlockChange(b,'mutation',null,oldVal,newVal));
        b.loadExtraState(newState); b.render(); } finally { Blockly.Events.setGroup(false); }
      var i=blocklyWs.getRenderer().makeRenderInfo_(b); i.measure();
      var dr=blocklyWs.getRenderer().makeDrawer_(b,i); dr.drawOutline_(); var bb=b.getSvgRoot().querySelector('.blocklyPath').getBBox();
      return 'n='+i.__ifEdges.length+' pathL='+(+bb.x.toFixed(1));
    })()`);
  }
  async function n(){ return ev(`var b=blocklyWs.getTopBlocks(true)[0]; var i=blocklyWs.getRenderer().makeRenderInfo_(b); i.measure(); i.__ifEdges.length`); }
  async function undo(){ return ev(`blocklyWs.undo();'ok'`); }
  async function redo(){ return ev(`blocklyWs.undo(true);'ok'`); }
  console.log('+1', await mut(1,false)); await sleep(120);
  console.log('+2', await mut(2,false)); await sleep(120);
  console.log('+else', await mut(2,true)); await sleep(120);
  await undo(); console.log('undo1 n=', await n());
  await undo(); console.log('undo2 n=', await n());
  await undo(); console.log('undo3 n=', await n());
  await redo(); console.log('redo1 n=', await n());
  await redo(); console.log('redo2 n=', await n());
  await redo(); console.log('redo3 n=', await n());
  ws.close(); process.exit(0);
})().catch(e=>{console.error('ERR',e);process.exit(1);});
