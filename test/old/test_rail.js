const WebSocket=require('ws');const HTTP='http://127.0.0.1:9333';
function get(p){return new Promise((res,rej)=>{require('http').get(HTTP+p,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let id=0;
function conn(u){return new Promise((res,rej)=>{const ws=new WebSocket(u,{perMessageDeflate:false});const pend={},hand=[];ws.on('open',()=>res({send:(m,p={})=>new Promise((r,j)=>{const i=++id;pend[i]={r,j};ws.send(JSON.stringify({id:i,method:m,params:p}));}),on:(m,f)=>hand.push({m,f})}));ws.on('message',d=>{const o=JSON.parse(d);if(o.id&&pend[o.id])o.error?pend[o.id].j(new Error(JSON.stringify(o.error))):pend[o.id].r(o.result);hand.forEach(h=>h.m===o.method&&h.f(o.params));});ws.on('error',rej);});}
let pass=0,fail=0;function ok(name,cond,extra){if(cond){pass++;console.log('  ✓',name);}else{fail++;console.log('  ✗',name,extra!==undefined?JSON.stringify(extra):'');}}
(async()=>{
  const l=await get('/json/list');let t=l.find(x=>x.type==='page');const c=await conn(t.webSocketDebuggerUrl);const send=c.send;
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
  await send('Network.setCacheDisabled',{cacheDisabled:true});
  await send('Emulation.setDeviceMetricsOverride',{width:412,height:915,deviceScaleFactor:2.625,mobile:true});
  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
  const ev=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});if(r.exceptionDetails){console.log('EXC',r.exceptionDetails.exception&&r.exceptionDetails.exception.description||r.exceptionDetails.text);return undefined;}return r.result.value;};
  await new Promise(r=>{c.on('Page.loadEventFired',r);send('Page.navigate',{url:'http://127.0.0.1:8931/editor.html?t='+Date.now()});});
  await sleep(900);
  await ev(`document.getElementById('btnNewApp').click();1`);await sleep(250);
  await ev(`(function(){var i=document.getElementById('newAppName');i.value='测试App';i.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('createGo').click();})()`);await sleep(400);
  await ev(`document.getElementById('tabBlocks').click();1`);await sleep(1300);

  const Q=`(function(f){return f();})`;
  // 1. 初始结构
  const init=await ev(`(function(){
    var rail=document.getElementById('bbCats');
    var gen=rail.querySelector('.bb-panel-general'), wid=rail.querySelector('.bb-panel-widget');
    var top=rail.querySelector('.bb-top-wrap'), bot=rail.querySelector('.bb-bot-wrap');
    var genBtns=gen.querySelectorAll('.bb-cat').length, widBtns=wid.querySelectorAll('.bb-cat').length;
    function cs(el){return getComputedStyle(el);}
    return {mode:rail.className,genBtns:genBtns,widBtns:widBtns,
      topH:cs(top).height,botH:cs(bot).height,
      genTy:cs(gen).transform,widTy:cs(wid).transform,
      botPath:rail.querySelector('.bb-bot-wrap svg path').getAttribute('d'),
      topPath:rail.querySelector('.bb-top-wrap svg path').getAttribute('d')};
  })()`);
  ok('初始为常规态',/bb-mode-general/.test(init.mode),init.mode);
  ok('常规分类11个',init.genBtns===11,init.genBtns);
  ok('控件分类9个',init.widBtns===9,init.widBtns);
  ok('顶部槽收起(0)',init.topH==='0px',init.topH);
  ok('底部槽展开(30)',init.botH==='30px',init.botH);
  ok('底部按钮为向上箭头',init.botPath.indexOf('14l6-6')>=0,init.botPath);
  ok('顶部按钮为向下箭头',init.topPath.indexOf('10l6 6')>=0,init.topPath);

  // 2. 长方形图标
  const ico=await ev(`(function(){var i=document.querySelector('#bbCats .bb-panel-general .bb-cat-ico');var r=i.getBoundingClientRect();var b=i.closest('.bb-cat').getBoundingClientRect();return {iw:Math.round(r.width),ih:Math.round(r.height),bw:Math.round(b.width),bh:Math.round(b.height),dir:getComputedStyle(i.closest('.bb-cat')).flexDirection};})()`);
  ok('图标为横向长方形(宽>高)',ico.iw>ico.ih,ico);
  ok('分类条目为横向长方形(宽>高)',ico.bw>ico.bh,ico);

  // 3. 触摸点击常规分类“事件”
  async function tapLabel(panel,label){
    const p=await ev(`(function(){var b=[].slice.call(document.querySelectorAll('#bbCats .${panel} .bb-cat')).find(function(x){return x.querySelector('.bb-cat-lb').textContent===${JSON.stringify(label)};});var r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
    await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y}]});
    await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await sleep(450);return p;
  }
  async function flyState(){return await ev(`(function(){var ws=Blockly.getMainWorkspace();var tb=ws.getToolbox();var fl=ws.getFlyout();var fr=fl.svgGroup_?fl.svgGroup_.getBoundingClientRect():{left:null};var on=document.querySelector('#bbCats .bb-cat.on .bb-cat-lb');return {vis:fl.isVisible(),blocks:fl.getWorkspace().getAllBlocks().length,sel:tb.getSelectedItem()&&(tb.getSelectedItem().name_),on:on?on.textContent:null,flyLeft:Math.round(fr.left)};})()`);}
  // 命中元素
  const hit=await ev(`(function(){var b=document.querySelector('#bbCats .bb-panel-general .bb-cat');var r=b.getBoundingClientRect();var el=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return (el.className||'').toString();})()`);
  ok('触摸坐标命中自定义按钮(非原生toolbox)',hit.indexOf('bb-cat')>=0,hit);
  await tapLabel('bb-panel-general','事件');
  let s=await flyState();
  ok('触摸点常规分类→浮层打开(事件2块)',s.vis===true&&s.blocks===2,s);
  ok('选中高亮=事件',s.on==='事件',s);
  ok('浮层停靠在工具条右侧(left≈112)',s.flyLeft>=108&&s.flyLeft<=116,s.flyLeft);
  // 所有分类名必须完整显示，不得出现省略号截断
  const trunc=await ev(`(function(){var bad=[];document.querySelectorAll('#bbCats .bb-cat').forEach(function(b){var l=b.querySelector('.bb-cat-lb');if(l.scrollWidth>l.clientWidth+1)bad.push(l.textContent);});return bad;})()`);
  ok('分类名无省略号截断',Array.isArray(trunc)&&trunc.length===0,trunc);

  // 4. 点底部切换按钮 → 控件态
  const botP=await ev(`(function(){var b=document.querySelector('#bbCats .bb-bot-wrap .bb-switch');var r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:botP.x,y:botP.y}]});
  await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await sleep(450);
  const m2=await ev(`(function(){var rail=document.getElementById('bbCats');var cs=getComputedStyle;return {mode:rail.className,topH:cs(rail.querySelector('.bb-top-wrap')).height,botH:cs(rail.querySelector('.bb-bot-wrap')).height,genTy:cs(rail.querySelector('.bb-panel-general')).transform,widTy:cs(rail.querySelector('.bb-panel-widget')).transform};})()`);
  ok('切到控件态',/bb-mode-widget/.test(m2.mode),m2.mode);
  ok('顶部槽展开/底部槽收起',m2.topH==='30px'&&m2.botH==='0px',m2);
  s=await flyState();
  ok('切换后旧浮层已关闭',s.vis===false,s);
  // 控件面板可见：取一个控件按钮坐标应命中
  const hitW=await ev(`(function(){var b=[].slice.call(document.querySelectorAll('#bbCats .bb-panel-widget .bb-cat')).find(x=>x.querySelector('.bb-cat-lb').textContent==='按钮');var r=b.getBoundingClientRect();var el=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return (el.className||'').toString();})()`);
  ok('控件态可点到控件分类',hitW.indexOf('bb-cat')>=0,hitW);
  await tapLabel('bb-panel-widget','按钮');
  s=await flyState();
  ok('触摸点控件分类→浮层打开(按钮11块)',s.vis===true&&s.blocks===11,s);
  ok('选中高亮=按钮',s.on==='按钮',s);

  // 5. 点顶部切换按钮 → 回常规态
  const topP=await ev(`(function(){var b=document.querySelector('#bbCats .bb-top-wrap .bb-switch');var r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:topP.x,y:topP.y}]});
  await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await sleep(450);
  const m3=await ev(`(function(){var rail=document.getElementById('bbCats');return {mode:rail.className,topH:getComputedStyle(rail.querySelector('.bb-top-wrap')).height,botH:getComputedStyle(rail.querySelector('.bb-bot-wrap')).height};})()`);
  ok('切回常规态',/bb-mode-general/.test(m3.mode)&&m3.topH==='0px'&&m3.botH==='30px',m3);

  // 6. 切换按钮常驻：把常规面板滚到底，底部按钮位置仍贴栏底
  await ev(`(function(){var g=document.querySelector('#bbCats .bb-panel-general');g.scrollTop=g.scrollHeight;return 1;})()`);
  const sticky=await ev(`(function(){var rail=document.getElementById('bbCats');var rr=rail.getBoundingClientRect();var b=rail.querySelector('.bb-bot-wrap .bb-switch').getBoundingClientRect();return {railBottom:Math.round(rr.bottom),btnBottom:Math.round(b.bottom),btnTop:Math.round(b.top)};})()`);
  ok('列表滚动后底部按钮仍常驻贴底',Math.abs(sticky.railBottom-sticky.btnBottom)<=1,sticky);

  console.log('\\n结果: '+pass+' 通过, '+fail+' 失败');
  // 截图（控件态需要再切过去）
  await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:botP.x,y:botP.y}]});
  await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await sleep(450);
  const shot=await send('Page.captureScreenshot',{format:'png'});
  require('fs').writeFileSync('/tmp/shot_widget.png',Buffer.from(shot.data,'base64'));
  process.exit(fail?1:0);
})().catch(e=>{console.error('FATAL',e);process.exit(2);});
