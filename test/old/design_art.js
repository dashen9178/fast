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
 const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,300));return r.result?r.result.value:undefined;};
 await send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html'});await sleep(1100);
 await ev(`document.getElementById('btnNewApp').click();1`);await sleep(200);
 await ev(`var n=document.getElementById('newAppName');if(n){n.value='art';n.dispatchEvent(new Event('input',{bubbles:true}));}1`);await sleep(100);
 await ev(`document.getElementById('createGo').click();1`);await sleep(700);
 await ev(`document.getElementById('tabDesign').click();1`);await sleep(400);
 // 添加 5 个文字
 for (var i=0;i<5;i++){ await ev(`document.querySelector('[data-add="text"]').click();1`); await sleep(120); }
 const styles=['neon','gradient','emboss','stroke','shadow'];
 // 卡片顺序：最新在最前，所以 cards[0] 是最后添加的。逐个选中并设置
 for (var k=0;k<5;k++){
   await ev(`(function(){var cards=document.querySelectorAll('#compList .compcard');cards[${k}].click();})()`);
   await sleep(250);
   // 改文字内容
   await ev(`(function(){var ta=document.querySelector('#propPanel textarea');if(ta){ta.value='${styles[k]}文字';ta.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
   // 字号 26（按字段标签定位）
   await ev(`(function(){
     var fields=document.querySelectorAll('#propPanel .pp-field');
     for(var i=0;i<fields.length;i++){var sp=fields[i].querySelector('span');
       if(sp&&sp.textContent.indexOf('字号')>=0){var inp=fields[i].querySelector('input');if(inp){inp.value='26';inp.dispatchEvent(new Event('input',{bubbles:true}));}return;}}
   })()`);
   // 艺术字
   await ev(`(function(){
     var fields=document.querySelectorAll('#propPanel .pp-field');
     for(var i=0;i<fields.length;i++){var sp=fields[i].querySelector('span');if(sp&&sp.textContent.indexOf('艺术字')>=0){var sel=fields[i].querySelector('select');
       for(var j=0;j<sel.options.length;j++){if(sel.options[j].value==='${styles[k]}')sel.selectedIndex=j;}
       sel.dispatchEvent(new Event('change',{bubbles:true}));return;}}
   })()`);
   await sleep(150);
 }
 // 取消选中
 await ev(`(function(){var x=document.querySelector('#propPanel .pp-close');if(x)x.click();})()`);
 await sleep(200);
 // 进布局
 await ev(`document.getElementById('btnLayout').click();1`);
 await sleep(900);
 const info=await ev(`(function(){return Array.prototype.map.call(document.querySelectorAll('#layStage .litem'),function(it){return it.className.replace(/litem|t-text|sel|is-hidden/g,'').trim();}).join(' | ');})()`);
 console.log('舞台类:',info);
 let s=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('/tmp/design_art.png',Buffer.from(s.data,'base64'));
 console.log('截图已存');
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
