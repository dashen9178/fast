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
 const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,400));return r.result?r.result.value:undefined;};
 await send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html'});await sleep(1100);
 await ev(`document.getElementById('btnNewApp').click();1`);await sleep(200);
 await ev(`var n=document.getElementById('newAppName');if(n){n.value='style';n.dispatchEvent(new Event('input',{bubbles:true}));}1`);await sleep(100);
 await ev(`document.getElementById('createGo').click();1`);await sleep(700);
 // 切设计
 await ev(`document.getElementById('tabDesign').click();1`);await sleep(500);
 // 添加按钮、文字、输入框
 await ev(`document.querySelector('[data-add="button"]').click();1`);await sleep(200);
 await ev(`document.querySelector('[data-add="text"]').click();1`);await sleep(200);
 await ev(`document.querySelector('[data-add="input"]').click();1`);await sleep(200);
 // 当前选中的是最后添加的 input（unshift 到最前，selectedCompId 是新的）。逐个设置：
 // 先选按钮（compList 里）。直接通过 propPanel 的 select 操作当前选中项。
 // 列出当前组件
 const list=await ev(`(function(){return Array.prototype.map.call(document.querySelectorAll('#compList .compcard'),function(c){return c.querySelector('.t1')?c.querySelector('.t1').textContent:'';}).join(' | ');})()`);
 console.log('组件列表:',list);
 // 选中按钮：通过卡片点击。先找按钮卡片（data-id）
 const ids=await ev(`(function(){var b=document.querySelector('[data-add="button"]');return 'ok';})()`);
 // 直接点第一张卡片（最新添加的 input 在最前）。我们需要选中按钮。遍历卡片找含"按钮"。
 await ev(`(function(){var cards=document.querySelectorAll('#compList .compcard');for(var i=0;i<cards.length;i++){if((cards[i].textContent||'').indexOf('按钮')>=0){cards[i].click();return;}}})()`);
 await sleep(300);
 // 属性面板应有"按钮风格"下拉
 const hasBtn=await ev(`(function(){var s=document.querySelector('#propPanel .pp-field select.pp-select');return s?s.options[s.selectedIndex].text+'/'+s.options.length:'无下拉';})()`);
 console.log('按钮属性面板首个下拉:',hasBtn);
 // 设置按钮风格为磨砂玻璃
 const setBtn=await ev(`(function(){
   var fields=document.querySelectorAll('#propPanel .pp-field');
   for(var i=0;i<fields.length;i++){var sp=fields[i].querySelector('span');if(sp&&sp.textContent.indexOf('按钮风格')>=0){var sel=fields[i].querySelector('select');
     for(var j=0;j<sel.options.length;j++){if(sel.options[j].value==='glass')sel.selectedIndex=j;}
     sel.dispatchEvent(new Event('change',{bubbles:true}));return '已设玻璃';}}
   return '未找到按钮风格';
 })()`);
 console.log(setBtn);
 // 选中文字，设艺术字霓虹
 await ev(`(function(){var cards=document.querySelectorAll('#compList .compcard');for(var i=0;i<cards.length;i++){if((cards[i].textContent||'').indexOf('文字')>=0){cards[i].click();return;}}})()`);
 await sleep(300);
 const setArt=await ev(`(function(){
   var fields=document.querySelectorAll('#propPanel .pp-field');
   for(var i=0;i<fields.length;i++){var sp=fields[i].querySelector('span');if(sp&&sp.textContent.indexOf('艺术字')>=0){var sel=fields[i].querySelector('select');
     for(var j=0;j<sel.options.length;j++){if(sel.options[j].value==='neon')sel.selectedIndex=j;}
     sel.dispatchEvent(new Event('change',{bubbles:true}));return '已设霓虹';}}
   return '未找到艺术字';
 })()`);
 console.log(setArt);
 // 进入布局视图
 const layoutBtn=await ev(`(function(){var b=document.getElementById('btnLayout')||document.querySelector('[data-layout]');return b?'found':'none';})()`);
 console.log('布局按钮:',layoutBtn);
 // 点布局按钮
 await ev(`(function(){var b=document.getElementById('btnLayout');if(b){b.click();return 'clicked';}var b2=document.querySelector('[data-layout]');if(b2){b2.click();return 'clicked2';}return 'no';})()`);
 await sleep(800);
 const stage=await ev(`(function(){
   var items=document.querySelectorAll('#layStage .litem');
   return Array.prototype.map.call(items,function(it){return (it.className.replace(/litem|t-[a-z]+|sel|is-hidden/g,'').trim()||'无特效类')+' :: '+it.dataset.id;}).join(' || ');
 })()`);
 console.log('布局舞台特效类:\n'+stage);
 let s=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('/tmp/design_layout.png',Buffer.from(s.data,'base64'));
 console.log('截图已存');
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
