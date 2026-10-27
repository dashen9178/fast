const fs=require('fs');
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
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='g';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`); await sleep(200);
  await ev(`document.getElementById('createGo').click();'ok'`); await sleep(1200);
  await ev(`document.getElementById('tabBlocks').click();'ok'`); await sleep(1500);

  const xml=`<xml xmlns="https://developers.google.com/blockly/xml">
   <block type="controls_if" x="300" y="60"><mutation elseif="1" else="1"/>
     <value name="IF1"><block type="logic_operation"><field name="OP">AND</field>
       <value name="A"><block type="logic_operation"><field name="OP">AND</field></block></value></block></value>
     <statement name="DO1"><block type="controls_repeat_ext"><value name="TIMES"><block type="math_number"><field name="NUM">10</field></block></value></block></statement>
     <statement name="ELSE"><block type="act_set_brightness"><value name="V"><block type="math_number"><field name="NUM">80</field></block></value></block></statement>
   </block></xml>`;
  await ev(`blocklyWs.clear(); Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(${JSON.stringify(xml)}),blocklyWs);'ok'`);
  await sleep(600);

  const info = await ev(`(function(){
    var b=blocklyWs.getTopBlocks(true)[0];
    var ren=blocklyWs.getRenderer(), info=ren.makeRenderInfo_(b); info.measure();
    var dr=ren.makeDrawer_(b,info); dr.drawOutline_();
    var rows=info.rows.map(function(r){ return { y:+r.yPos.toFixed(1), h:+r.height.toFixed(1), w:+r.width.toFixed(1),
      wwc:+(r.widthWithConnectedBlocks||0).toFixed(1),
      spacer:!!(r.isSpacer&&r.isSpacer()), stmt:!!r.hasStatement, edge: info.__ifRowEdge.has(r)?+info.__ifRowEdge.get(r).toFixed(1):null }; });
    var rep=b.getInputTargetBlock('DO1'), els=b.getInputTargetBlock('ELSE');
    function bb(x){var b2=x.getSvgRoot().querySelector('.blocklyPath').getBBox();return {x:+b2.x.toFixed(1),y:+b2.y.toFixed(1),w:+b2.width.toFixed(1),h:+b2.height.toFixed(1),r:+(b2.x+b2.width).toFixed(1),b:+(b2.y+b2.height).toFixed(1)};}
    return JSON.stringify({ edges:info.__ifEdges, PE:info.__ifPocketEdge, rows:rows,
      repeat: bb(rep), repeatW:+rep.getHeightWidth().width.toFixed(1),
      bright: bb(els), brightW:+els.getHeightWidth().width.toFixed(1),
      path: dr.outlinePath_ },null,1);
  })()`);
  console.log(info);
  await ev(`blocklyWs.zoomToFit&&blocklyWs.zoomToFit();'z'`); await sleep(300);
  const s=await cdp('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(process.argv[2]+'\\g1_full.png',Buffer.from(s.data,'base64'));
  ws.close(); process.exit(0);
})().catch(e=>{console.error('ERR',e);process.exit(1);});
