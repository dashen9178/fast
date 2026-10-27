const WebSocket=require('/home/user/fast/test/node_modules/ws');const fs=require('fs');const HTTP='http://127.0.0.1:9222';
function get(p){return new Promise((res,rej)=>{require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
(async()=>{const l=await get('/json/list');let t=l.find(x=>x.type==='page'&&x.url.includes('8931'))||l.find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl,{perMessageDeflate:false});const P={};
await new Promise(r=>ws.on('open',r));
ws.on('message',m=>{const o=JSON.parse(m);if(o.id&&P[o.id])o.error?P[o.id].j(new Error(JSON.stringify(o.error))):P[o.id].r(o.result);});
const send=(m,p={})=>new Promise((r,j)=>{const i=++id;P[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
await send('Network.setCacheDisabled',{cacheDisabled:true});
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,400));return r.result.value;};
await new Promise(r=>{send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html?z='+Date.now()});setTimeout(r,1200);});
await ev(`document.getElementById('btnNewApp').click();1`);await sleep(200);
await ev(`(function(){var i=document.getElementById('newAppName');i.value='测试';i.dispatchEvent(new Event('input',{bubbles:true}));return 1;})()`);await sleep(100);
await ev(`document.getElementById('createGo').click();1`);await sleep(700);
await ev(`document.getElementById('tabBlocks').click();1`);await sleep(800);
// 进云列表分类，点“创建”飞层按钮
await ev(`(function(){var tb=blocklyWs.getToolbox();var list=tb.getToolboxItems();
 for(var i=0;i<list.length;i++){var n=list[i].name_||'';if(n==='云列表'){tb.setSelectedItem(list[i]);return 'ok';}}return 'no';})()`);
await sleep(600);
// 点 flyout 里的创建按钮
const flyBtn=JSON.parse(await ev(`(function(){var bs=document.querySelectorAll('.blocklyFlyout button, .blocklyFlyout .blocklyText');
 for(var i=0;i<bs.length;i++){if((bs[i].textContent||'').indexOf('创建')>=0){var r=bs[i].getBoundingClientRect();return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});}}
 return 'null';})()`));
console.log('创建按钮:',flyBtn);
async function realClick(x,y){await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:x,y:y});
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x:x,y:y,button:'left',buttons:1,clickCount:1});
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:x,y:y,button:'left',buttons:0,clickCount:1});await sleep(300);}
if(flyBtn&&flyBtn.x){await realClick(flyBtn.x,flyBtn.y);}
await sleep(500);
const dlg=await ev(`(function(){var m=document.getElementById('cloudCreateMask');return m?(!m.classList.contains('hidden')):'noMask';})()`);
console.log('创建弹窗打开:',dlg);
// 注入测试按钮 B 到弹窗下方页面中央偏左（菜单位于 provider 按钮下方，取其左侧空白）
await ev(`(function(){window.__hitsB=0;var b=document.createElement('button');b.id='__btnB';b.textContent='B';
 b.style.cssText='position:fixed;left:500px;top:420px;width:130px;height:60px;z-index:1200;font-size:20px;';
 b.addEventListener('click',function(){window.__hitsB++;});document.body.appendChild(b);return 1;})()`);
// 打开 provider 下拉
const prov=JSON.parse(await ev(`(function(){var p=document.getElementById('ccProvider');var r=p.getBoundingClientRect();return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});})()`));
await realClick(prov.x,prov.y);
await sleep(300);
const menuOpen=await ev(`!!document.querySelector('.pp-sel-menu')`);
console.log('provider菜单打开:',menuOpen);
// 菜单位置与 B 是否被盖住
const geo=await ev(`(function(){var m=document.querySelector('.pp-sel-menu');var mr=m.getBoundingClientRect();
 var b=document.getElementById('__btnB').getBoundingClientRect();
 return {menu:{x:Math.round(mr.x),y:Math.round(mr.y),w:Math.round(mr.width),h:Math.round(mr.height)},
  btnB:{x:Math.round(b.x),y:Math.round(b.y)},
  covered:!(b.right<mr.left||b.left>mr.right||b.bottom<mr.top||b.top>mr.bottom)};})()`);
console.log('几何:',JSON.stringify(geo));
// 场景A：点 B（在菜单外）→ 应只关闭菜单，B 不触发
await realClick(geo.btnB.x+65,geo.btnB.y+30);
const h1=await ev(`window.__hitsB`);
const menuGone=await ev(`!document.querySelector('.pp-sel-menu')`);
console.log('外部首点: 菜单关闭=',menuGone,' B命中(应0)=',h1);
await sleep(420);
await realClick(geo.btnB.x+65,geo.btnB.y+30);
const h2=await ev(`window.__hitsB`);
console.log('恢复后 B命中(应1)=',h2);
// 场景B：重新打开，点菜单项（把菜单项挪到盖住 B 的位置——直接打开后看第一项坐标是否在B上；
// 若不重合，则在 B 位置临时插一个同样的浮层项验证“项点击”路径已在 t_click919 场景1覆盖，此处只测外部）
let s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/m3_real.png',Buffer.from(s.data,'base64'));
process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
