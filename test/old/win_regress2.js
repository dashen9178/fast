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
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='r2';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`); await sleep(200);
  await ev(`document.getElementById('createGo').click();'ok'`); await sleep(1200);
  await ev(`document.getElementById('tabBlocks').click();'ok'`); await sleep(1500);
  async function load(xml){ await ev(`blocklyWs.clear();Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(${JSON.stringify(xml)}),blocklyWs);'ok'`); await sleep(150); }

  // repeat 回归（类型直接内联）
  await load(`<xml xmlns="https://developers.google.com/blockly/xml"><block type="controls_repeat_ext" x="60" y="40"><value name="TIMES"><block type="math_number"><field name="NUM">3</field></block></value>
    <statement name="DO"><block type="act_toast"><value name="MSG"><block type="text"><field name="TEXT">很长很长的提示内容文字</field></block></value></block></statement></block></xml>`);
  const rep = await ev(`(function(){
    var b=blocklyWs.getTopBlocks(true).find(function(x){return x.type==='controls_repeat_ext';});
    var ren=blocklyWs.getRenderer(), info=ren.makeRenderInfo_(b); info.measure();
    var dr=ren.makeDrawer_(b,info); dr.drawOutline_(); var bb=b.getSvgRoot().querySelector('.blocklyPath').getBBox();
    return {pathL:+bb.x.toFixed(1), blockW:+b.getHeightWidth().width.toFixed(1), childW:+b.getInputTargetBlock('DO').getHeightWidth().width.toFixed(1)};
  })()`);
  console.log('REPEAT:', JSON.stringify(rep));

  // 工具条 API 探查 + flyout controls_if
  const api = await ev(`(function(){ var tb=blocklyWs.getToolbox(); return Object.getOwnPropertyNames(Object.getPrototypeOf(tb)).filter(function(n){return /select|Categor/i.test(n);}).join(','); })()`);
  console.log('TOOLBOX API:', api);
  const fly = await ev(`(function(){
    var tb=blocklyWs.getToolbox();
    try{ tb.selectCategoryById_('blockly-e'); }catch(e1){ try{ tb.selectCategoryById('blockly-e'); }catch(e2){ var items=tb.getToolboxItems?tb.getToolboxItems():[]; var cat=items.find(function(i){return i.id_==='blockly-e';}); if(cat){ tb.selectItemById_&&tb.selectItemById_(cat.getId()); cat.onClick&&cat.onClick(); } } }
    var fb=blocklyWs.getFlyout ? blocklyWs.getFlyout().getWorkspace() : blocklyWs.getFlyoutWorkspace_();
    var bl=fb.getTopBlocks(true).filter(function(b){return b.type==='controls_if';});
    return bl.map(function(b){ var ren=fb.getRenderer(), info=ren.makeRenderInfo_(b); info.measure();
      var dr=ren.makeDrawer_(b,info); dr.drawOutline_(); var bb=b.getSvgRoot().querySelector('.blocklyPath').getBBox();
      return 'fly if pathL='+(+bb.x.toFixed(1))+' edges='+JSON.stringify(info.__ifEdges); }).join('\\n');
  })()`);
  console.log('FLYOUT:', fly);

  // mutator：每步独立事件组，live + undo + redo
  await load(`<xml xmlns="https://developers.google.com/blockly/xml"><block type="controls_if" x="60" y="40"></block></xml>`);
  const mut = await ev(`(function(){
    var out=[]; var b=blocklyWs.getTopBlocks(true)[0];
    function st(l){ var info=blocklyWs.getRenderer().makeRenderInfo_(b); info.measure();
      var dr=blocklyWs.getRenderer().makeDrawer_(b,info); dr.drawOutline_(); var bb=b.getSvgRoot().querySelector('.blocklyPath').getBBox();
      out.push(l+': n='+info.__ifEdges.length+' pathL='+(+bb.x.toFixed(1))); }
    function setMut(ei,el,g){ Blockly.Events.setGroup(false); Blockly.Events.setGroup(g,false);
      b.loadExtraState({elseIfCount:ei,hasElse:el});
      Blockly.Events.fire(new Blockly.Events.BlockChange(b,'mutation',null,null,JSON.stringify({elseif:ei,else:el?1:0})));
      Blockly.Events.setGroup(false); }
    st('start'); setMut(1,false,'g1'); st('+1'); setMut(2,false,'g2'); st('+2'); setMut(2,true,'g3'); st('+else');
    blocklyWs.undo(); st('undo1'); blocklyWs.undo(); st('undo2'); blocklyWs.undo(); st('undo3');
    blocklyWs.undo(true); st('redo1'); blocklyWs.undo(true); st('redo2'); blocklyWs.undo(true); st('redo3');
    return out.join('\\n');
  })()`);
  console.log('MUTATOR:\n'+mut);

  ws.close(); process.exit(0);
})().catch(e=>{console.error('ERR',e);process.exit(1);});
