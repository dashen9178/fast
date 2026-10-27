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
  await cdp('Page.enable'); await cdp('Emulation.setDeviceMetricsOverride',{width:1600,height:900,deviceScaleFactor:2,mobile:false});
  await cdp('Page.navigate',{url:BASE}); await sleep(2500);
  await ev(`document.getElementById('btnNewApp').click();'ok'`); await sleep(400);
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='g2';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`); await sleep(200);
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
  // 取积木在屏幕上的包围盒
  const box = await ev(`(function(){ var b=blocklyWs.getTopBlocks(true)[0]; var r=b.getSvgRoot().getBoundingClientRect();
    return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height,scale:blocklyWs.getScale()}); })()`);
  console.log('box',box);
  const b=JSON.parse(box);
  const clips=[
    {name:'A_widen', x:b.x+b.w*0.28, y:b.y+b.h*0.06, w:b.w*0.85, h:b.h*0.22},
    {name:'B_repeat',x:b.x-10,        y:b.y+b.h*0.40, w:b.w*0.45, h:b.h*0.22},
    {name:'C_else',  x:b.x-10,        y:b.y+b.h*0.60, w:b.w*0.75, h:b.h*0.30}
  ];
  for(const c of clips){
    const r=await cdp('Page.captureScreenshot',{format:'png',clip:{x:c.x,y:c.y,width:c.w,height:c.h,scale:2}});
    fs.writeFileSync(process.argv[2]+'\\'+c.name+'.png',Buffer.from(r.data,'base64'));
    console.log('saved',c.name);
  }
  ws.close(); process.exit(0);
})().catch(e=>{console.error('ERR',e);process.exit(1);});
