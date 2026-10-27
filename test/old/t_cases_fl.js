const WebSocket=require('/home/user/fast/test/node_modules/ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>{require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');const t=l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
await send('Network.setCacheDisabled',{cacheDisabled:true});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,500));return r.result.value;};
await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html?z='+Date.now()});setTimeout(r,1200);});
await ev(`document.getElementById('btnNewApp').click();1`);await sleep(200);
await ev(`(function(){var i=document.getElementById('newAppName');i.value='测试';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);await sleep(100);
await ev(`document.getElementById('createGo').click();1`);await sleep(700);
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(800);
const n=await ev(`(function(){
  var B=Blockly;
  function cmp(){return '<block type="logic_compare"><field name="OP">EQ</field></block>';}
  function toast(long){return '<block type="act_toast"><value name="MSG"><block type="text"><field name="TEXT">'+(long?'提示内容比较长的文字哈哈':'提示')+'</field></block></value></block>';}
  var cases=[];
  cases.push('<block type="controls_if"><mutation elseif="1" else="1"></mutation><value name="IF1">'+cmp()+'</value></block>'); // F
  cases.push('<block type="controls_if"><mutation elseif="2" else="1"></mutation><value name="IF2">'+cmp()+'</value></block>'); // G
  cases.push('<block type="controls_if"><mutation elseif="1" else="1"></mutation><value name="IF0">'+cmp()+'</value><statement name="DO0">'+toast(true)+'</statement></block>'); // H
  cases.push('<block type="controls_if"><mutation else="1"></mutation><value name="IF0">'+cmp()+'</value><statement name="DO0"><block type="controls_if"></block></statement></block>'); // I
  cases.push('<block type="controls_if"><mutation else="1"></mutation><statement name="DO0"><block type="controls_if"><mutation else="1"></mutation><value name="IF0">'+cmp()+'</value></block></statement></block>'); // J
  cases.push('<block type="ev_start"><next><block type="controls_if"><mutation else="1"></mutation><value name="IF0">'+cmp()+'</value><next><block type="act_exit"></block></next></block></next></block>'); // K
  cases.push('<block type="controls_if"><value name="IF0">'+cmp()+'</value></block>'); // L
  var xml='<xml xmlns="https://developers.google.com/blockly/xml">';
  cases.forEach(function(c,i){xml+=c.replace('<block ','<block x="60" y="'+(40+i*360)+'" ',1);});
  xml+='</xml>';
  B.Xml.domToWorkspace(B.utils.xml.textToDom(xml),blocklyWs);
  return blocklyWs.getTopBlocks(true).length;
})()`);
await sleep(800);
const ids=await ev(`blocklyWs.getTopBlocks(true).map(function(b){return b.id;})`);
for(let i=0;i<ids.length;i++){
  await ev(`blocklyWs.centerOnBlock(${JSON.stringify(ids[i])});1`);
  await sleep(350);
  let s=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync('/tmp/case_'+String.fromCharCode(70+i)+'.png',Buffer.from(s.data,'base64'));
}
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
