const fs=require('fs');
const BASE='http://127.0.0.1:8931/editor.html?z='+Date.now();
const PORT=9333;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const list=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();
  const page=list.find(t=>t.type==='page');
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
  let seq=0;
  function cdp(method,params={}){return new Promise((res,rej)=>{const id=++seq;const h=(ev)=>{const m=JSON.parse(ev.data);if(m.id===id){ws.removeEventListener('message',h);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};ws.addEventListener('message',h);ws.send(JSON.stringify({id,method,params}));});}
  async function ev(e){const r=await cdp('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception&&r.exceptionDetails.exception.description||r.exceptionDetails.text);return r.result.value;}
  await cdp('Page.enable'); await cdp('Emulation.setDeviceMetricsOverride',{width:1600,height:900,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url:BASE}); await sleep(2500);
  await ev(`document.getElementById('btnNewApp').click();'ok'`); await sleep(400);
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='v';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`); await sleep(200);
  await ev(`document.getElementById('createGo').click();'ok'`); await sleep(1200);
  await ev(`document.getElementById('tabBlocks').click();'ok'`); await sleep(1500);

  async function shot(name){ const r=await cdp('Page.captureScreenshot',{format:'png'}); fs.writeFileSync(name,Buffer.from(r.data,'base64')); console.log('shot',name); }
  async function load(xml){ await ev(`blocklyWs.clear();Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(${JSON.stringify(xml)}),blocklyWs);'ok'`); await sleep(300); }
  async function measure(){ return ev(`(function(){
    var ren=blocklyWs.getRenderer(); var b=blocklyWs.getTopBlocks(true).find(function(x){return x.type==='controls_if';});
    var info=ren.makeRenderInfo_(b); info.measure();
    var dr=ren.makeDrawer_(b,info); dr.drawOutline_&&dr.drawOutline_();
    var p=dr.outlinePath_, bb=b.getSvgRoot().querySelector('.blocklyPath').getBBox();
    return {edges:info.__ifEdges.map(function(x){return +x.toFixed(1)}), PE:info.__ifPocketEdge, blockW:+b.getHeightWidth().width.toFixed(1), pathL:+bb.x.toFixed(1), path:p};
  })()`); }

  // S1: 用户场景 — IF0 宽比较（空槽），2 else if + else，DO1 放宽 toast
  const s1=`<xml xmlns="https://developers.google.com/blockly/xml">
    <block type="controls_if" x="60" y="40"><mutation elseif="2" else="1"/>
      <value name="IF0"><block type="logic_compare"><field name="OP">EQ</field></block></value>
      <statement name="DO1"><block type="act_toast"><value name="MSG"><block type="text"><field name="TEXT">提示内容</field></block></value><value name="DUR"><block type="math_number"><field name="NUM">2</field></block></value></block></statement>
    </block></xml>`;
  await load(s1); await ev(`blocklyWs.zoomToFit();'z'`); await sleep(300);
  const m1=await measure(); console.log('S1 edges=',m1.edges,'PE=',m1.PE,'blockW=',m1.blockW,'pathL=',m1.pathL);
  // 路径断言：第一条口袋（DO0）的口线/地板必须在 152（PE-8），不能出现 H 342 之类
  console.log('S1 has H342?', /H\s*3\d\d\.\d/.test(m1.path.replace(/314|342\.75/g,'')), ' path snippet:', m1.path.split('V 52')[1] && m1.path.split('V 52')[1].slice(0,160));
  await shot(process.argv[2]+'\\s1_user.png');

  // S2: 宽条件在下方 elseIf（凸出彼此独立）
  const s2=`<xml xmlns="https://developers.google.com/blockly/xml">
    <block type="controls_if" x="60" y="40"><mutation elseif="2" else="1"/>
      <value name="IF2"><block type="logic_compare"><field name="OP">EQ</field><value name="A"><block type="math_number"><field name="NUM">123456</field></block></value><value name="B"><block type="math_number"><field name="NUM">654321</field></block></value></block></value>
    </block></xml>`;
  await load(s2); await ev(`blocklyWs.zoomToFit();'z'`); await sleep(300);
  const m2=await measure(); console.log('S2 edges=',m2.edges,'blockW=',m2.blockW,'pathL=',m2.pathL);
  await shot(process.argv[2]+'\\s2_lower.png');

  // S3: 空 if（无任何条件/子块）
  const s3=`<xml xmlns="https://developers.google.com/blockly/xml"><block type="controls_if" x="60" y="40"></block></xml>`;
  await load(s3); await sleep(200);
  const m3=await measure(); console.log('S3 edges=',m3.edges,'pathL=',m3.pathL);
  await shot(process.argv[2]+'\\s3_empty.png');

  ws.close(); process.exit(0);
})().catch(e=>{console.error('ERR',e);process.exit(1);});
