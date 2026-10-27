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
  await cdp('Page.enable'); await cdp('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:2,mobile:false});
  await cdp('Page.navigate',{url:BASE}); await sleep(2500);
  await ev(`document.getElementById('btnNewApp').click();'ok'`); await sleep(400);
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='g6';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`); await sleep(200);
  await ev(`document.getElementById('createGo').click();'ok'`); await sleep(1200);
  await ev(`document.getElementById('tabBlocks').click();'ok'`); await sleep(1500);
  const xml=`<xml xmlns="https://developers.google.com/blockly/xml">
   <block type="controls_if" x="300" y="60"><mutation elseif="1" else="1"/>
     <value name="IF1"><block type="logic_operation"><field name="OP">AND</field>
       <value name="A"><block type="logic_operation"><field name="OP">AND</field></block></value></block></value>
     <statement name="DO1"><block type="controls_repeat_ext"><value name="TIMES"><block type="math_number"><field name="NUM">10</field></block></value></block></statement>
     <statement name="ELSE"><block type="act_set_brightness"><value name="V"><block type="math_number"><field name="NUM">80</field></block></value></block></statement>
   </block></xml>`;
  await ev(`Blockly.Xml.domToWorkspace(Blockly.utils.xml.textToDom(${JSON.stringify(xml)}),blocklyWs);'ok'`);
  await sleep(600);
  const box = await ev(`(function(){ var b=blocklyWs.getTopBlocks(true)[0]; var r=b.getSvgRoot().getBoundingClientRect();
    return JSON.stringify({x:r.x,y:r.y,scale:blocklyWs.getScale()}); })()`);
  const b=JSON.parse(box); const s=b.scale;
  const clips=[
    {name:'w_waist', lx:140, ly:205, lw:150, lh:65},
    {name:'w_repeat', lx:-10, ly:195, lw:210, lh:60},
    {name:'w_else',  lx:-10, ly:240, lw:290, lh:90},
    {name:'w_widen', lx:130, ly:55,  lw:320, lh:80}
  ];
  for(const c of clips){
    const r=await cdp('Page.captureScreenshot',{format:'png',clip:{x:b.x+c.lx*s,y:b.y+c.ly*s,width:c.lw*s,height:c.lh*s,scale:1}});
    fs.writeFileSync(process.argv[2]+'\\'+c.name+'.png',Buffer.from(r.data,'base64'));
    console.log('saved',c.name);
  }
  ws.close(); process.exit(0);
})().catch(e=>{console.error('ERR',e);process.exit(1);});
