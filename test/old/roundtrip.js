const WebSocket=require('ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>{require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{
 const l=await get('/json/list');let t=l.find(x=>x.type==='page'&&x.url.includes('8931'))||l.find(x=>x.type==='page');
 const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
 const errs=[];
 await new Promise(r=>ws.on('open',r));
 ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);
   if(o.method==='Runtime.exceptionThrown'){const d=o.params.exceptionDetails;errs.push((d.exception&&d.exception.description)||d.text);}});
 const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
 await send('Page.enable');await send('Runtime.enable');
 const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,300));return r.result?r.result.value:undefined;};
 await send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html'});await sleep(1100);
 await ev(`document.getElementById('btnNewApp').click();1`);await sleep(200);
 await ev(`var n=document.getElementById('newAppName');if(n){n.value='rt';n.dispatchEvent(new Event('input',{bubbles:true}));}1`);await sleep(100);
 await ev(`document.getElementById('createGo').click();1`);await sleep(700);
 await ev(`document.getElementById('tabBlocks').click();1`);await sleep(900);
 // 放：启动 -> toast（带时长）+ 设备积木
 await ev(`(function(){var B=Blockly,ws=window.blocklyWs;
  var xml='<xml><block type="ev_start" x="100" y="60"><statement name="DO"><block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">运行中</field></shadow></value><value name="DUR"><shadow type="math_number"><field name="NUM">1</field></shadow></value><next>block_placeholder</next></block></statement></block></xml>';
  // 简化：直接建 ev_start + toast
  var x='<xml><block type="ev_start" x="100" y="60"><statement name="DO"><block type="act_toast"><value name="MSG"><shadow type="text"><field name="TEXT">运行中</field></shadow></value></block></statement></block></xml>';
  B.Xml.domToWorkspace(B.utils.xml.textToDom(x),ws);
  ws.scroll(50,60);ws.zoom(0.9);
  return '积木数='+ws.getAllBlocks(false).length+' scroll='+ws.scrollX+','+ws.scrollY+' scale='+ws.scale;
 })()`);
 const before=await ev(`JSON.stringify({n:window.blocklyWs.getAllBlocks(false).length,x:window.blocklyWs.scrollX,y:window.blocklyWs.scrollY,s:window.blocklyWs.scale})`);
 console.log('1. 运行前:',before);
 // 点运行
 await ev(`document.getElementById('btnRun').click();1`);
 await sleep(1800);
 const url1=await ev(`location.href`);
 console.log('2. 运行时URL:',url1);
 const toastShown=await ev(`(function(){var t=document.getElementById('toast');return t?t.classList.contains('show'):'无toast';})()`);
 console.log('3. toast显示:',toastShown);
 await sleep(1200);
 const errsRuntime=errs.slice();
 console.log('4. 运行时JS异常:',errsRuntime.length?errsRuntime:'无');
 // 返回
 await ev(`history.back();1`);
 await sleep(1800);
 const url2=await ev(`location.href`);
 const after=await ev(`(function(){try{var ws=window.blocklyWs;return ws?JSON.stringify({n:ws.getAllBlocks(false).length,x:ws.scrollX,y:ws.scrollY,s:ws.scale}):'ws未就绪 '+url2;}catch(e){return 'err '+e.message;}})()`);
 console.log('5. 返回后URL:',url2);
 console.log('6. 返回后:',after);
 console.log('7. 全程JS异常:',errs.length?errs.slice(0,5):'无');
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
