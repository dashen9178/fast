const WebSocket=require('ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>{require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{
 const l=await get('/json/list');let t=l.find(x=>x.type==='page'&&x.url.includes('8931'))||l.find(x=>x.type==='page');
 const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
 await new Promise(r=>ws.on('open',r));
 ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
 const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
 await send('Page.enable');await send('Runtime.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:2,mobile:true});
 const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,300));return r.result?r.result.value:undefined;};
 await send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html'});await sleep(1100);
 await ev(`document.getElementById('btnNewApp').click();1`);await sleep(200);
 await ev(`var n=document.getElementById('newAppName');if(n){n.value='art2';n.dispatchEvent(new Event('input',{bubbles:true}));}1`);await sleep(100);
 await ev(`document.getElementById('createGo').click();1`);await sleep(700);
 await ev(`document.getElementById('tabDesign').click();1`);await sleep(400);
 const labels=['霓虹发光','渐变彩色','立体浮雕','描边文字','阴影文字'];
 const styles=['neon','gradient','emboss','stroke','shadow'];
 for (var k=0;k<5;k++){
   await ev(`document.querySelector('[data-add="text"]').click();1`); await sleep(120);
   await ev(`(function(){
     function setField(label,val,tag){var fields=document.querySelectorAll('#propPanel .pp-field');
       for(var i=0;i<fields.length;i++){var sp=fields[i].querySelector('span');if(sp&&sp.textContent.indexOf(label)>=0){
         var inp=fields[i].querySelector(tag);if(inp){if(tag==='select'){for(var j=0;j<inp.options.length;j++)if(inp.options[j].value==='${styles[k]}')inp.selectedIndex=j;}else{inp.value=val;}inp.dispatchEvent(new Event(tag==='select'?'change':'input',{bubbles:true}));}return;}}}
     var ta=document.querySelector('#propPanel textarea');if(ta){ta.value='${labels[k]}';ta.dispatchEvent(new Event('input',{bubbles:true}));}
     setField('字号','24','input');
     setField('宽度','220','input');
     setField('艺术字','${styles[k]}','select');
   })()`);
   await sleep(150);
 }
 await ev(`(function(){var x=document.querySelector('#propPanel .pp-close');if(x)x.click();})()`);
 await sleep(200);
 await ev(`document.getElementById('btnLayout').click();1`);
 await sleep(900);
 let s=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('/tmp/design_art2.png',Buffer.from(s.data,'base64'));
 console.log('截图已存');
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
