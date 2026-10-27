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
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='r3';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`); await sleep(200);
  await ev(`document.getElementById('createGo').click();'ok'`); await sleep(1200);
  await ev(`document.getElementById('tabBlocks').click();'ok'`); await sleep(1500);

  // flyout：列出分类并选中“控制”
  const cats = await ev(`(function(){ var tb=blocklyWs.getToolbox(); var items=tb.getToolboxItems?tb.getToolboxItems():[];
    return items.map(function(i){return i.getId&&i.getId()+':'+(i.isCategory_!==false);}).join('|'); })()`);
  console.log('CATS:', cats);
  const fly = await ev(`(function(){
    var rows=document.querySelectorAll('.blocklyToolboxContents .blocklyTreeRow, .blocklyToolboxDiv .blocklyTreeRow');
    var hit=null; rows.forEach(function(r){ var lab=r.querySelector('.blocklyTreeLabel'); if(lab && lab.textContent==='控制') hit=r; });
    if(hit){ ['mousedown','mouseup','click'].forEach(function(t){ hit.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window})); }); }
    var fb=blocklyWs.getFlyout ? blocklyWs.getFlyout().getWorkspace() : blocklyWs.getFlyoutWorkspace_();
    var bl=fb.getTopBlocks(true).filter(function(b){return b.type==='controls_if';});
    return (hit?'clicked; ':'no row; ')+bl.length+' if blocks; '+bl.map(function(b){ var ren=fb.getRenderer(), info=ren.makeRenderInfo_(b); info.measure();
      var dr=ren.makeDrawer_(b,info); dr.drawOutline_(); var bb=b.getSvgRoot().querySelector('.blocklyPath').getBBox();
      return 'fly if pathL='+(+bb.x.toFixed(1))+' edges='+JSON.stringify(info.__ifEdges); }).join('\\n');
  })()`);
  console.log('FLYOUT:', fly);

  // mutator：不手工分组（每次 evaluate 独立执行，Blockly 自动成组）
  await ev(`blocklyWs.clear();Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom('<xml xmlns="https://developers.google.com/blockly/xml"><block type="controls_if" x="60" y="40"></block></xml>'),blocklyWs);'ok'`);
  await sleep(200);
  const mut = await ev(`(function(){
    var out=[]; var b=blocklyWs.getTopBlocks(true)[0];
    function st(l){ var info=blocklyWs.getRenderer().makeRenderInfo_(b); info.measure();
      var dr=blocklyWs.getRenderer().makeDrawer_(b,info); dr.drawOutline_(); var bb=b.getSvgRoot().querySelector('.blocklyPath').getBBox();
      out.push(l+': n='+info.__ifEdges.length+' pathL='+(+bb.x.toFixed(1))); }
    st('start');
    b.loadExtraState({elseIfCount:1,hasElse:false}); Blockly.Events.fire(new Blockly.Events.BlockChange(b,'mutation',null,null,JSON.stringify({elseif:1,else:0}))); st('+1');
    return out.join('\\n');
  })()`);
  console.log('MUT1:', mut);
  await sleep(100);
  const mut2 = await ev(`(function(){ var b=blocklyWs.getTopBlocks(true)[0];
    b.loadExtraState({elseIfCount:2,hasElse:false}); Blockly.Events.fire(new Blockly.Events.BlockChange(b,'mutation',null,null,JSON.stringify({elseif:2,else:0})));
    var info=blocklyWs.getRenderer().makeRenderInfo_(b); info.measure(); return 'after +2: n='+info.__ifEdges.length; })()`);
  console.log('MUT2:', mut2);
  await sleep(100);
  const mut3 = await ev(`(function(){ var b=blocklyWs.getTopBlocks(true)[0];
    b.loadExtraState({elseIfCount:2,hasElse:true}); Blockly.Events.fire(new Blockly.Events.BlockChange(b,'mutation',null,null,JSON.stringify({elseif:2,else:1})));
    var info=blocklyWs.getRenderer().makeRenderInfo_(b); info.measure(); return 'after else: n='+info.__ifEdges.length; })()`);
  console.log('MUT3:', mut3);
  const u1 = await ev(`blocklyWs.undo(); var b=blocklyWs.getTopBlocks(true)[0]; var i=blocklyWs.getRenderer().makeRenderInfo_(b); i.measure(); 'undo1 n='+i.__ifEdges.length`); console.log(u1);
  const u2 = await ev(`blocklyWs.undo(); var b=blocklyWs.getTopBlocks(true)[0]; var i=blocklyWs.getRenderer().makeRenderInfo_(b); i.measure(); 'undo2 n='+i.__ifEdges.length`); console.log(u2);
  const r1 = await ev(`blocklyWs.undo(true); var b=blocklyWs.getTopBlocks(true)[0]; var i=blocklyWs.getRenderer().makeRenderInfo_(b); i.measure(); 'redo1 n='+i.__ifEdges.length`); console.log(r1);
  const r2 = await ev(`blocklyWs.undo(true); var b=blocklyWs.getTopBlocks(true)[0]; var i=blocklyWs.getRenderer().makeRenderInfo_(b); i.measure(); 'redo2 n='+i.__ifEdges.length`); console.log(r2);
  const r3 = await ev(`blocklyWs.undo(true); var b=blocklyWs.getTopBlocks(true)[0]; var i=blocklyWs.getRenderer().makeRenderInfo_(b); i.measure(); 'redo3 n='+i.__ifEdges.length`); console.log(r3);

  ws.close(); process.exit(0);
})().catch(e=>{console.error('ERR',e);process.exit(1);});
