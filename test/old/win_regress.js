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
  await cdp('Page.enable'); await cdp('Emulation.setDeviceMetricsOverride',{width:1600,height:900,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url:BASE}); await sleep(2500);
  await ev(`document.getElementById('btnNewApp').click();'ok'`); await sleep(400);
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='r';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`); await sleep(200);
  await ev(`document.getElementById('createGo').click();'ok'`); await sleep(1200);
  await ev(`document.getElementById('tabBlocks').click();'ok'`); await sleep(1500);

  const checks=[];
  function chk(name,cond,extra){ checks.push({name:name,ok:!!cond,extra:extra||''}); }

  async function load(xml){ await ev(`blocklyWs.clear();Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(${JSON.stringify(xml)}),blocklyWs);'ok'`); await sleep(150); }
  function pathInfo(type){ return ev(`(function(){
    var b=blocklyWs.getTopBlocks(true).find(function(x){return x.type===(arguments[0]||'controls_if');});
    if(!b) return null;
    var ren=blocklyWs.getRenderer(), info=ren.makeRenderInfo_(b); info.measure();
    var dr=ren.makeDrawer_(b,info); dr.drawOutline_&&dr.drawOutline_();
    var bb=b.getSvgRoot().querySelector('.blocklyPath').getBBox();
    return {edges:info.__ifEdges?info.__ifEdges.map(function(x){return +x.toFixed(1)}):null, PE:info.__ifPocketEdge||null,
      pathL:+bb.x.toFixed(1), w:+b.getHeightWidth().width.toFixed(1),
      prev:b.previewConnection?null:(b.previousConnection?+b.previousConnection.getOffsetInBlock().x.toFixed(1):null),
      next:b.nextConnection?+b.nextConnection.getOffsetInBlock().x.toFixed(1):null};
  })()`, type); }

  // 1) mutator: 空 if 逐步加 elseif/else，再逐步删除
  await load(`<xml xmlns="https://developers.google.com/blockly/xml"><block type="controls_if" x="60" y="40"></block></xml>`);
  const mut = await ev(`(function(){
    var out=[]; var b=blocklyWs.getTopBlocks(true)[0];
    function st(label){ var ren=blocklyWs.getRenderer(), info=ren.makeRenderInfo_(b); info.measure();
      var dr=ren.makeDrawer_(b,info); dr.drawOutline_(); var bb=b.getSvgRoot().querySelector('.blocklyPath').getBBox();
      out.push(label+': edges='+JSON.stringify(info.__ifEdges)+' pathL='+ (+bb.x.toFixed(1))); }
    function setMut(ei,el){ b.loadExtraState({elseIfCount:ei,hasElse:el});
      Blockly.Events.fire(new Blockly.Events.BlockChange(b,'mutation',null,null,JSON.stringify({elseif:ei,else:el?1:0}))); }
    st('start');
    setMut(1,false); st('+elseif1');
    setMut(2,false); st('+elseif2');
    setMut(2,true); st('+else');
    setMut(1,true); blocklyWs.undo(); blocklyWs.undo(); st('undo2');
    blocklyWs.undo(true); blocklyWs.undo(true); st('redo2');
    return out.join('\\n');
  })()`);
  console.log('MUTATOR:\n'+mut);

  // 2) 嵌套 if
  await load(`<xml xmlns="https://developers.google.com/blockly/xml"><block type="controls_if" x="60" y="40"><mutation elseif="1" else="1"/>
    <value name="IF0"><block type="logic_compare"><field name="OP">EQ</field></block></value>
    <statement name="DO0"><block type="controls_if"><mutation else="1"/><statement name="DO0"><block type="act_back"></block></statement></block></statement>
    <statement name="ELSE"><block type="controls_if"></block></statement></block></xml>`);
  const nest = await ev(`(function(){
    var out=[]; blocklyWs.getAllBlocks(false).filter(function(b){return b.type==='controls_if';}).forEach(function(b){
      var ren=blocklyWs.getRenderer(), info=ren.makeRenderInfo_(b); info.measure();
      var dr=ren.makeDrawer_(b,info); dr.drawOutline_(); var bb=b.getSvgRoot().querySelector('.blocklyPath').getBBox();
      out.push('depth edges='+JSON.stringify(info.__ifEdges)+' pathL='+(+bb.x.toFixed(1)));
    }); return out.join('\\n');
  })()`);
  console.log('NEST:\n'+nest);

  // 3) repeat 宽子块（既有行为：臂固定，子块伸出）——回归
  await load(`<xml xmlns="https://developers.google.com/blockly/xml"><block type="controls_repeat_ext" x="60" y="40"><value name="TIMES"><block type="math_number"><field name="NUM">3</field></block></value>
    <statement name="DO"><block type="act_toast"><value name="MSG"><block type="text"><field name="TEXT">很长很长的提示内容文字</field></block></value></block></statement></block></xml>`);
  const rep = await pathInfo('controls_repeat_ext');
  console.log('REPEAT:', JSON.stringify(rep));

  // 4) 上下堆叠对齐
  await load(`<xml xmlns="https://developers.google.com/blockly/xml">
    <block type="controls_if" x="60" y="40"><mutation elseif="1" else="1"/><value name="IF1"><block type="logic_compare"><field name="OP">EQ</field><value name="A"><block type="math_number"><field name="NUM">123456</field></block></value><value name="B"><block type="math_number"><field name="NUM">654321</field></block></value></block></value>
      <next><block type="act_back"><next><block type="act_exit"></block></next></block></next></block></xml>`);
  const stack = await ev(`(function(){
    var tops=blocklyWs.getTopBlocks(true), b=tops[0];
    var out=[]; var cur=b; while(cur){ out.push(cur.type+' x='+cur.getRelativeToSurfaceXY().x.toFixed(1)); cur=cur.getNextBlock(); }
    var info=blocklyWs.getRenderer().makeRenderInfo_(b); info.measure();
    return out.join(' | ')+' || if prev='+b.previousConnection.getOffsetInBlock().x+' next='+b.nextConnection.getOffsetInBlock().x;
  })()`);
  console.log('STACK:', stack);

  // 5) flyout 中 controls_if 外形
  const fly = await ev(`(function(){
    var ws=blocklyWs.getToolbox().getSelectedItem()?blocklyWs:null;
    blocklyWs.getToolbox().selectCategoryById_('blockly-e');
    var fb=blocklyWs.getFlyout ? blocklyWs.getFlyout().getWorkspace() : blocklyWs.getFlyoutWorkspace_();
    var bl=fb.getTopBlocks(true).filter(function(b){return b.type==='controls_if';});
    return bl.map(function(b){ var ren=fb.getRenderer(), info=ren.makeRenderInfo_(b); info.measure();
      var dr=ren.makeDrawer_(b,info); dr.drawOutline_(); var bb=b.getSvgRoot().querySelector('.blocklyPath').getBBox();
      return 'fly if pathL='+(+bb.x.toFixed(1))+' edges='+JSON.stringify(info.__ifEdges); }).join('\\n');
  })()`);
  console.log('FLYOUT:', fly);

  // 6) 块型冒烟（无外部依赖的代表块）
  const types=['act_toast','act_back','act_exit','act_vibrate','logic_boolean','logic_compare','logic_operation','math_number','text','controls_repeat_ext','controls_whileUntil','controls_if'];
  let smokeBad=[];
  for(const ty of types){
    const r = await ev(`(function(){ try{ blocklyWs.clear(); Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom('<xml xmlns="https://developers.google.com/blockly/xml"><block type="'+arguments[0]+'" x="40" y="40"></block></xml>'),blocklyWs);
      var b=blocklyWs.getTopBlocks(true)[0]; var ren=blocklyWs.getRenderer(), info=ren.makeRenderInfo_(b); info.measure();
      var dr=ren.makeDrawer_(b,info); dr.drawOutline_(); var bb=b.getSvgRoot().querySelector('.blocklyPath').getBBox();
      return bb.x.toFixed(1); }catch(e){ return 'ERR:'+e.message; } })()`, ty);
    if(r !== '0.00') smokeBad.push(ty+'='+r);
  }
  console.log('SMOKE bad:', smokeBad.length?smokeBad.join(', '):'none');

  ws.close(); process.exit(0);
})().catch(e=>{console.error('ERR',e);process.exit(1);});
