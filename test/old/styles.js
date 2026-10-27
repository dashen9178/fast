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
 await send('Emulation.setDeviceMetricsOverride',{width:420,height:860,deviceScaleFactor:2,mobile:true});
 const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)console.log('EXC',JSON.stringify(r.exceptionDetails).slice(0,400));return r.result?r.result.value:undefined;};
 // 先在同源设置 preview project
 await send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html'});await sleep(800);
 const proj={startScreen:'s1',orientation:'portrait',screens:[{id:'s1',name:'页面1',orientation:'portrait',showStatusBar:true,components:[
   {id:'b1',type:'button',text:'玻璃按钮',btnStyle:'glass'},
   {id:'b2',type:'button',text:'渐变按钮',btnStyle:'gradient',bg:'#ff5252'},
   {id:'b3',type:'button',text:'胶囊按钮',btnStyle:'capsule'},
   {id:'b4',type:'button',text:'描边按钮',btnStyle:'outline'},
   {id:'b5',type:'button',text:'阴影按钮',btnStyle:'shadow'},
   {id:'t1',type:'text',value:'霓虹发光文字',artStyle:'neon',color:'#00bcd4',fs:22},
   {id:'t2',type:'text',value:'渐变彩色文字',artStyle:'gradient',fs:22},
   {id:'t3',type:'text',value:'立体浮雕文字',artStyle:'emboss',fs:22},
   {id:'t5',type:'text',value:'描边空心字',artStyle:'stroke',fs:24},{id:'t4',type:'text',value:'斜体下划线加宽',italic:true,underline:true,spacing:3,fs:18},
   {id:'i1',type:'input',hint:'玻璃输入框',skin:'glass'},
   {id:'l1',type:'list',skin:'shadow',items:['列表项A','列表项B']}
 ],code:''}]};
 await ev(`localStorage.setItem('__previewProject',${JSON.stringify(JSON.stringify(proj))});1`);
 await send('Page.navigate',{url:'http://127.0.0.1:8931/runtime.html'});await sleep(1500);
 const check=await ev(`(function(){
   function q(id){return document.querySelector('[data-id="'+id+'"]');}
   function info(id,sel){var r=q(id);var n=sel?r.querySelector(sel):r;if(!n)return id+':MISSING';var cs=getComputedStyle(n);return id+' cls="'+n.className.replace(/\\s+/g,' ').trim()+'"';}
   var out=[];
   ['b1','b2','b3','b4','b5'].forEach(function(id){var b=q(id).querySelector('.matbtn');out.push(id+':'+b.className+' g1='+getComputedStyle(b).getPropertyValue('--g1').trim()+' radius='+getComputedStyle(b).borderRadius);});
   ['t1','t2','t3','t4'].forEach(function(id){var s=q(id).querySelector('.v-text');out.push(id+':"'+s.className+'" fs='+getComputedStyle(s).fontSize+' style='+getComputedStyle(s).fontStyle+' deco='+getComputedStyle(s).textDecorationLine+' ls='+getComputedStyle(s).letterSpacing);});
   var inp=q('i1').querySelector('input');out.push('i1:'+inp.className+' bg='+getComputedStyle(inp).backgroundColor);
   var lst=q('l1').querySelector('.list');out.push('l1:'+lst.className+' shadow='+(getComputedStyle(lst).boxShadow!=='none'));
   return out.join('\\n');
 })()`);
 console.log(check);
 let s=await send('Page.captureScreenshot',{format:'png'});
 fs.writeFileSync('/tmp/styles.png',Buffer.from(s.data,'base64'));
 console.log('截图已存');
 // 测设备兜底（无原生时，浏览器环境）
 const dev=await ev(`(function(){
   // 模拟读 RT：runtime 里 RT 未暴露到 window，直接测 deviceVal 逻辑等价物
   return 'navigator cores='+navigator.hardwareConcurrency+' online='+navigator.onLine+' innerW='+window.innerWidth;
 })()`);
 console.log(dev);
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
