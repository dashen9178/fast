/* 自定义代码：块定义 + JavaScript 代码生成器 + 工具箱。依赖 blockly 已加载。 */
(function () {
  'use strict';
  var B = window.Blockly;
  var JS = B.JavaScript; // v10 UMD 中的 JS 生成器单例
  var C_EVENT = '#FB8C00', C_ACT = '#1565C0', C_VAL = '#00897B';

  // 形态统一：半包围代码开口内不再放“执行/否则”等文字标签（D 形细脊柱风格）
  ['CONTROLS_IF_MSG_THEN', 'CONTROLS_REPEAT_INPUT_DO',
   'CONTROLS_WHILEUNTIL_INPUT_DO', 'CONTROLS_FOR_INPUT_DO', 'CONTROLS_FOREACH_INPUT_DO'
  ].forEach(function (k) { B.Msg[k] = ''; });
  // controls_if：头部横条上显示“如果 / 否则如果 / 否则”（标准形态）。
  // 新规则：齿轮扩展只增加“否则如果”，不再自动添加最底层“否则”；旧工程已有的否则仍兼容。
  // ELSE/THEN 语句槽上的原生内嵌文字标签统一置空（与 THEN/DO 同法），槽内不再贴“否则/执行”；
  // “否则”文字改由独立横条 ELSEHDR 显示。注意必须置空 Msg 而不是事后摘 field：
  // 原生 updateShape_ 每次全量重建都会重新 append 一个带“否则”标签的 ELSE，事后摘除只在
  // 第一次生效，齿轮分步加减后新 ELSE 又带回标签，会把语句槽缩进 statementEdge 撑大，
  // 导致所有口袋整体右移、子块看似悬浮在口袋右侧。
  B.Msg['CONTROLS_IF_MSG_ELSE'] = '';
  B.Msg['CONTROLS_IF_MSG_ELSEIF'] = '否则如果';

  /* controls_if 形态改造：
     1) “否则”不再贴在 ELSE 语句槽左侧，而是放到槽上方的独立 dummy 横条 ELSEHDR，
        与“如果 / 否则如果”头部横条形态一致；
     2) 齿轮 +/− 与撤销重做增删分支时，先保存各分支连接再重建输入并重连，
        未被删除的分支里已搭好的代码不会被顶出（原生 loadExtraState 只重建输入、不重连）。 */
  (function () {
    var ci = B.Blocks['controls_if'];
    if (!ci || ci.__fastIfPatched) return;
    var origIfInit = ci.init;
    ci.init = function () {
      origIfInit.call(this);
      var block = this;
      var origUpdateShape = block.updateShape_;
      block.updateShape_ = function () {
        origUpdateShape.call(block);
        var elseInput = block.getInput('ELSE');
        var hdr = block.getInput('ELSEHDR');
        if (elseInput) {
          if (!hdr) {
            // ELSE 语句槽上的原生“否则”标签已通过把 Msg.CONTROLS_IF_MSG_ELSE 置空而不再渲染，
            // 这里只建一条独立“否则”横条（文字写死，不依赖已置空的 Msg）。
            hdr = block.appendDummyInput('ELSEHDR');
            hdr.appendField('否则');
          }
          // 关键：原生 updateShape_ 每次都全量重建——先删 ELSE、删所有 IF/DO，再依次
          // append IF1/DO1…、最后 append ELSE；已存在的 ELSEHDR 不在它管理范围内、不会被移动。
          // 旧逻辑只在“新建 ELSEHDR”时排一次序，于是齿轮分步 +/−（0→1→2）时 ELSEHDR 会卡在
          // 旧位置（跑到“否则如果”之前），导致语句槽缩进错位、子块悬浮、横条断裂。
          // 这里每次都强制把 ELSEHDR 移到 ELSE 语句输入紧前，最终顺序恒为
          // IF0,DO0,IF1,DO1,…,ELSEHDR,ELSE。
          var list = block.inputList;
          var hi = list.indexOf(hdr), ei = list.indexOf(elseInput);
          if (hi !== -1 && ei !== -1 && hi !== ei - 1) {
            list.splice(hi, 1);
            ei = list.indexOf(elseInput);
            list.splice(ei, 0, hdr);
          }
        } else if (hdr) {
          block.removeInput('ELSEHDR');
        }
      };
      // 齿轮/撤销传入 extraState：保存连接 → 改数量 → updateShape_ → 重连
      block.loadExtraState = function (state) {
        block.elseifCount_ = state && state.elseIfCount ? state.elseIfCount : 0;
        block.elseCount_ = state && state.hasElse ? 1 : 0;
        if (typeof block.rebuildShape_ === 'function') block.rebuildShape_();
        else block.updateShape_();
      };
    };
    ci.__fastIfPatched = true;
  })();

  // 组件下拉（选项由 editor.js 动态提供）
  function compField(types) {
    return new B.FieldDropdown(function () {
      return window.__compOptions ? window.__compOptions(types)
        : [['（请先添加组件）', 'NONE']];
    });
  }
  function pageField() {
    return new B.FieldDropdown(function () {
      return window.__pageOptions ? window.__pageOptions() : [['（无页面）', 'NONE']];
    });
  }
  function q(s) { return JSON.stringify(String(s)); }

  /* ---------------- 块定义 ---------------- */

  // 事件：页面启动（帽子块：程序入口，顶部圆帽不能接代码；要执行的代码直接接在它下方）
  B.Blocks['ev_start'] = {
    init: function () {
      this.appendDummyInput().appendField('当页面启动时');
      this.setColour(C_EVENT);
      this.hat = 'cap';
      this.setNextStatement(true);
      this.setTooltip('该页面一打开就执行；这是程序入口，上面不能接代码。把要执行的代码接在它下方');
    }
  };
  // 事件：页面首次启动（帽子块：本次运行进程内，每个页面只触发一次）
  B.Blocks['ev_first_start'] = {
    init: function () {
      this.appendDummyInput().appendField('当页面首次启动时');
      this.setColour(C_EVENT);
      this.hat = 'cap';
      this.setNextStatement(true);
      this.setTooltip('本次打开 App 的过程中，该页面第一次被打开时执行一次；之后再跳回本页面不会重复执行。把 App 从后台彻底划掉后重新打开，会再次执行。适合做一次性初始化');
    }
  };
  // 事件：组件被点击
  B.Blocks['ev_click'] = {
    init: function () {
      this.appendDummyInput()
        .appendField('当组件')
        .appendField(compField(), 'COMP')
        .appendField('被点击');
      this.setColour(C_EVENT);
      this.hat = 'cap';
      this.setNextStatement(true);
      this.setTooltip('点击指定组件时执行；这是程序入口，上面不能接代码。把要执行的代码接在它下方');
    }
  };
  // 事件：列表项被点击
  B.Blocks['ev_itemclick'] = {
    init: function () {
      this.appendDummyInput()
        .appendField('当列表')
        .appendField(compField(['list']), 'COMP')
        .appendField('某项被点击');
      this.setColour(C_EVENT);
      this.hat = 'cap';
      this.setNextStatement(true);
      this.setTooltip('点击列表某一项时执行；这是程序入口，上面不能接代码。下方可用“列表选中项”代码拿到被点中的项');
    }
  };

  // 动作：设置组件文本
  B.Blocks['act_set_text'] = {
    init: function () {
      this.appendValueInput('VALUE')
        .appendField('设置组件')
        .appendField(compField(), 'COMP')
        .appendField('文本为');
      this.setInputsInline(true);
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour(C_ACT);
    }
  };
  // 动作：弹出提示（可指定显示多少秒，留空默认约 1.8 秒）
  B.Blocks['act_toast'] = {
    init: function () {
      this.appendValueInput('MSG').appendField('弹出提示');
      this.appendValueInput('DUR').setCheck('Number').appendField('显示').appendField('秒');
      this.setInputsInline(true);
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour(C_ACT);
      this.setTooltip('在屏幕上方弹出一条提示文字；“显示秒数”可填小数（如 1.5），留空则约 1.8 秒后自动消失');
    }
  };
  // 动作：跳转页面
  B.Blocks['act_goto'] = {
    init: function () {
      this.appendDummyInput().appendField('跳转到页面').appendField(pageField(), 'PAGE');
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour(C_ACT);
    }
  };
  // 动作：返回
  B.Blocks['act_back'] = {
    init: function () {
      this.appendDummyInput().appendField('返回上一页');
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour(C_ACT);
    }
  };
  // 动作：列表添加项
  B.Blocks['act_list_add'] = {
    init: function () {
      this.appendValueInput('VALUE')
        .appendField('给列表')
        .appendField(compField(['list']), 'COMP')
        .appendField('添加');
      this.setInputsInline(true);
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour(C_ACT);
    }
  };
  // 动作：列表设置全部数据
  B.Blocks['act_list_set'] = {
    init: function () {
      this.appendValueInput('LIST')
        .appendField('设置列表')
        .appendField(compField(['list']), 'COMP')
        .appendField('数据为');
      this.setInputsInline(true);
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour(C_ACT);
    }
  };
  // 动作：清空列表
  B.Blocks['act_list_clear'] = {
    init: function () {
      this.appendDummyInput().appendField('清空列表').appendField(compField(['list']), 'COMP');
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setColour(C_ACT);
    }
  };
  // 动作：显示组件
  B.Blocks['act_show'] = {
    init: function () {
      this.appendDummyInput().appendField('显示组件').appendField(compField(), 'COMP');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT);
    }
  };
  // 动作：隐藏组件
  B.Blocks['act_hide'] = {
    init: function () {
      this.appendDummyInput().appendField('隐藏组件').appendField(compField(), 'COMP');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT);
    }
  };
  // 动作：设置透明度（0~100）
  B.Blocks['act_opacity'] = {
    init: function () {
      this.appendValueInput('V').appendField('设置组件').appendField(compField(), 'COMP').appendField('透明度(0~100)为');
      this.setInputsInline(true);
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT);
    }
  };
  // 动作：启用 / 禁用组件（禁用后点不动，视觉上也会变灰）
  B.Blocks['act_enable'] = {
    init: function () {
      this.appendDummyInput().appendField('启用组件').appendField(compField(), 'COMP');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT);
    }
  };
  B.Blocks['act_disable'] = {
    init: function () {
      this.appendDummyInput().appendField('禁用组件').appendField(compField(), 'COMP');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT);
    }
  };
  /* 动作：设置组件旋转角度（所有控件通用；配合属性面板里的"旋转角度"） */
  B.Blocks['act_set_rot'] = {
    init: function () {
      this.appendValueInput('V').appendField('设置组件').appendField(compField(), 'COMP').appendField('旋转角度(°)为');
      this.setInputsInline(true);
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT);
    }
  };
  // 事件：任意组件的值发生变化（下拉/单选/日期/步进/滑块/开关…都会触发）
  B.Blocks['ev_change'] = {
    init: function () {
      this.appendDummyInput().appendField('当').appendField(compField(), 'COMP').appendField('的值变了');
      this.hat = 'cap'; this.setNextStatement(true); this.setColour(C_EVENT);
    }
  };
  // 值：组件是否被禁用
  B.Blocks['val_is_disabled'] = {
    init: function () {
      this.appendDummyInput().appendField('组件').appendField(compField(), 'COMP').appendField('被禁用了');
      this.setOutput(true, 'Boolean'); this.setColour(C_VAL);
    }
  };

  /* ---- 新增控件的取值 / 赋值 ---- */
  B.Blocks['val_comp_value'] = {
    init: function () {
      this.appendDummyInput().appendField('组件').appendField(compField(), 'COMP').appendField('当前的值');
      this.setOutput(true, null); this.setColour(C_VAL);
    }
  };
  B.Blocks['val_comp_number'] = {
    init: function () {
      this.appendDummyInput().appendField('组件').appendField(compField(), 'COMP').appendField('当前的数字');
      this.setOutput(true, 'Number'); this.setColour(C_VAL);
    }
  };
  B.Blocks['act_comp_set'] = {
    init: function () {
      this.appendValueInput('VALUE').appendField('把组件').appendField(compField(), 'COMP').appendField('设为');
      this.setInputsInline(true);
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT);
    }
  };
  /* ---- 计时器 ---- */
  B.Blocks['act_timer_start'] = {
    init: function () {
      this.appendValueInput('SECS').appendField('让计时器').appendField(compField(['timer']), 'COMP').appendField('倒计时(秒)');
      this.setInputsInline(true);
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT);
    }
  };
  B.Blocks['act_timer_countup'] = {
    init: function () {
      this.appendDummyInput().appendField('让计时器').appendField(compField(['timer']), 'COMP').appendField('开始正计时');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT);
    }
  };
  B.Blocks['act_timer_stop'] = {
    init: function () {
      this.appendDummyInput().appendField('停止计时器').appendField(compField(['timer']), 'COMP');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT);
    }
  };
  B.Blocks['val_timer_value'] = {
    init: function () {
      this.appendDummyInput().appendField('计时器').appendField(compField(['timer']), 'COMP').appendField('的秒数');
      this.setOutput(true, 'Number'); this.setColour(C_VAL);
    }
  };
  /* ---- 画布绘图 ---- */
  B.Blocks['act_canvas_clear'] = {
    init: function () {
      this.appendDummyInput().appendField('清空画布').appendField(compField(['canvas']), 'COMP');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT);
    }
  };
  B.Blocks['act_canvas_line'] = {
    init: function () {
      this.appendValueInput('X1').appendField('在画布').appendField(compField(['canvas']), 'COMP').appendField('画线 从x');
      this.appendValueInput('Y1').appendField('y');
      this.appendValueInput('X2').appendField('到x');
      this.appendValueInput('Y2').appendField('y');
      this.appendValueInput('COLOR').appendField('颜色');
      this.setInputsInline(true);
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT);
    }
  };
  B.Blocks['act_canvas_rect'] = {
    init: function () {
      this.appendValueInput('X').appendField('在画布').appendField(compField(['canvas']), 'COMP').appendField('画矩形 x');
      this.appendValueInput('Y').appendField('y');
      this.appendValueInput('W').appendField('宽');
      this.appendValueInput('H').appendField('高');
      this.appendValueInput('COLOR').appendField('颜色');
      this.appendDummyInput().appendField('填充')
        .appendField(new B.FieldDropdown([['是', 'TRUE'], ['否（只描边）', 'FALSE']]), 'FILL');
      this.setInputsInline(true);
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT);
    }
  };
  B.Blocks['act_canvas_circle'] = {
    init: function () {
      this.appendValueInput('X').appendField('在画布').appendField(compField(['canvas']), 'COMP').appendField('画圆 圆心x');
      this.appendValueInput('Y').appendField('y');
      this.appendValueInput('R').appendField('半径');
      this.appendValueInput('COLOR').appendField('颜色');
      this.appendDummyInput().appendField('填充')
        .appendField(new B.FieldDropdown([['是', 'TRUE'], ['否（只描边）', 'FALSE']]), 'FILL');
      this.setInputsInline(true);
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT);
    }
  };
  B.Blocks['act_canvas_text'] = {
    init: function () {
      this.appendValueInput('TEXT').appendField('在画布').appendField(compField(['canvas']), 'COMP').appendField('写文字');
      this.appendValueInput('X').appendField('x');
      this.appendValueInput('Y').appendField('y');
      this.appendValueInput('SIZE').appendField('字号');
      this.appendValueInput('COLOR').appendField('颜色');
      this.setInputsInline(true);
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT);
    }
  };

  /* ---- 视频播放器 ---- */
  B.Blocks['act_video_play'] = {
    init: function () { this.appendDummyInput().appendField('播放视频').appendField(compField(['video']), 'COMP');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT); }
  };
  B.Blocks['act_video_pause'] = {
    init: function () { this.appendDummyInput().appendField('暂停视频').appendField(compField(['video']), 'COMP');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT); }
  };
  B.Blocks['act_video_src'] = {
    init: function () { this.appendValueInput('URL').appendField('设置视频').appendField(compField(['video']), 'COMP').appendField('地址为');
      this.setInputsInline(true); this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT); }
  };
  B.Blocks['act_video_seek'] = {
    init: function () { this.appendValueInput('SEC').appendField('跳转视频到').appendField(compField(['video']), 'COMP').appendField('秒');
      this.setInputsInline(true); this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT); }
  };
  /* ---- 音频播放 ---- */
  B.Blocks['act_audio_play'] = {
    init: function () { this.appendDummyInput().appendField('播放音频').appendField(compField(['audio']), 'COMP');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT); }
  };
  B.Blocks['act_audio_pause'] = {
    init: function () { this.appendDummyInput().appendField('暂停音频').appendField(compField(['audio']), 'COMP');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT); }
  };
  B.Blocks['act_audio_src'] = {
    init: function () { this.appendValueInput('URL').appendField('设置音频').appendField(compField(['audio']), 'COMP').appendField('地址为');
      this.setInputsInline(true); this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT); }
  };
  B.Blocks['act_audio_seek'] = {
    init: function () { this.appendValueInput('SEC').appendField('跳转音频到').appendField(compField(['audio']), 'COMP').appendField('秒');
      this.setInputsInline(true); this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT); }
  };
  /* ---- 网页 ---- */
  B.Blocks['act_web_url'] = {
    init: function () { this.appendValueInput('URL').appendField('设置网页').appendField(compField(['web']), 'COMP').appendField('网址为');
      this.setInputsInline(true); this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT); }
  };

  var C_DEV = '#546E7A';
  // 设备：震动（毫秒，可接数字）
  B.Blocks['act_vibrate'] = {
    init: function () {
      this.appendValueInput('MS').appendField('震动 毫秒');
      this.setInputsInline(true);
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_DEV);
      this.setTooltip('让手机震动，括号内填毫秒数，如 30、200');
    }
  };
  // 设备：退出应用
  B.Blocks['act_exit'] = {
    init: function () {
      this.appendDummyInput().appendField('退出应用');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_DEV);
      this.setTooltip('导出的独立 App 中退出应用；在编辑器“试运行”里则结束试运行、返回编辑器');
    }
  };

  /* ---- 设备信息（一个下拉代码覆盖全部指标，帧率为实时实测，其余来自系统） ---- */
  var DEVICE_INFO_FIELDS = [
    ['当前帧率（FPS）', 'fps'],
    ['屏幕刷新率（Hz）', 'refreshRate'],
    ['CPU 核数', 'cpuCores'],
    ['CPU 占用率（%）', 'cpuUsage'],
    ['GPU 占用率（%）', 'gpuUsage'],
    ['内存占用率（%）', 'memUsage'],
    ['可用内存（GB）', 'memAvailGB'],
    ['总内存（GB）', 'memTotalGB'],
    ['剩余电量（%）', 'battery'],
    ['是否充电中', 'charging'],
    ['电池温度（℃）', 'batteryTemp'],
    ['设备温度（℃）', 'deviceTemp'],
    ['网络类型', 'netType'],
    ['是否联网', 'online'],
    ['屏幕亮度（%）', 'brightness'],
    ['屏幕宽度（px）', 'screenWidth'],
    ['屏幕高度（px）', 'screenHeight'],
    ['屏幕像素密度', 'density'],
    ['设备型号', 'model'],
    ['设备厂商', 'manufacturer'],
    ['安卓版本', 'androidVersion'],
    ['系统语言', 'language']
  ];
  B.Blocks['val_device_info'] = {
    init: function () {
      this.appendDummyInput().appendField('设备').appendField(new B.FieldDropdown(DEVICE_INFO_FIELDS), 'KEY');
      this.setOutput(true, null);
      this.setColour(C_DEV);
      this.setTooltip('读取手机的各项信息。当前帧率是 App 实际渲染帧率（每秒帧数）；CPU/GPU 占用率、温度为系统实时采样，个别机型不支持 GPU 占用时返回 -1');
    }
  };
  // 设备：设置屏幕亮度（0~100，-1 恢复自动）
  B.Blocks['act_set_brightness'] = {
    init: function () {
      this.appendValueInput('V').setCheck('Number').appendField('设置屏幕亮度(0~100)为');
      this.setInputsInline(true);
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_DEV);
      this.setTooltip('调节本 App 的屏幕亮度，0 最暗、100 最亮；只影响本 App，不修改系统设置');
    }
  };
  // 设备：保持屏幕常亮
  B.Blocks['act_keep_screen'] = {
    init: function () {
      this.appendValueInput('V').setCheck('Boolean').appendField('保持屏幕常亮');
      this.setInputsInline(true);
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_DEV);
      this.setTooltip('接“真”时 App 运行期间屏幕不会自动熄灭，接“假”恢复系统自动熄屏');
    }
  };
  // 设备：复制文本到剪贴板
  B.Blocks['act_copy'] = {
    init: function () {
      this.appendValueInput('V').appendField('复制文本到剪贴板');
      this.setInputsInline(true);
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_DEV);
      this.setTooltip('把一段文字复制到手机剪贴板，之后可粘贴到其它应用');
    }
  };

  var C_CTRL = '#607D8B';
  // 控制：等待若干秒（事件处理为异步，等待期间界面不卡死）
  B.Blocks['act_wait'] = {
    init: function () {
      this.appendValueInput('SECS').appendField('等待 秒');
      this.setInputsInline(true);
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_CTRL);
      this.setTooltip('等待指定秒数后再继续执行后面的动作，可填小数如 0.5');
    }
  };

  // 动作：设置组件背景色
  B.Blocks['act_set_bg'] = {
    init: function () {
      this.appendValueInput('COLOR')
        .appendField('设置组件').appendField(compField(), 'COMP').appendField('背景色为');
      this.setInputsInline(true);
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT);
      this.setTooltip('修改按钮/输入框/列表等组件的背景颜色，颜色用“颜色”分类里的取色块');
    }
  };
  // 动作：设置组件文字颜色
  B.Blocks['act_set_color'] = {
    init: function () {
      this.appendValueInput('COLOR')
        .appendField('设置组件').appendField(compField(), 'COMP').appendField('文字颜色为');
      this.setInputsInline(true);
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT);
      this.setTooltip('修改组件里文字的颜色，颜色用“颜色”分类里的取色块');
    }
  };

  // 取值：组件文本
  B.Blocks['val_get_text'] = {
    init: function () {
      this.appendDummyInput().appendField('组件').appendField(compField(), 'COMP').appendField('的文本');
      this.setOutput(true, null);
      this.setColour(C_VAL);
    }
  };
  // 取值：列表选中项 / 序号
  B.Blocks['val_selected_item'] = {
    init: function () {
      this.appendDummyInput().appendField('列表').appendField(compField(['list']), 'COMP').appendField('选中项');
      this.setOutput(true, null);
      this.setColour(C_VAL);
    }
  };
  B.Blocks['val_selected_index'] = {
    init: function () {
      this.appendDummyInput().appendField('列表').appendField(compField(['list']), 'COMP').appendField('选中序号');
      this.setOutput(true, 'Number');
      this.setColour(C_VAL);
    }
  };

  var C_MATH = '#3F51B5';
  // 取值：随机小数 0~1
  B.Blocks['val_random_frac'] = {
    init: function () {
      this.appendDummyInput().appendField('随机小数（0~1）');
      this.setOutput(true, 'Number'); this.setColour(C_MATH);
      this.setTooltip('生成一个大于等于 0、小于 1 的随机小数');
    }
  };
  // 取值：随机整数（区间，含两端）
  B.Blocks['val_random_int'] = {
    init: function () {
      this.appendValueInput('MIN').setCheck('Number').appendField('随机整数 从');
      this.appendValueInput('MAX').setCheck('Number').appendField('到');
      this.setInputsInline(true);
      this.setOutput(true, 'Number'); this.setColour(C_MATH);
      this.setTooltip('在“从…到…”两个整数之间随机取一个数（包含两端）');
    }
  };

  /* ---------------- JS 代码生成器 ---------------- */

  // 事件帽块已改为“圆帽 + 下方凸头堆叠”：回调体 = 接在帽块下方的整条 next 代码链。
  // 直接调用 forBlock（generateEventCode 中如此处理），blockToCode(next) 会自动沿 next 递归。
  function hatBody(b) {
    var next = b.getNextBlock && b.getNextBlock();
    return next ? JS.blockToCode(next) : '';
  }
  JS.forBlock['ev_start'] = function (b) {
    return "RT.on('start', async function(){\n" + hatBody(b) + "});\n";
  };
  JS.forBlock['ev_first_start'] = function (b) {
    return "RT.on('firstStart', async function(){\n" + hatBody(b) + "});\n";
  };
  JS.forBlock['ev_click'] = function (b) {
    var id = b.getFieldValue('COMP');
    return "RT.onClick(" + q(id) + ", async function(){\n" + hatBody(b) + "});\n";
  };
  JS.forBlock['ev_change'] = function (b) {
    var id = b.getFieldValue('COMP');
    return "RT.onChange(" + q(id) + ", async function(){\n" + hatBody(b) + "});\n";
  };
  JS.forBlock['ev_itemclick'] = function (b) {
    var id = b.getFieldValue('COMP');
    return "RT.onItemClick(" + q(id) + ", async function(__item, __index){\n" + hatBody(b) + "});\n";
  };
  JS.forBlock['act_set_text'] = function (b) {
    var v = JS.valueToCode(b, 'VALUE', JS.ORDER_ATOMIC) || "''";
    return "RT.setText(" + q(b.getFieldValue('COMP')) + ", " + v + ");\n";
  };
  JS.forBlock['act_toast'] = function (b) {
    var m = JS.valueToCode(b, 'MSG', JS.ORDER_ATOMIC) || "''";
    var d = JS.valueToCode(b, 'DUR', JS.ORDER_ATOMIC);
    return "RT.toast(" + m + (d ? ", " + d : "") + ");\n";
  };
  JS.forBlock['act_goto'] = function (b) {
    return "RT.gotoPage(" + q(b.getFieldValue('PAGE')) + ");\n";
  };
  JS.forBlock['act_back'] = function () { return "RT.back();\n"; };
  JS.forBlock['act_video_play'] = function (b) { return "RT.videoPlay(" + q(b.getFieldValue('COMP')) + ");\n"; };
  JS.forBlock['act_video_pause'] = function (b) { return "RT.videoPause(" + q(b.getFieldValue('COMP')) + ");\n"; };
  JS.forBlock['act_video_src'] = function (b) { var u = JS.valueToCode(b, 'URL', JS.ORDER_ATOMIC) || "''"; return "RT.videoSrc(" + q(b.getFieldValue('COMP')) + ", " + u + ");\n"; };
  JS.forBlock['act_video_seek'] = function (b) { var s = JS.valueToCode(b, 'SEC', JS.ORDER_ATOMIC) || "0"; return "RT.videoSeek(" + q(b.getFieldValue('COMP')) + ", " + s + ");\n"; };
  JS.forBlock['act_audio_play'] = function (b) { return "RT.audioPlay(" + q(b.getFieldValue('COMP')) + ");\n"; };
  JS.forBlock['act_audio_pause'] = function (b) { return "RT.audioPause(" + q(b.getFieldValue('COMP')) + ");\n"; };
  JS.forBlock['act_audio_src'] = function (b) { var u = JS.valueToCode(b, 'URL', JS.ORDER_ATOMIC) || "''"; return "RT.audioSrc(" + q(b.getFieldValue('COMP')) + ", " + u + ");\n"; };
  JS.forBlock['act_audio_seek'] = function (b) { var s = JS.valueToCode(b, 'SEC', JS.ORDER_ATOMIC) || "0"; return "RT.audioSeek(" + q(b.getFieldValue('COMP')) + ", " + s + ");\n"; };
  JS.forBlock['act_web_url'] = function (b) { var u = JS.valueToCode(b, 'URL', JS.ORDER_ATOMIC) || "''"; return "RT.webUrl(" + q(b.getFieldValue('COMP')) + ", " + u + ");\n"; };
  JS.forBlock['act_list_add'] = function (b) {
    var v = JS.valueToCode(b, 'VALUE', JS.ORDER_ATOMIC) || "''";
    return "RT.listAdd(" + q(b.getFieldValue('COMP')) + ", " + v + ");\n";
  };
  JS.forBlock['act_list_set'] = function (b) {
    var l = JS.valueToCode(b, 'LIST', JS.ORDER_ATOMIC) || "[]";
    return "RT.listSet(" + q(b.getFieldValue('COMP')) + ", " + l + ");\n";
  };
  JS.forBlock['act_list_clear'] = function (b) {
    return "RT.listClear(" + q(b.getFieldValue('COMP')) + ");\n";
  };
  JS.forBlock['act_show'] = function (b) { return "RT.show(" + q(b.getFieldValue('COMP')) + ");\n"; };
  JS.forBlock['act_hide'] = function (b) { return "RT.hide(" + q(b.getFieldValue('COMP')) + ");\n"; };
  JS.forBlock['act_opacity'] = function (b) {
    var v = JS.valueToCode(b, 'V', JS.ORDER_ATOMIC) || '100';
    return "RT.setOpacity(" + q(b.getFieldValue('COMP')) + ", " + v + ");\n";
  };
  JS.forBlock['act_vibrate'] = function (b) {
    var ms = JS.valueToCode(b, 'MS', JS.ORDER_ATOMIC) || '30';
    return "RT.vibrate(" + ms + ");\n";
  };
  JS.forBlock['act_exit'] = function () { return "RT.exit();\n"; };
  JS.forBlock['act_enable'] = function (b) { return "RT.enable(" + q(b.getFieldValue('COMP')) + ");\n"; };
  JS.forBlock['act_disable'] = function (b) { return "RT.disable(" + q(b.getFieldValue('COMP')) + ");\n"; };
  JS.forBlock['act_set_rot'] = function (b) {
    var v = JS.valueToCode(b, 'V', JS.ORDER_ATOMIC) || '0';
    return "RT.setRot(" + q(b.getFieldValue('COMP')) + ", " + v + ");\n";
  };
  JS.forBlock['val_is_disabled'] = function (b) {
    return ["RT.isDisabled(" + q(b.getFieldValue('COMP')) + ")", JS.ORDER_ATOMIC];
  };
  JS.forBlock['val_comp_value'] = function (b) {
    return ["RT.getValue(" + q(b.getFieldValue('COMP')) + ")", JS.ORDER_ATOMIC];
  };
  JS.forBlock['val_comp_number'] = function (b) {
    return ["RT.getNumber(" + q(b.getFieldValue('COMP')) + ")", JS.ORDER_ATOMIC];
  };
  JS.forBlock['act_comp_set'] = function (b) {
    var v = JS.valueToCode(b, 'VALUE', JS.ORDER_ATOMIC) || "''";
    return "RT.setComponent(" + q(b.getFieldValue('COMP')) + ", " + v + ");\n";
  };
  JS.forBlock['act_timer_start'] = function (b) {
    var s = JS.valueToCode(b, 'SECS', JS.ORDER_ATOMIC) || '10';
    return "RT.startTimer(" + q(b.getFieldValue('COMP')) + ", " + s + ", true);\n";
  };
  JS.forBlock['act_timer_countup'] = function (b) {
    return "RT.startTimer(" + q(b.getFieldValue('COMP')) + ", 0, false);\n";
  };
  JS.forBlock['act_timer_stop'] = function (b) {
    return "RT.stopTimer(" + q(b.getFieldValue('COMP')) + ");\n";
  };
  JS.forBlock['val_timer_value'] = function (b) {
    return ["RT.timerValue(" + q(b.getFieldValue('COMP')) + ")", JS.ORDER_ATOMIC];
  };
  JS.forBlock['act_canvas_clear'] = function (b) {
    return "RT.canvasClear(" + q(b.getFieldValue('COMP')) + ");\n";
  };
  JS.forBlock['act_canvas_line'] = function (b) {
    var f = function (n, d) { return JS.valueToCode(b, n, JS.ORDER_ATOMIC) || d; };
    return "RT.canvasLine(" + q(b.getFieldValue('COMP')) + ", " + f('X1', '0') + ", " + f('Y1', '0') + ", "
         + f('X2', '100') + ", " + f('Y2', '100') + ", " + f('COLOR', "'#000000'") + ", 2);\n";
  };
  JS.forBlock['act_canvas_rect'] = function (b) {
    var f = function (n, d) { return JS.valueToCode(b, n, JS.ORDER_ATOMIC) || d; };
    return "RT.canvasRect(" + q(b.getFieldValue('COMP')) + ", " + f('X', '0') + ", " + f('Y', '0') + ", "
         + f('W', '50') + ", " + f('H', '50') + ", " + f('COLOR', "'#000000'") + ", "
         + (b.getFieldValue('FILL') === 'TRUE' ? 'true' : 'false') + ");\n";
  };
  JS.forBlock['act_canvas_circle'] = function (b) {
    var f = function (n, d) { return JS.valueToCode(b, n, JS.ORDER_ATOMIC) || d; };
    return "RT.canvasCircle(" + q(b.getFieldValue('COMP')) + ", " + f('X', '50') + ", " + f('Y', '50') + ", "
         + f('R', '20') + ", " + f('COLOR', "'#000000'") + ", "
         + (b.getFieldValue('FILL') === 'TRUE' ? 'true' : 'false') + ");\n";
  };
  JS.forBlock['act_canvas_text'] = function (b) {
    var f = function (n, d) { return JS.valueToCode(b, n, JS.ORDER_ATOMIC) || d; };
    return "RT.canvasText(" + q(b.getFieldValue('COMP')) + ", " + f('X', '10') + ", " + f('Y', '20') + ", "
         + f('TEXT', "''") + ", " + f('COLOR', "'#000000'") + ", " + f('SIZE', '16') + ");\n";
  };
  JS.forBlock['val_device_info'] = function (b) {
    return ["RT.deviceVal(" + q(b.getFieldValue('KEY')) + ")", JS.ORDER_ATOMIC];
  };
  JS.forBlock['act_set_brightness'] = function (b) {
    var v = JS.valueToCode(b, 'V', JS.ORDER_ATOMIC) || '100';
    return "RT.setBrightness(" + v + ");\n";
  };
  JS.forBlock['act_keep_screen'] = function (b) {
    var v = JS.valueToCode(b, 'V', JS.ORDER_ATOMIC) || 'true';
    return "RT.setKeepScreenOn(" + v + ");\n";
  };
  JS.forBlock['act_copy'] = function (b) {
    var v = JS.valueToCode(b, 'V', JS.ORDER_ATOMIC) || "''";
    return "RT.copyText(" + v + ");\n";
  };
  JS.forBlock['act_wait'] = function (b) {
    var s = JS.valueToCode(b, 'SECS', JS.ORDER_ATOMIC) || '1';
    return "await RT.wait(" + s + ");\n";
  };
  JS.forBlock['act_set_bg'] = function (b) {
    var c = JS.valueToCode(b, 'COLOR', JS.ORDER_ATOMIC) || "'#2196F3'";
    return "RT.setBg(" + q(b.getFieldValue('COMP')) + ", " + c + ");\n";
  };
  JS.forBlock['act_set_color'] = function (b) {
    var c = JS.valueToCode(b, 'COLOR', JS.ORDER_ATOMIC) || "'#000000'";
    return "RT.setFg(" + q(b.getFieldValue('COMP')) + ", " + c + ");\n";
  };
  // 个性化外观：按钮风格 / 容器外观 / 文字特效（下拉固定选项，与设计页属性面板一致）
  JS.forBlock['act_set_btnstyle'] = function (b) {
    return "RT.setBtnStyle(" + q(b.getFieldValue('COMP')) + ", " + q(b.getFieldValue('STYLE')) + ");\n";
  };
  JS.forBlock['act_set_skin'] = function (b) {
    return "RT.setSkin(" + q(b.getFieldValue('COMP')) + ", " + q(b.getFieldValue('SKIN')) + ");\n";
  };
  JS.forBlock['act_set_art'] = function (b) {
    return "RT.setArtStyle(" + q(b.getFieldValue('COMP')) + ", " + q(b.getFieldValue('ART')) + ");\n";
  };
  JS.forBlock['val_get_text'] = function (b) {
    return ["RT.getText(" + q(b.getFieldValue('COMP')) + ")", JS.ORDER_ATOMIC];
  };
  JS.forBlock['val_selected_item'] = function (b) {
    return ["RT.selectedItem(" + q(b.getFieldValue('COMP')) + ")", JS.ORDER_ATOMIC];
  };
  JS.forBlock['val_selected_index'] = function (b) {
    return ["RT.selectedIndex(" + q(b.getFieldValue('COMP')) + ")", JS.ORDER_ATOMIC];
  };
  JS.forBlock['val_random_frac'] = function () {
    return ['Math.random()', JS.ORDER_FUNCTION_CALL || JS.ORDER_ATOMIC];
  };
  JS.forBlock['val_random_int'] = function (b) {
    var lo = JS.valueToCode(b, 'MIN', JS.ORDER_ATOMIC) || '1';
    var hi = JS.valueToCode(b, 'MAX', JS.ORDER_ATOMIC) || '100';
    return ['(Math.floor(Math.random()*(' + hi + '-(' + lo + ')+1))+(' + lo + '))', JS.ORDER_ATOMIC];
  };

  /* ---------------- 新控件：开关 / 复选框 / 滑块 / 进度条 ---------------- */
  // 设置 开关/复选框 状态（真=开/勾选）
  B.Blocks['act_set_checked'] = {
    init: function () {
      this.appendValueInput('VALUE').setCheck('Boolean')
        .appendField('设置').appendField(compField(['switch', 'checkbox']), 'COMP').appendField('状态为');
      this.setInputsInline(true);
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT);
      this.setTooltip('设置开关或复选框的状态，接“真/假”或逻辑判断代码');
    }
  };
  JS.forBlock['act_set_checked'] = function (b) {
    var v = JS.valueToCode(b, 'VALUE', JS.ORDER_ATOMIC) || 'false';
    return "RT.setChecked(" + q(b.getFieldValue('COMP')) + ", " + v + ");\n";
  };
  // 读取 开关/复选框 状态
  B.Blocks['val_get_checked'] = {
    init: function () {
      this.appendDummyInput().appendField(compField(['switch', 'checkbox']), 'COMP').appendField('的状态');
      this.setOutput(true, 'Boolean'); this.setColour(C_VAL);
      this.setTooltip('返回开关/复选框是否为开（真）或关（假）');
    }
  };
  JS.forBlock['val_get_checked'] = function (b) {
    return ["RT.getChecked(" + q(b.getFieldValue('COMP')) + ")", JS.ORDER_ATOMIC];
  };
  // 设置滑块数值
  B.Blocks['act_set_slider'] = {
    init: function () {
      this.appendValueInput('VALUE').setCheck('Number')
        .appendField('设置滑块').appendField(compField(['slider']), 'COMP').appendField('数值为');
      this.setInputsInline(true);
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT);
    }
  };
  JS.forBlock['act_set_slider'] = function (b) {
    var v = JS.valueToCode(b, 'VALUE', JS.ORDER_ATOMIC) || '0';
    return "RT.setSlider(" + q(b.getFieldValue('COMP')) + ", " + v + ");\n";
  };
  B.Blocks['val_get_slider'] = {
    init: function () {
      this.appendDummyInput().appendField('滑块').appendField(compField(['slider']), 'COMP').appendField('的数值');
      this.setOutput(true, 'Number'); this.setColour(C_VAL);
    }
  };
  JS.forBlock['val_get_slider'] = function (b) {
    return ["RT.getSlider(" + q(b.getFieldValue('COMP')) + ")", JS.ORDER_ATOMIC];
  };
  // 滑块数值变化事件（帽子块）
  B.Blocks['ev_slider_change'] = {
    init: function () {
      this.appendDummyInput()
        .appendField('当滑块').appendField(compField(['slider']), 'COMP').appendField('数值变化时');
      this.setColour(C_EVENT); this.hat = 'cap';
      this.setNextStatement(true);
      this.setTooltip('拖动滑块改变数值时执行；这是程序入口，上面不能接代码。下方可用“滑块的数值”代码拿到最新数值');
    }
  };
  JS.forBlock['ev_slider_change'] = function (b) {
    return "RT.onChange(" + q(b.getFieldValue('COMP')) + ", async function(__value){\n" + hatBody(b) + "});\n";
  };
  // 设置 / 读取 进度条
  B.Blocks['act_set_progress'] = {
    init: function () {
      this.appendValueInput('VALUE').setCheck('Number')
        .appendField('设置进度条').appendField(compField(['progress']), 'COMP').appendField('进度为');
      this.setInputsInline(true);
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT);
    }
  };
  JS.forBlock['act_set_progress'] = function (b) {
    var v = JS.valueToCode(b, 'VALUE', JS.ORDER_ATOMIC) || '0';
    return "RT.setProgress(" + q(b.getFieldValue('COMP')) + ", " + v + ");\n";
  };
  B.Blocks['val_get_progress'] = {
    init: function () {
      this.appendDummyInput().appendField('进度条').appendField(compField(['progress']), 'COMP').appendField('的进度');
      this.setOutput(true, 'Number'); this.setColour(C_VAL);
    }
  };
  JS.forBlock['val_get_progress'] = function (b) {
    return ["RT.getProgress(" + q(b.getFieldValue('COMP')) + ")", JS.ORDER_ATOMIC];
  };

  // 动作：设置输入框提示词（placeholder）
  B.Blocks['act_set_hint'] = {
    init: function () {
      this.appendValueInput('VALUE')
        .appendField('设置输入框').appendField(compField(['input']), 'COMP').appendField('提示词为');
      this.setInputsInline(true);
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_ACT);
      this.setTooltip('修改输入框里灰色的提示文字（未输入内容时显示）');
    }
  };
  JS.forBlock['act_set_hint'] = function (b) {
    var v = JS.valueToCode(b, 'VALUE', JS.ORDER_ATOMIC) || "''";
    return "RT.setHint(" + q(b.getFieldValue('COMP')) + ", " + v + ");\n";
  };

  /* ---------------- 云列表（SeaTable 等云端表格） ----------------
     云表格在编辑器里通过“创建 SeaTable 云列表”弹窗登记（project.clouds），
     每块云代码都带一个云表格下拉（像变量一样选择），一个作品可接入多个云表格。 */
  var C_CLOUD = '#0284C7';
  function txtVal(b, name, def) {
    return JS.valueToCode(b, name, JS.ORDER_ATOMIC) || q(def);
  }
  // 编辑器侧返回当前工程登记的云表格列表 [{id,name,provider,server,uuid,token}]
  function projectClouds() {
    var list = (window.BB_getProjectClouds && window.BB_getProjectClouds()) || [];
    return Array.isArray(list) ? list : [];
  }
  // 云表格下拉：选项来自当前工程；未创建时给占位项
  function cloudDropdown() {
    var f = new B.FieldDropdown(function () {
      var cs = projectClouds().map(function (c) { return [c.name || '云表格', c.id]; });
      if (!cs.length) cs.push(['（未创建云表格）', '']);
      return cs;
    });
    return f;
  }
  // 代码生成时取当前代码选中的云表格 id（未选则回退第一个）
  function cloudIdCode(b) {
    var id = b.getFieldValue('CLOUD');
    if (id) return q(id);
    var cs = projectClouds();
    return cs[0] ? q(cs[0].id) : q('');
  }
  // 把“字段堆叠”里的 cloud_field 代码收集成一个对象（IIFE 内构造，避免同名冲突）
  function fieldObjectCode(b, inputName) {
    var inner = JS.statementToCode(b, inputName) || '';
    return '(await (async function (){ var __r = {};\n' + inner + 'return __r; })())';
  }

  /* ===== 旧版（v1.9.6）云列表代码：保留定义以兼容老工程，新代码从浮层移除 ===== */
  B.Blocks['cloud_setup'] = {
    init: function () {
      this.appendDummyInput()
        .appendField('☁ 设置云列表 品牌')
        .appendField(new B.FieldDropdown([
          ['SeaTable 中国云', 'seatable-cn'],
          ['SeaTable 国际云', 'seatable-io'],
          ['SeaTable 自定义服务器', 'seatable-custom']
        ]), 'PROVIDER');
      this.appendValueInput('SERVER').appendField('服务器地址（自定义时填写）');
      this.appendValueInput('UUID').appendField('表格 UUID');
      this.appendValueInput('TOKEN').appendField('API 密钥');
      this.setInputsInline(false);
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_CLOUD);
    }
  };
  JS.forBlock['cloud_setup'] = function (b) {
    var prov = q(b.getFieldValue('PROVIDER'));
    var server = JS.valueToCode(b, 'SERVER', JS.ORDER_ATOMIC) || "''";
    var uuid = JS.valueToCode(b, 'UUID', JS.ORDER_ATOMIC) || "''";
    var token = JS.valueToCode(b, 'TOKEN', JS.ORDER_ATOMIC) || "''";
    return 'await RT.cloudSetup(' + prov + ', ' + server + ', ' + uuid + ', ' + token + ');\n';
  };

  /* ===== 新版云表格代码（每块带云表格下拉） ===== */
  // （云表格▾）所有表格名称
  B.Blocks['cloud_tables'] = {
    init: function () {
      this.appendDummyInput().appendField(cloudDropdown(), 'CLOUD').appendField('所有表格名称');
      this.setOutput(true, null); this.setColour(C_CLOUD);
      this.setTooltip('返回所选云表格库里所有表格的名称（列表）');
    }
  };
  JS.forBlock['cloud_tables'] = function (b) {
    return ['await RT.cloudTables(' + cloudIdCode(b) + ')', JS.ORDER_ATOMIC];
  };
  // （云表格▾）查询表（）的所有行
  B.Blocks['cloud_rows'] = {
    init: function () {
      this.appendValueInput('TABLE').appendField(cloudDropdown(), 'CLOUD').appendField('查询表');
      this.appendDummyInput().appendField('的所有行');
      this.setInputsInline(true);
      this.setOutput(true, null); this.setColour(C_CLOUD);
      this.setTooltip('返回指定数据表的全部行，每行是一个对象，用“取字段”代码读取列值');
    }
  };
  JS.forBlock['cloud_rows'] = function (b) {
    var t = JS.valueToCode(b, 'TABLE', JS.ORDER_ATOMIC) || q('表名');
    return ['await RT.cloudRows(' + cloudIdCode(b) + ', ' + t + ')', JS.ORDER_ATOMIC];
  };
  // （云表格▾）SQL 查询（）
  B.Blocks['cloud_sql'] = {
    init: function () {
      this.appendValueInput('SQL').appendField(cloudDropdown(), 'CLOUD').appendField('SQL 查询');
      this.setInputsInline(true);
      this.setOutput(true, null); this.setColour(C_CLOUD);
      this.setTooltip('用 SQL 查询，例如 SELECT * FROM `表名`，返回符合条件的行列表');
    }
  };
  JS.forBlock['cloud_sql'] = function (b) {
    var s = JS.valueToCode(b, 'SQL', JS.ORDER_ATOMIC) || q('SELECT * FROM `表名`');
    return ['await RT.cloudSql(' + cloudIdCode(b) + ', ' + s + ')', JS.ORDER_ATOMIC];
  };
  // （云表格▾）表（）的行数
  B.Blocks['cloud_count'] = {
    init: function () {
      this.appendValueInput('TABLE').appendField(cloudDropdown(), 'CLOUD').appendField('表');
      this.appendDummyInput().appendField('的行数');
      this.setInputsInline(true);
      this.setOutput(true, null); this.setColour(C_CLOUD);
      this.setTooltip('返回指定数据表当前的总行数（数字）');
    }
  };
  JS.forBlock['cloud_count'] = function (b) {
    var t = JS.valueToCode(b, 'TABLE', JS.ORDER_ATOMIC) || q('表名');
    return ['await RT.cloudRowCount(' + cloudIdCode(b) + ', ' + t + ')', JS.ORDER_ATOMIC];
  };
  // （云表格▾）从表（）取行 Id 为（）的一行
  B.Blocks['cloud_row_by_id'] = {
    init: function () {
      this.appendValueInput('TABLE').appendField(cloudDropdown(), 'CLOUD').appendField('从表');
      this.appendValueInput('ROWID').appendField('取行 Id 为');
      this.appendDummyInput().appendField('的一行');
      this.setInputsInline(true);
      this.setOutput(true, null); this.setColour(C_CLOUD);
      this.setTooltip('按行 Id（_id）取某一行；新增行成功后可拿到新行的 Id');
    }
  };
  JS.forBlock['cloud_row_by_id'] = function (b) {
    var t = JS.valueToCode(b, 'TABLE', JS.ORDER_ATOMIC) || q('表名');
    var id = JS.valueToCode(b, 'ROWID', JS.ORDER_ATOMIC) || q('');
    return ['await RT.cloudRowById(' + cloudIdCode(b) + ', ' + t + ', ' + id + ')', JS.ORDER_ATOMIC];
  };
  // 字段（列名 = 值）：堆叠在“新增一行 / 更新一行”内部，替代手写 JSON
  B.Blocks['cloud_field'] = {
    init: function () {
      this.appendValueInput('KEY').appendField('列名');
      this.appendValueInput('VAL').appendField('=');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null); this.setNextStatement(true, null);
      this.setColour(C_CLOUD);
      this.setTooltip('一个字段：左边填列名（文本），右边填值；叠放在“新增一行/更新一行”里');
    }
  };
  JS.forBlock['cloud_field'] = function (b) {
    var k = JS.valueToCode(b, 'KEY', JS.ORDER_ATOMIC) || q('列名');
    var v = JS.valueToCode(b, 'VAL', JS.ORDER_ATOMIC) || "''";
    return '__r[' + k + '] = ' + v + ';\n';
  };
  // （云表格▾）向表（）新增一行（字段堆叠）
  B.Blocks['cloud_add'] = {
    init: function () {
      this.appendValueInput('TABLE').appendField(cloudDropdown(), 'CLOUD').appendField('向表');
      this.appendDummyInput().appendField('新增一行：');
      this.appendStatementInput('FIELDS').setCheck(null);
      this.setInputsInline(true);
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_CLOUD);
      this.setTooltip('向数据表追加一行；把“字段”代码叠在里面，每个字段一对列名和值，不用手写 JSON');
    }
  };
  JS.forBlock['cloud_add'] = function (b) {
    var t = JS.valueToCode(b, 'TABLE', JS.ORDER_ATOMIC) || q('表名');
    return 'await RT.cloudAddRow(' + cloudIdCode(b) + ', ' + t + ', ' + fieldObjectCode(b, 'FIELDS') + ');\n';
  };
  // （云表格▾）更新表（）中行 Id 为（）的一行
  B.Blocks['cloud_update'] = {
    init: function () {
      this.appendValueInput('TABLE').appendField(cloudDropdown(), 'CLOUD').appendField('更新表');
      this.appendValueInput('ROWID').appendField('中行 Id 为');
      this.appendDummyInput().appendField('的一行，改为：');
      this.appendStatementInput('FIELDS').setCheck(null);
      this.setInputsInline(true);
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_CLOUD);
      this.setTooltip('按行 Id 更新一行；叠放“字段”代码指定要修改的列和新值');
    }
  };
  JS.forBlock['cloud_update'] = function (b) {
    var t = JS.valueToCode(b, 'TABLE', JS.ORDER_ATOMIC) || q('表名');
    var id = JS.valueToCode(b, 'ROWID', JS.ORDER_ATOMIC) || q('');
    return 'await RT.cloudUpdateRow(' + cloudIdCode(b) + ', ' + t + ', ' + id + ', ' + fieldObjectCode(b, 'FIELDS') + ');\n';
  };
  // （云表格▾）删除表（）中行 Id 为（）的行
  B.Blocks['cloud_delete'] = {
    init: function () {
      this.appendValueInput('TABLE').appendField(cloudDropdown(), 'CLOUD').appendField('删除表');
      this.appendValueInput('ROWID').appendField('中行 Id 为');
      this.appendDummyInput().appendField('的行');
      this.setInputsInline(true);
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(C_CLOUD);
      this.setTooltip('按行 Id 删除一行（不可恢复，建议先查询确认）');
    }
  };
  JS.forBlock['cloud_delete'] = function (b) {
    var t = JS.valueToCode(b, 'TABLE', JS.ORDER_ATOMIC) || q('表名');
    var id = JS.valueToCode(b, 'ROWID', JS.ORDER_ATOMIC) || q('');
    return 'await RT.cloudDeleteRow(' + cloudIdCode(b) + ', ' + t + ', ' + id + ');\n';
  };
  // 取（对象）的字段（）——读取云表格行里某一列
  B.Blocks['val_json_get'] = {
    init: function () {
      this.appendValueInput('OBJ').appendField('取');
      this.appendValueInput('KEY').appendField('的字段');
      this.setInputsInline(true);
      this.setOutput(true, null); this.setColour(C_CLOUD);
      this.setTooltip('从云表格返回的一行数据里取某一列的值，字段名填列名，如“名称”；取行 Id 用“_id”');
    }
  };
  JS.forBlock['val_json_get'] = function (b) {
    var o = JS.valueToCode(b, 'OBJ', JS.ORDER_ATOMIC) || 'null';
    var k = JS.valueToCode(b, 'KEY', JS.ORDER_ATOMIC) || q('');
    return ['RT.jsonGet(' + o + ', ' + k + ')', JS.ORDER_ATOMIC];
  };

  // 转换为 文本 / 数字 / 布尔值
  B.Blocks['val_cast'] = {
    init: function () {
      this.appendValueInput('V')
        .appendField('转换为')
        .appendField(new B.FieldDropdown([['文本', 'String'], ['数字', 'Number'], ['布尔值', 'Boolean']]), 'TYPE');
      this.setInputsInline(true);
      this.setOutput(true, null);
      this.setColour(C_VAL);
      this.setTooltip('把任意值转换成指定类型：文本=加引号的字符串；数字=可计算的数；布尔值=真/假');
    }
  };
  JS.forBlock['val_cast'] = function (b) {
    var fn = b.getFieldValue('TYPE') || 'String';
    var v = JS.valueToCode(b, 'V', JS.ORDER_ATOMIC);
    if (!v) v = fn === 'Number' ? '0' : fn === 'Boolean' ? 'false' : '""';
    return [fn + '(' + v + ')', JS.ORDER_FUNCTION_CALL];
  };

  /* 把 ● ， ● 和 ● 放在一起：组合成一个数组（数据列表）。
     齿轮 +/− 增减圆圈数量（最少 2 个），圆圈之间用逗号连接，最后一个前用“和”。 */
  B.Blocks['val_group'] = {
    init: function () {
      this.itemCount_ = 2;
      this.setInputsInline(true);
      this.setColour(C_VAL);
      this.setOutput(true, 'Array');
      this.updateShape_();
      this.setMutator(new B.icons.MutatorIcon(['val_group_item'], this));
      this.setTooltip('把多个值放在一起，组成一个列表（数组），可整体喂给“设置列表数据”等代码');
    },
    mutationToDom: function () {
      var x = B.utils.xml.createElement('mutation');
      x.setAttribute('items', String(this.itemCount_));
      return x;
    },
    domToMutation: function (x) {
      this.itemCount_ = Math.max(2, parseInt(x.getAttribute('items'), 10) || 2);
      this.updateShape_();
    },
    saveExtraState: function () { return { itemCount: this.itemCount_ }; },
    loadExtraState: function (s) {
      this.itemCount_ = Math.max(2, (s && s.itemCount) | 0);
      this.updateShape_();
    },
    updateShape_: function () {
      var i;
      for (i = 0; i < this.itemCount_; i++) {
        if (!this.getInput('ADD' + i)) {
          this.appendValueInput('ADD' + i).setAlign(B.Input.Align.RIGHT);
        }
      }
      // 各圆圈前的连接词：0=“把”，末尾=“和”，其余=“，”
      for (i = 0; i < this.itemCount_; i++) {
        var want = i === 0 ? '把' : (i === this.itemCount_ - 1 ? '和' : '，');
        var f = this.getField('SEP' + i);
        if (!f) this.getInput('ADD' + i).insertFieldAt(0, want, 'SEP' + i);
        else if (f.getText() !== want) f.setValue(want);
      }
      // 删除多余的尾部圆圈
      i = this.itemCount_;
      while (this.getInput('ADD' + i)) this.removeInput('ADD' + i);
    }
  };
  JS.forBlock['val_group'] = function (b) {
    var parts = [];
    for (var i = 0; i < b.itemCount_; i++) {
      parts.push(JS.valueToCode(b, 'ADD' + i, JS.ORDER_ATOMIC) || 'null');
    }
    return ['[' + parts.join(', ') + ']', JS.ORDER_ATOMIC];
  };

  /* ===== 云列表分类浮层：顶部两个按钮（创建/管理），未创建时只显示提示 ===== */
  window.BB_cloudFlyout = function () {
    var items = [
      { kind: 'button', text: '＋ 创建 SeaTable 云列表', callbackKey: 'BB_CLOUD_CREATE' },
      { kind: 'button', text: '⚙ 管理 SeaTable 云列表', callbackKey: 'BB_CLOUD_MANAGE' }
    ];
    var cs = projectClouds();
    if (!cs.length) {
      items.push({ kind: 'label', text: '还没有云表格，点上方按钮创建' });
      return items;
    }
    function blk(blockType, extras) {
      return { kind: 'block', blockxml: '<block type="' + blockType + '"><field name="CLOUD">' + cs[0].id + '</field>' + (extras || '') + '</block>' };
    }
    items.push(blk('cloud_tables'));
    items.push(blk('cloud_rows', txtSh('TABLE', '表名')));
    items.push(blk('cloud_sql', txtSh('SQL', 'SELECT * FROM `表名`')));
    items.push(blk('cloud_count', txtSh('TABLE', '表名')));
    items.push(blk('cloud_row_by_id', txtSh('TABLE', '表名') + txtSh('ROWID', '行 Id')));
    items.push(blk('cloud_add', txtSh('TABLE', '表名')
      + '<statement name="FIELDS"><block type="cloud_field">' + txtSh('KEY', '列名') + txtSh('VAL', '值') + '</block></statement>'));
    items.push(blk('cloud_update', txtSh('TABLE', '表名') + txtSh('ROWID', '行 Id')
      + '<statement name="FIELDS"><block type="cloud_field">' + txtSh('KEY', '列名') + txtSh('VAL', '新值') + '</block></statement>'));
    items.push(blk('cloud_delete', txtSh('TABLE', '表名') + txtSh('ROWID', '行 Id')));
    items.push({ kind: 'block', blockxml: '<block type="cloud_field">' + txtSh('KEY', '列名') + txtSh('VAL', '值') + '</block>' });
    items.push({ kind: 'block', blockxml: '<block type="val_json_get">' + txtSh('OBJ', '一行数据') + txtSh('KEY', '列名') + '</block>' });
    return items;
  };

  /* ---------------- 按控件类型生成“专属分类”的变体代码 ----------------
     同一动作（设置文本/显示/隐藏/透明度/颜色/点击…）针对不同控件类型各生成一个块，
     组件下拉只列出该类型的控件，方便快速找到。旧的通用块仍保留定义以兼容老工程。 */
  var CONTROL_GROUPS = [
    { key: 'button',   label: '按钮',   types: ['button'],   colour: '#1565C0', shapes: ['click', 'settext', 'setbg', 'setfg', 'btnstyle', 'show', 'hide', 'opacity', 'rot', 'enable', 'disable'] },
    { key: 'text',     label: '文字',   types: ['text'],     colour: '#0277BD', shapes: ['click', 'settext', 'setfg', 'art', 'show', 'hide', 'opacity', 'rot', 'enable', 'disable'] },
    { key: 'input',    label: '输入框', types: ['input'],    colour: '#00838F', shapes: ['settext', 'gettext', 'sethint', 'setbg', 'setfg', 'skin', 'show', 'hide', 'opacity', 'rot', 'enable', 'disable'] },
    { key: 'list',     label: '列表',   types: ['list'],     colour: '#6A1B9A', shapes: ['setbg', 'skin', 'show', 'hide', 'opacity', 'rot', 'enable', 'disable'] },
    { key: 'image',    label: '图片',   types: ['image'],    colour: '#2E7D32', shapes: ['click', 'setbg', 'skin', 'show', 'hide', 'opacity', 'rot', 'enable', 'disable'] },
    { key: 'switch',   label: '开关',   types: ['switch'],   colour: '#EF6C00', shapes: ['click', 'show', 'hide', 'opacity', 'rot', 'enable', 'disable'] },
    { key: 'checkbox', label: '复选框', types: ['checkbox'], colour: '#AD1457', shapes: ['click', 'settext', 'setfg', 'show', 'hide', 'opacity', 'rot', 'enable', 'disable'] },
    { key: 'slider',   label: '滑块',   types: ['slider'],   colour: '#4527A0', shapes: ['show', 'hide', 'opacity', 'rot', 'enable', 'disable'] },
    { key: 'progress', label: '进度条', types: ['progress'], colour: '#00695C', shapes: ['show', 'hide', 'opacity', 'rot', 'enable', 'disable'] },
    { key: 'video',    label: '视频播放器', types: ['video'], colour: '#5D4037', shapes: ['show', 'hide', 'opacity', 'skin', 'rot', 'enable', 'disable'] },
    { key: 'audio',    label: '音频播放', types: ['audio'], colour: '#37474F', shapes: ['show', 'hide', 'opacity', 'skin', 'rot', 'enable', 'disable'] },
    { key: 'web',      label: '网页', types: ['web'], colour: '#1B5E20', shapes: ['show', 'hide', 'opacity', 'skin', 'rot', 'enable', 'disable'] },
    { key: 'select',   label: '下拉选择框', types: ['select'], colour: '#00695C', shapes: ['change', 'show', 'hide', 'opacity', 'setbg', 'rot', 'enable', 'disable'] },
    { key: 'radio',    label: '单选组', types: ['radio'], colour: '#283593', shapes: ['change', 'show', 'hide', 'opacity', 'setfg', 'rot', 'enable', 'disable'] },
    { key: 'date',     label: '日期', types: ['date'], colour: '#4E342E', shapes: ['change', 'show', 'hide', 'opacity', 'setbg', 'rot', 'enable', 'disable'] },
    { key: 'time',     label: '时间', types: ['time'], colour: '#4E342E', shapes: ['change', 'show', 'hide', 'opacity', 'setbg', 'rot', 'enable', 'disable'] },
    { key: 'stepper',  label: '步进器', types: ['stepper'], colour: '#37474F', shapes: ['change', 'show', 'hide', 'opacity', 'rot', 'enable', 'disable'] },
    { key: 'timer',    label: '计时器', types: ['timer'], colour: '#00838F', shapes: ['change', 'show', 'hide', 'opacity', 'setfg', 'rot', 'enable', 'disable'] },
    { key: 'canvas',   label: '画布', types: ['canvas'], colour: '#4527A0', shapes: ['click', 'show', 'hide', 'opacity', 'setbg', 'rot', 'enable', 'disable'] },
    { key: 'imgbtn',   label: '图片按钮', types: ['imgbtn'], colour: '#2E7D32', shapes: ['click', 'show', 'hide', 'opacity', 'btnstyle', 'rot', 'enable', 'disable'] },
    { key: 'card',     label: '卡片', types: ['card'], colour: '#546E7A', shapes: ['click', 'show', 'hide', 'opacity', 'setbg', 'rot', 'enable', 'disable'] },
    { key: 'divider',  label: '分隔线', types: ['divider'], colour: '#78909C', shapes: ['show', 'hide', 'opacity', 'setbg'] },
    { key: 'spacer',   label: '空白占位', types: ['spacer'], colour: '#90A4AE', shapes: ['show', 'hide'] },
    { key: 'container', label: '容器',  types: ['container'], colour: '#546E7A', shapes: ['click', 'show', 'hide', 'opacity', 'setbg', 'rot', 'enable', 'disable'] },
    { key: 'table',    label: '表格',   types: ['table'],    colour: '#3E2723', shapes: ['click', 'show', 'hide', 'opacity', 'setbg', 'setfg', 'rot', 'enable', 'disable'] },
    { key: 'chart',    label: '图表',   types: ['chart'],    colour: '#3E2723', shapes: ['click', 'show', 'hide', 'opacity', 'setbg', 'rot', 'enable', 'disable'] }
  ];
  function prevNext(b) { b.setPreviousStatement(true); b.setNextStatement(true); }
  var SHAPE_BUILD = {
    click: function (types) {
      this.appendDummyInput().appendField('当').appendField(compField(types), 'COMP').appendField('被点击');
      this.hat = 'cap'; this.setNextStatement(true);
      this.setTooltip('点击该' + this._grpLabel + '时执行；程序入口，上面不能接代码，要执行的代码接在下方');
    },
    settext: function (types) {
      this.appendValueInput('VALUE').appendField('设置').appendField(compField(types), 'COMP').appendField('文本为');
      this.setInputsInline(true); prevNext(this);
    },
    gettext: function (types) {
      this.appendDummyInput().appendField(compField(types), 'COMP').appendField('的文本');
      this.setOutput(true, null);
    },
    sethint: function (types) {
      this.appendValueInput('VALUE').appendField('设置').appendField(compField(types), 'COMP').appendField('提示词为');
      this.setInputsInline(true); prevNext(this);
    },
    show: function (types) { this.appendDummyInput().appendField('显示').appendField(compField(types), 'COMP'); prevNext(this); },
    hide: function (types) { this.appendDummyInput().appendField('隐藏').appendField(compField(types), 'COMP'); prevNext(this); },
    opacity: function (types) {
      this.appendValueInput('V').appendField('设置').appendField(compField(types), 'COMP').appendField('透明度(0~100)为');
      this.setInputsInline(true); prevNext(this);
    },
    setbg: function (types) {
      this.appendValueInput('COLOR').appendField('设置').appendField(compField(types), 'COMP').appendField('背景色为');
      this.setInputsInline(true); prevNext(this);
    },
    setfg: function (types) {
      this.appendValueInput('COLOR').appendField('设置').appendField(compField(types), 'COMP').appendField('文字颜色为');
      this.setInputsInline(true); prevNext(this);
    },
    btnstyle: function (types) {
      this.appendDummyInput().appendField('设置').appendField(compField(types), 'COMP').appendField('按钮风格为')
        .appendField(new B.FieldDropdown([
          ['实心（默认）', ''], ['磨砂玻璃', 'glass'], ['描边', 'outline'], ['幽灵（纯文字）', 'ghost'],
          ['渐变', 'gradient'], ['全圆角胶囊', 'capsule'], ['立体阴影', 'shadow']
        ]), 'STYLE');
      prevNext(this);
    },
    skin: function (types) {
      this.appendDummyInput().appendField('设置').appendField(compField(types), 'COMP').appendField('外观为')
        .appendField(new B.FieldDropdown([
          ['普通', ''], ['磨砂玻璃', 'glass'], ['描边', 'outline'], ['立体阴影', 'shadow']
        ]), 'SKIN');
      prevNext(this);
    },
    art: function (types) {
      this.appendDummyInput().appendField('设置').appendField(compField(types), 'COMP').appendField('文字特效为')
        .appendField(new B.FieldDropdown([
          ['普通', ''], ['描边空心', 'stroke'], ['阴影', 'shadow'], ['霓虹发光', 'neon'],
          ['渐变彩色', 'gradient'], ['立体浮雕', 'emboss']
        ]), 'ART');
      prevNext(this);
    }
  };
  SHAPE_BUILD['rot'] = function (types) {
    this.appendValueInput('V').appendField('设置').appendField(compField(types), 'COMP').appendField('旋转角度(°)为');
    this.setInputsInline(true);
    prevNext(this);
  };
  SHAPE_BUILD['change'] = function (types) {
    this.appendDummyInput().appendField('当').appendField(compField(types), 'COMP').appendField('的值变了');
    this.hat = 'cap'; this.setNextStatement(true);
  };
  SHAPE_BUILD['enable'] = function (types) {
    this.appendDummyInput().appendField('启用').appendField(compField(types), 'COMP');
    prevNext(this);
  };
  SHAPE_BUILD['disable'] = function (types) {
    this.appendDummyInput().appendField('禁用').appendField(compField(types), 'COMP');
    prevNext(this);
  };
  var SHAPE_GEN = {
    click: JS.forBlock['ev_click'], settext: JS.forBlock['act_set_text'], gettext: JS.forBlock['val_get_text'],
    sethint: JS.forBlock['act_set_hint'],
    show: JS.forBlock['act_show'], hide: JS.forBlock['act_hide'], opacity: JS.forBlock['act_opacity'],
    setbg: JS.forBlock['act_set_bg'], setfg: JS.forBlock['act_set_color'],
    btnstyle: JS.forBlock['act_set_btnstyle'], skin: JS.forBlock['act_set_skin'], art: JS.forBlock['act_set_art'],
    enable: JS.forBlock['act_enable'], disable: JS.forBlock['act_disable'], change: JS.forBlock['ev_change'],
    rot: JS.forBlock['act_set_rot']
  };
  function vtype(key, shape) { return 'v_' + key + '_' + shape; }
  CONTROL_GROUPS.forEach(function (g) {
    g.shapes.forEach(function (shape) {
      var type = vtype(g.key, shape);
      B.Blocks[type] = {
        init: function () { this._grpLabel = g.label; SHAPE_BUILD[shape].call(this, g.types); this.setColour(g.colour); }
      };
      JS.forBlock[type] = SHAPE_GEN[shape];
    });
  });

  /* ---------------- 事件驱动代码生成 ----------------
     规则：只有顶部的“事件帽子块”(ev_*) 是程序入口；只有接在事件帽块下方的代码会执行。
     单独散落在画布上、没有接到任何事件的代码一律不生成代码（不会运行）。 */
  function isEventHat(b) {
    var t = b && typeof b.type === 'string' ? b.type : '';
    // 事件帽子：内置 ev_* 入口，以及按控件生成的“当…被点击”变体代码 v_<控件>_click
    return t.indexOf('ev_') === 0 || /^v_[a-z]+_click$/.test(t);
  }
  // 供编辑器侧旧工程迁移时识别事件帽类型
  window.isEventHatType = function (type) {
    return typeof type === 'string' && (type.indexOf('ev_') === 0 || /^v_[a-z]+_click$/.test(type));
  };

  window.generateEventCode = function (ws) {
    JS.init(ws);
    var out = [];
    var tops = ws.getTopBlocks(true); // 有序的顶层代码
    /* 段号 = 这块在所有顶层代码里的序号（与 AI 看到的"第 N 段"完全一致）。
       生成的代码里每段开头插一句 RT.__seg(N)：运行时一出错就知道是第几段，
       AI 才能直接说"是第 3 段的问题"而不是让用户自己找。 */
    var 全部顶层 = [];
    for (var ti = 0; ti < tops.length; ti++) {
      var tt = tops[ti];
      if (tt && !(tt.isShadow && tt.isShadow())) 全部顶层.push(tt);
    }
    /* 函数定义必须先"过一遍生成器"：Blockly 的 JS 生成器是在生成定义块时才把函数写进
       definitions_，最后由 JS.finish() 统一输出。定义块不是事件帽子，如果跳过它，
       画布上定义了函数却不会出现在生成的代码里（调用也就成了未定义）。 */
    for (var d = 0; d < tops.length; d++) {
      var tb = tops[d];
      if (tb && typeof tb.type === 'string' && tb.type.indexOf('procedures_def') === 0) {
        try { JS.blockToCode(tb); } catch (e) {}
      }
    }
    for (var i = 0; i < tops.length; i++) {
      var b = tops[i];
      if (!isEventHat(b)) continue;          // 非事件入口：跳过，散落代码不执行
      // 直接调用帽块生成器：它内部已把 next 链包进回调；不能走 JS.blockToCode(b)，
      // 否则生成器会把 next 链在回调闭合括号外再自动拼接一遍（代码重复）。
      var fn = JS.forBlock[b.type];
      var code = typeof fn === 'function' ? fn.call(b, b, JS) : JS.blockToCode(b);
      if (Array.isArray(code)) code = code[0];
      if (code) out.push('RT.__seg(' + 全部顶层.indexOf(b) + ');\n' + code);
    }
    var res = out.join('\n');
    res = JS.finish(res);
    res = res.replace(/^\s+\n/, '').replace(/\n\s+$/, '\n').replace(/[ \t]+\n/g, '\n');
    // 注册本工程登记的全部云表格（同步写入运行时连接池，密钥随工程导出）
    var prefix = projectClouds().map(function (c) {
      var cfg = { name: c.name, provider: c.provider, server: c.server, uuid: c.uuid, token: c.token };
      return 'RT.cloudRegister(' + q(c.id) + ', ' + JSON.stringify(cfg) + ');';
    }).join('\n');
    return prefix ? (prefix + '\n' + res) : res;
  };

  /* ---------------- 工具箱（按控件类型分“专属分类”，便于快速找到对应代码） ---------------- */
  function plain(t) { return '<block type="' + t + '"/>'; }
  function numSh(input, val) { return '<value name="' + input + '"><shadow type="math_number"><field name="NUM">' + val + '</field></shadow></value>'; }
  function txtSh(input, val) { return '<value name="' + input + '"><shadow type="text"><field name="TEXT">' + val + '</field></shadow></value>'; }
  function colSh(input, hex) { return '<value name="' + input + '"><shadow type="colour_picker"><field name="COLOUR">' + hex + '</field></shadow></value>'; }
  function boolSh(input, bool) { return '<value name="' + input + '"><shadow type="logic_boolean"><field name="BOOL">' + bool + '</field></shadow></value>'; }
  function vfrag(key, shape) {
    var t = vtype(key, shape);
    if (shape === 'settext') return '<block type="' + t + '">' + txtSh('VALUE', '文本') + '</block>';
    if (shape === 'sethint') return '<block type="' + t + '">' + txtSh('VALUE', '请输入') + '</block>';
    if (shape === 'setbg') return '<block type="' + t + '">' + colSh('COLOR', '#6750A4') + '</block>';
    if (shape === 'setfg') return '<block type="' + t + '">' + colSh('COLOR', '#000000') + '</block>';
    if (shape === 'opacity') return '<block type="' + t + '">' + numSh('V', '100') + '</block>';
    return plain(t);
  }
  var GROUP_EXTRA = {
    list: {
      head: [plain('ev_itemclick')],
      tail: ['<block type="act_list_add">' + txtSh('VALUE', '新项') + '</block>', plain('act_list_set'),
        plain('act_list_clear'), plain('val_selected_item'), plain('val_selected_index')]
    },
    switch: { head: [], tail: ['<block type="act_set_checked">' + boolSh('VALUE', 'TRUE') + '</block>', plain('val_get_checked')] },
    select: { head: [plain('ev_change')], tail: ['<block type="val_comp_value"/>', '<block type="act_comp_set">' + txtSh('VALUE', '选项一') + '</block>'] },
    radio: { head: [plain('ev_change')], tail: ['<block type="val_comp_value"/>', '<block type="act_comp_set">' + txtSh('VALUE', '选项一') + '</block>'] },
    date: { head: [plain('ev_change')], tail: ['<block type="val_comp_value"/>', '<block type="act_comp_set">' + txtSh('VALUE', '2025-01-01') + '</block>'] },
    time: { head: [plain('ev_change')], tail: ['<block type="val_comp_value"/>', '<block type="act_comp_set">' + txtSh('VALUE', '08:30') + '</block>'] },
    stepper: { head: [plain('ev_change')], tail: ['<block type="val_comp_number"/>', '<block type="act_comp_set">' + numSh('VALUE', '5') + '</block>', plain('val_get_slider')] },
    timer: { head: [plain('ev_change')], tail: ['<block type="act_timer_start">' + numSh('SECS', '10') + '</block>',
        plain('act_timer_countup'), plain('act_timer_stop'), plain('val_timer_value')] },
    canvas: { head: [plain('ev_click')], tail: [plain('act_canvas_clear'),
        '<block type="act_canvas_line">' + numSh('X1','0') + numSh('Y1','0') + numSh('X2','100') + numSh('Y2','100') + colSh('COLOR', '#6750A4') + '</block>',
        '<block type="act_canvas_rect">' + numSh('X','20') + numSh('Y','20') + numSh('W','80') + numSh('H','60') + colSh('COLOR', '#1565C0') + '</block>',
        '<block type="act_canvas_circle">' + numSh('X','80') + numSh('Y','80') + numSh('R','30') + colSh('COLOR', '#FB8C00') + '</block>',
        '<block type="act_canvas_text">' + txtSh('TEXT', '你好') + numSh('X','10') + numSh('Y','24') + numSh('SIZE','18') + colSh('COLOR', '#000000') + '</block>'] },
    imgbtn: { head: [plain('ev_click')], tail: [] },
    card: { head: [plain('ev_click')], tail: [] },
    table: { head: [plain('ev_click')], tail: ['<block type="act_set_data">' + txtSh('VALUE', '名称,数量\n苹果,3') + '</block>'] },
    chart: { head: [plain('ev_click')], tail: ['<block type="act_set_data">' + txtSh('VALUE', '一月,30\n二月,60') + '</block>'] },
    checkbox: { head: [], tail: ['<block type="act_set_checked">' + boolSh('VALUE', 'TRUE') + '</block>', plain('val_get_checked')] },
    slider: { head: [plain('ev_slider_change')], tail: ['<block type="act_set_slider">' + numSh('VALUE', '50') + '</block>', plain('val_get_slider')] },
    progress: { head: [], tail: ['<block type="act_set_progress">' + numSh('VALUE', '50') + '</block>', plain('val_get_progress')] },
    video: { head: [], tail: [plain('act_video_play'), plain('act_video_pause'), plain('act_video_seek'), '<block type="act_video_src">' + txtSh('URL', 'https://视频地址.mp4') + '</block>'] },
    audio: { head: [], tail: [plain('act_audio_play'), plain('act_audio_pause'), plain('act_audio_seek'), '<block type="act_audio_src">' + txtSh('URL', 'https://音频地址.mp3') + '</block>'] },
    web: { head: [], tail: ['<block type="act_web_url">' + txtSh('URL', 'https://example.com') + '</block>'] }
  };
  function groupCategory(g) {
    var xml = '<category name="' + g.label + '" colour="' + g.colour + '">';
    var ex = GROUP_EXTRA[g.key] || { head: [], tail: [] };
    ex.head.forEach(function (f) { xml += f; });
    g.shapes.forEach(function (s) { xml += vfrag(g.key, s); });
    ex.tail.forEach(function (f) { xml += f; });
    return xml + '</category>';
  }

  // usedTypes：工程里实际出现的控件类型 Set；只显示对应分类，避免代码栏臃肿。
  // usedTypes 为 null 时全部显示（兜底/空工程首次打开）。
  /* ===== 网络请求（路线图 1.2）：GET / POST + 取 JSON 字段 ===== */
  B.Blocks['act_http_get'] = {
    init: function () {
      this.appendValueInput('URL').appendField('读取网址');
      this.appendDummyInput().appendField('结果显示到').appendField(compField(), 'COMP');
      this.setInputsInline(true);
      this.setPreviousStatement(true); this.setNextStatement(true);
      this.setColour(C_CLOUD);
      this.setTooltip('向这个网址发起 GET 请求，把返回的文字显示到指定控件（最多 500 字）');
    }
  };
  JS.forBlock['act_http_get'] = function (b) {
    var u = JS.valueToCode(b, 'URL', JS.ORDER_ATOMIC) || "''";
    return 'RT.setText(' + q(b.getFieldValue('COMP')) + ', String(await RT.httpGet(' + u + ')).slice(0, 500));\n';
  };
  B.Blocks['act_http_post'] = {
    init: function () {
      this.appendValueInput('URL').appendField('提交到网址');
      this.appendValueInput('BODY').appendField('内容');
      this.setPreviousStatement(true); this.setNextStatement(true);
      this.setColour(C_CLOUD);
      this.setTooltip('把内容以 JSON 形式 POST 提交给服务器');
    }
  };
  JS.forBlock['act_http_post'] = function (b) {
    var u = JS.valueToCode(b, 'URL', JS.ORDER_ATOMIC) || "''";
    var d = JS.valueToCode(b, 'BODY', JS.ORDER_ATOMIC) || "''";
    return 'await RT.httpPost(' + u + ', ' + d + ');\n';
  };
  B.Blocks['val_http_json'] = {
    init: function () {
      this.appendValueInput('TEXT').appendField('从文本');
      this.appendValueInput('KEY').appendField('取字段');
      this.setInputsInline(true);
      this.setOutput(true, null);
      this.setColour(C_CLOUD);
      this.setTooltip('把服务器返回的 JSON 文本里某个字段取出来（取不到就是空）');
    }
  };
  JS.forBlock['val_http_json'] = function (b) {
    var t = JS.valueToCode(b, 'TEXT', JS.ORDER_ATOMIC) || "''";
    var k = JS.valueToCode(b, 'KEY', JS.ORDER_ATOMIC) || "''";
    return ['RT.jsonGet(' + t + ', ' + k + ')', JS.ORDER_FUNCTION_CALL];
  };

  /* ===== 滑屏（用户要求）：检测上/下/左/右滑 + 滑动距离 ===== */
  B.Blocks['ev_swipe'] = {
    init: function () {
      this.appendDummyInput()
        .appendField('当页面被')
        .appendField(new B.FieldDropdown([
          ['任意方向滑动', ''], ['向上滑', 'up'], ['向下滑', 'down'], ['向左滑', 'left'], ['向右滑', 'right']
        ]), 'DIR')
        .appendField('时');
      this.setColour(C_EVENT);
      this.hat = 'cap';
      this.setNextStatement(true);
      this.setTooltip('在页面上滑动手指时执行；可选只在某个方向触发。这是程序入口，上面不能接代码');
    }
  };
  JS.forBlock['ev_swipe'] = function (b) {
    return "RT.onSwipe(" + q(b.getFieldValue('DIR') || '') + ", async function(){\n" + hatBody(b) + "});\n";
  };
  B.Blocks['val_swipe_dist'] = {
    init: function () {
      this.appendDummyInput().appendField('这次滑动的距离（像素）');
      this.setOutput(true, 'Number');
      this.setColour(C_EVENT);
      this.setTooltip('最近一次滑动的直线距离，单位像素；没滑过是 0');
    }
  };
  JS.forBlock['val_swipe_dist'] = function () { return ['RT.swipeDistance()', JS.ORDER_FUNCTION_CALL]; };
  B.Blocks['val_swipe_dir'] = {
    init: function () {
      this.appendDummyInput().appendField('这次滑动的方向');
      this.setOutput(true, 'String');
      this.setColour(C_EVENT);
      this.setTooltip('最近一次滑动的方向：上滑 / 下滑 / 左滑 / 右滑；没滑过是空');
    }
  };
  JS.forBlock['val_swipe_dir'] = function () { return ['RT.swipeDirection()', JS.ORDER_FUNCTION_CALL]; };

  /* ===== 相机 / 相册（用户要求）：选图或拍照，直接显示到图片控件 ===== */
  B.Blocks['act_pick_image'] = {
    init: function () {
      this.appendDummyInput()
        .appendField('拍照或选图，显示到')
        .appendField(compField(['image']), 'COMP');
      this.setPreviousStatement(true); this.setNextStatement(true);
      this.setColour('#546E7A');
      this.setTooltip('打开相机拍照（没有相机就打开相册），选好的图片显示到指定图片控件里');
    }
  };
  JS.forBlock['act_pick_image'] = function (b) {
    return 'await RT.pickImage(' + q(b.getFieldValue('COMP')) + ');\n';
  };

  /* ===== 表格 / 图表的数据（用户要求：控件扩展 —— 表格、图表） =====
     一个块搞定两个控件：运行时按控件类型自己判断格式。
       表格：第一行表头，其余每行一条，单元格用逗号
       图表：每行「名称,数值」或只写数值（逗号或换行分隔都行） */
  B.Blocks['act_set_data'] = {
    init: function () {
      this.appendDummyInput().appendField('把').appendField(compField(['table', 'chart']), 'COMP').appendField('的数据设为');
      this.appendValueInput('VALUE');
      this.setInputsInline(false);
      this.setPreviousStatement(true); this.setNextStatement(true);
      this.setColour('#3E2723');
      this.setTooltip('表格/图表的数据用文字写：表格第一行是表头、每行一条用逗号分开；图表每行写「名称,数值」');
    }
  };
  JS.forBlock['act_set_data'] = function (b) {
    var v = JS.valueToCode(b, 'VALUE', JS.ORDER_ATOMIC) || "''";
    return 'RT.setData(' + q(b.getFieldValue('COMP')) + ', ' + v + ');\n';
  };

  function buildToolboxXml(usedTypes) {
    var x = '<xml xmlns="https://developers.google.com/blockly/xml">';
    x += '<category name="事件" colour="#FB8C00"><block type="ev_start"/><block type="ev_first_start"/>'
      + '<block type="ev_swipe"/>'
      + '<block type="val_swipe_dist"/><block type="val_swipe_dir"/></category>';
    CONTROL_GROUPS.forEach(function (g) {
      // usedTypes 为 null 时才全显示（兜底）；空 Set（工程里一个控件都没有）必须一个分类都不显示，
      // 否则空工程会错误地列出全部控件代码类型。
      if (usedTypes && !g.types.some(function (t) { return usedTypes.has(t); })) return;
      x += groupCategory(g);
    });
    x += '<category name="页面" colour="#0B57D0">'
      + '<block type="act_toast">' + txtSh('MSG', '提示内容') + numSh('DUR', '2') + '</block>'
      + plain('act_goto') + plain('act_back') + '</category>';
    x += '<category name="设备" colour="#546E7A">'
      + plain('val_device_info')
      + '<block type="act_vibrate">' + numSh('MS', '30') + '</block>'
      + '<block type="act_set_brightness">' + numSh('V', '80') + '</block>'
      + '<block type="act_keep_screen">' + boolSh('V', 'TRUE') + '</block>'
      + '<block type="act_copy">' + txtSh('V', '要复制的文字') + '</block>'
      + plain('act_exit')
      + plain('act_pick_image') + '</category>';
    x += '<category name="控制" colour="#607D8B">'
      + plain('controls_if')
      + '<block type="controls_repeat_ext">' + numSh('TIMES', '10') + '</block>'
      + plain('controls_whileUntil')
      + plain('controls_forEach')
      + '<block type="controls_for"><field name="VAR">i</field>'
      + numSh('FROM', '1') + numSh('TO', '10') + numSh('BY', '1') + '</block>'
      + '<block type="controls_flow_statements"><field name="FLOW">BREAK</field></block>'
      + '<block type="act_wait">' + numSh('SECS', '1') + '</block></category>';
    x += '<category name="逻辑" colour="#4CAF50">'
      + plain('logic_compare') + plain('logic_operation') + plain('logic_negate') + plain('logic_boolean')
      + plain('logic_null') + plain('logic_ternary') + '</category>';
    x += '<category name="数学" colour="#3F51B5">'
      + '<block type="math_number"><field name="NUM">0</field></block>'
      + plain('math_arithmetic') + plain('math_single') + plain('val_random_frac')
      + plain('math_round') + plain('math_modulo') + plain('math_trig') + plain('math_constant')
      + plain('math_number_property') + plain('math_constrain') + plain('math_on_list')
      + '<block type="val_random_int">' + numSh('MIN', '1') + numSh('MAX', '100') + '</block></category>';
    x += '<category name="文本" colour="#795548">'
      + '<block type="text"><field name="TEXT">文本</field></block>' + plain('text_join') + plain('text_length')
      + plain('text_changeCase') + plain('text_trim') + plain('text_isEmpty')
      + plain('text_indexOf') + plain('text_charAt') + plain('text_getSubstring') + plain('text_replace')
      + plain('val_cast') + '</category>';
    x += '<category name="数据列表" colour="#9C27B0">' + plain('lists_create_with') + plain('lists_length')
      + plain('lists_isEmpty') + plain('lists_repeat') + plain('lists_indexOf')
      + plain('lists_getIndex') + plain('lists_setIndex') + plain('lists_getSublist')
      + plain('lists_sort') + plain('lists_split')
      + plain('val_group') + '</category>';
    x += '<category name="云列表" colour="' + C_CLOUD + '" custom="BB_CLOUD"></category>';
    x += '<category name="网络" colour="#00897B">'
      + '<block type="act_http_get">' + txtSh('URL', 'https://') + '</block>'
      + '<block type="act_http_post">' + txtSh('URL', 'https://') + txtSh('BODY', '') + '</block>'
      + '<block type="val_http_json">' + txtSh('TEXT', '') + txtSh('KEY', 'name') + '</block>'
      + '</category>';
    x += '<category name="颜色" colour="#00ACC1">'
      + '<block type="colour_picker"><field name="COLOUR">#6750A4</field></block>' + plain('colour_rgb') + '</category>';
    x += '<category name="变量" colour="#EF6C00" custom="VARIABLE"></category>';
    // 函数：用 Blockly 自带的动态分类（自动列出"定义"和"调用"两栏；新建的定义会立刻出现在调用栏）
    x += '<category name="函数" colour="#7B1FA2" custom="PROCEDURE"></category>';
    x += '</xml>';
    return x;
  }
  window.TOOLBOX_XML = buildToolboxXml(null);   // 兜底；真正打开代码页时按工程实际控件重新生成
  window.buildToolboxXml = buildToolboxXml;

  /* ---------------- 供编辑器构建 M3 分类轨道：分组顺序 + 图标 ---------------- */
  window.BB_GROUPS = {
    widget: CONTROL_GROUPS.map(function (g) { return g.label; }),
    general: ['事件', '页面', '设备', '控制', '逻辑', '数学', '文本', '数据列表', '网络', '云列表', '颜色', '变量', '函数']
  };
  window.BB_CAT_ICON = {
    '按钮': 'Btn', '文字': 'Aa', '输入框': 'In', '列表': 'List', '图片': 'Img',
    '开关': 'Sw', '复选框': '✓', '滑块': 'Sl', '进度条': 'Pr',
    '视频播放器': '▶', '音频播放': '♪', '网页': 'W',
    '事件': '▶', '页面': '⇄', '设备': 'Dev', '控制': 'Ctl', '逻辑': '&',
    '数学': '∑', '文本': 'T', '数据列表': '[ ]', '网络': '⇅', '云列表': '☁', '颜色': '●', '变量': 'x'
  };

  /* ================= 使用帮助数据（帮助页右侧说明，顺序与工具箱完全一致） ================= */
  // 每个动作 shape 的通用说明；{c} 渲染时替换为控件分类名（按钮/文字/输入框…）
  var SHAPE_HELP = {
    click:   { sig: '当{c}被点击 / 执行…', desc: '事件帽子块（程序入口）。用户点击这个{c}时，依次执行叠在“执行”里的代码。', use: '从“执行”缺口里叠放动作代码，例如点击按钮后弹出提示、跳转页面。' },
    settext: { sig: '设置{c}文本为（文本）', desc: '修改这个{c}界面上显示的文字。', use: '在右侧缺口接入“文本”代码或变量，运行时即更新显示。' },
    gettext: { sig: '{c}的文本', desc: '取值代码（椭圆形），读取这个{c}当前显示/输入的文字。', use: '接到需要文本的缺口，例如“弹出提示（输入框的文本）”。' },
    sethint: { sig: '设置{c}提示词为（文本）', desc: '设置输入框为空时显示的浅色占位提示。', use: '接一段文本，如“请输入账号”，用于引导用户输入。' },
    setbg:   { sig: '设置{c}背景色为（颜色）', desc: '修改这个{c}的背景颜色。', use: '缺口接“颜色”分类里的颜色代码。' },
    setfg:   { sig: '设置{c}文字颜色为（颜色）', desc: '修改这个{c}上文字的颜色。', use: '缺口接颜色代码，可与背景色搭配。' },
    btnstyle: { sig: '设置{c}按钮风格为（下拉）', desc: '运行时切换按钮的个性化风格：磨砂玻璃、描边、幽灵纯文字、渐变、全圆角胶囊、立体阴影，选“实心（默认）”恢复。', use: '与设计页属性面板的“按钮风格”一致，可在运行时按条件切换。' },
    skin:    { sig: '设置{c}外观为（下拉）', desc: '运行时切换控件外观：磨砂玻璃、描边、立体阴影，选“普通”恢复。适用于输入框、列表、图片、视频、音频、网页。', use: '可在运行时按状态切换控件外观。' },
    art:     { sig: '设置{c}文字特效为（下拉）', desc: '运行时切换文字的艺术字效果：描边空心、阴影、霓虹发光、渐变彩色、立体浮雕，选“普通”恢复。', use: '霓虹在深色背景上效果最佳，可用于强调提示。' },
    show:    { sig: '显示{c}', desc: '让此前隐藏的{c}重新出现。', use: '常与“隐藏”配合，做条件显示界面。' },
    hide:    { sig: '隐藏{c}', desc: '把{c}从界面上隐藏（不删除，可用“显示”恢复）。', use: '例如登录前隐藏某按钮。' },
    opacity: { sig: '设置{c}透明度(0~100)为（数值）', desc: '调整{c}的不透明度：100 完全不透明，0 全透明。', use: '缺口接数字代码或滑块数值。' }
  };
  // 个别控件分类的专属代码
  var WIDGET_EXTRA_HELP = {
    list: [
      { sig: '当列表某项被点击 / 执行…', desc: '事件帽子块。用户点中列表里某一行时触发。', use: '配合“列表选中项/选中序号”读取被点中的内容。' },
      { sig: '给列表添加（项）', desc: '在列表末尾追加一项。', use: '缺口接文本，例如添加一条新留言。' },
      { sig: '设置列表数据为（列表）', desc: '用一个数据列表整体替换列表显示内容。', use: '接“数据列表”分类创建的列表。' },
      { sig: '清空列表', desc: '删除列表里的所有行。', use: '重置列表时使用。' },
      { sig: '列表选中项', desc: '取值代码，返回当前选中那一行的内容。', use: '接到文本缺口读取选中内容。' },
      { sig: '列表选中序号', desc: '取值代码，返回选中行的序号（数字）。', use: '序号常用于定位、删除。' }
    ],
    switch: [
      { sig: '设置开关状态为（真/假）', desc: '打开（真）或关闭（假）开关。', use: '缺口接“逻辑”里的 真/假 代码。' },
      { sig: '开关的状态', desc: '取值代码，返回开关当前是开（真）还是关（假）。', use: '接到“如果”条件里判断开关。' }
    ],
    checkbox: [
      { sig: '设置复选框状态为（真/假）', desc: '勾选（真）或取消勾选（假）复选框。', use: '缺口接 真/假 代码。' },
      { sig: '复选框的状态', desc: '取值代码，返回复选框是否被勾选（真/假）。', use: '用于“如果”条件判断。' }
    ],
    slider: [
      { sig: '当滑块数值变化时 / 执行…', desc: '事件帽子块。拖动滑块使数值改变时触发。', use: '在“执行”里用“滑块的数值”实时刷新界面。' },
      { sig: '设置滑块数值为（数值）', desc: '把滑块定位到指定数值。', use: '缺口接数字。' },
      { sig: '滑块的数值', desc: '取值代码，返回滑块当前数值。', use: '可接到透明度、进度、文本等数字缺口。' }
    ],
    progress: [
      { sig: '设置进度条进度为（数值）', desc: '设置进度条当前进度值。', use: '例如加载到 60%。' },
      { sig: '进度条的进度', desc: '取值代码，返回进度条当前进度。', use: '读取进度做判断或显示。' }
    ],
    video: [
      { sig: '播放视频 ▾', desc: '让指定视频播放器开始播放。', use: '放在按钮点击或页面启动事件里触发播放。' },
      { sig: '暂停视频 ▾', desc: '暂停指定视频的播放。', use: '与“播放视频”配合做暂停/继续。' },
      { sig: '设置视频 ▾ 地址为（文本）', desc: '把视频播放器切换到指定的视频地址（mp4 等网络链接）。', use: '缺口接文本网址，可用于根据条件切换不同视频。' },
      { sig: '跳转视频到 ▾ 秒（数值）', desc: '把视频跳到指定秒数的位置。', use: '如填 10 表示跳到第 10 秒。' }
    ],
    audio: [
      { sig: '播放音频 ▾', desc: '让指定音频开始播放。', use: '可做背景音乐、提示音。' },
      { sig: '暂停音频 ▾', desc: '暂停指定音频。', use: '与“播放音频”配合。' },
      { sig: '设置音频 ▾ 地址为（文本）', desc: '把音频切换到指定的音频地址（mp3 等网络链接）。', use: '缺口接文本网址。' },
      { sig: '跳转音频到 ▾ 秒（数值）', desc: '把音频跳到指定秒数的位置。', use: '如填 5 表示跳到第 5 秒。' }
    ],
    web: [
      { sig: '设置网页 ▾ 网址为（文本）', desc: '让指定网页控件加载指定网址。', use: '缺口接文本网址，可在运行时切换内嵌网页内容。' }
    ]
  };
  function buildWidgetHelp() {
    return CONTROL_GROUPS.map(function (g) {
      var blocks = g.shapes.map(function (s) {
        var h = SHAPE_HELP[s]; if (!h) return null;
        return { sig: h.sig.replace(/\{c\}/g, g.label), desc: h.desc.replace(/\{c\}/g, g.label), use: h.use.replace(/\{c\}/g, g.label) };
      }).filter(Boolean);
      if (WIDGET_EXTRA_HELP[g.key]) blocks = blocks.concat(WIDGET_EXTRA_HELP[g.key]);
      return { cat: g.label, colour: g.colour, blocks: blocks };
    });
  }
  window.BB_HELP = {
    general: [
      { cat: '事件', colour: '#FB8C00', blocks: [
        { sig: '▶ 当页面启动时 / 执行…', desc: '最常用的事件帽子块（程序入口）。每次进入该页面时自动运行一次。', use: '把页面打开就要执行的代码（初始化文字、加载云数据等）叠进“执行”。注意：只有接在事件帽子块下面的代码才会运行。' },
        { sig: '▶ 当页面首次启动时 / 执行…', desc: '事件帽子块。本次打开 App 期间，该页面第一次被打开时只执行一次；之后反复跳回本页面不会再执行。', use: '适合一次性初始化（只在第一次进入时跳转、只加载一次数据）。把 App 从后台彻底划掉后重新打开，会再次执行。想每次进入都执行，请用“当页面启动时”。' }
      ]},
      { cat: '页面', colour: '#0B57D0', blocks: [
        { sig: '弹出提示（文本）显示（秒）', desc: '在屏幕上方短暂显示一条小提示（Toast）。', use: '第一个缺口接文本，如“保存成功”；“显示秒数”接数字控制停留时长（可填小数，如 1.5），留空约 1.8 秒。' },
        { sig: '跳转到页面 ▾', desc: '切换到本 App 的另一个页面。', use: '点下拉选择目标页面，常用于按钮点击后翻页。新拖出的代码会自动选一个不是当前页的页面，避免“跳到自己”点了没反应；页面被删除后，指向它的代码会自动改为第一个页面。' },
        { sig: '返回上一页', desc: '回到上一个页面（等同系统返回）。', use: '用于“返回”按钮。注意：写在“当页面启动时”里的自动跳转不会占用返回栈（例如启动页自动进入主页后，按返回不会又被弹回启动页）；只有按钮等手动跳转才会。想做“返回首页”按钮，用这块比“跳转到页面”更合适。' }
      ]},
      { cat: '设备', colour: '#546E7A', blocks: [
        { sig: '设备 ▾（当前帧率/CPU/内存/电量/温度/网络…）', desc: '取值代码，下拉选择要读取的设备信息：当前帧率(FPS)、屏幕刷新率、CPU 核数/占用率、GPU 占用率、内存占用/总量/可用、电量、是否充电、电池/设备温度、网络类型、是否联网、亮度、屏幕宽高、型号、安卓版本、语言等。', use: '接到“弹出提示”“设置文本”等缺口显示，或接到“如果”做判断。帧率为 App 实际渲染帧率；CPU/GPU 占用、温度为实时采样，个别机型不支持 GPU 占用时返回 -1。' },
        { sig: '震动 毫秒（数值）', desc: '让手机震动指定毫秒数。', use: '缺口接数字，如 30 表示短震动。' },
        { sig: '设置屏幕亮度(0~100)为（数值）', desc: '调节本 App 的屏幕亮度，0 最暗、100 最亮。', use: '只影响本 App，不改系统设置；可配合滑块做亮度调节。' },
        { sig: '保持屏幕常亮（真/假）', desc: '接“真”时 App 运行期间屏幕不自动熄灭。', use: '常用于视频、展示类页面；接“假”恢复系统自动熄屏。' },
        { sig: '复制文本到剪贴板（文本）', desc: '把文字复制到手机剪贴板。', use: '之后可在其它应用粘贴，如复制订单号、链接。' },
        { sig: '退出应用', desc: '关闭并退出当前 App。', use: '一般放在“退出”按钮里。' }
      ]},
      { cat: '控制', colour: '#607D8B', blocks: [
        { sig: '如果（条件）那么…否则…', desc: '条件判断。条件成立执行“那么”，不成立执行“否则”。点齿轮可添加“否则如果/否则”。', use: '条件缺口接椭圆形逻辑代码，如“开关的状态 = 真”。' },
        { sig: '重复（次数）次', desc: '把里面的代码重复执行指定次数。', use: '次数接数字，内部放要循环的动作。' },
        { sig: '重复 当/直到（条件）', desc: '条件循环：满足条件时反复执行，或直到条件成立为止。', use: '注意“直到”型要确保条件最终会成立，否则会一直循环。' },
        { sig: '循环变量 i 从（数）到（数）步长（数）', desc: '计数循环，变量 i 依次取区间内的值。', use: '适合遍历固定次数，内部可用变量 i。' },
        { sig: '跳出循环', desc: '立即结束当前所在的循环。', use: '放在循环内部的“如果”里，满足条件时提前退出。' },
        { sig: '等待（秒）', desc: '暂停指定秒数后再继续执行后面的代码。', use: '接数字（可填小数，如 0.5），用于延时、动画间隔。' }
      ]},
      { cat: '逻辑', colour: '#4CAF50', blocks: [
        { sig: '（值）= / ≠ / < / >（值）', desc: '比较两个值，成立返回“真”，否则返回“假”。', use: '接到“如果”的条件缺口。' },
        { sig: '（条件）与 / 或（条件）', desc: '“与”要求两个条件都成立；“或”只要一个成立。', use: '组合多个判断条件。' },
        { sig: '不成立（条件）', desc: '逻辑取反：条件为假时返回真，为真时返回假。', use: '用于“如果不…”这类判断。' },
        { sig: '真 / 假', desc: '逻辑布尔值。', use: '接到需要真/假的缺口，如设置开关状态。' }
      ]},
      { cat: '数学', colour: '#3F51B5', blocks: [
        { sig: '数字 0', desc: '一个可编辑的数字代码。', use: '点数字即可修改，接到任何数字缺口。' },
        { sig: '（数）+ − × ÷（数）', desc: '四则运算，下拉可切换运算。', use: '两侧接数字代码。' },
        { sig: '平方根 / 绝对值 / 四舍五入…（数）', desc: '单值数学函数，下拉选择开方、绝对值、取整等。', use: '接一个数字，返回计算结果。' },
        { sig: '随机小数（0~1）', desc: '返回 0 到 1 之间的随机小数。', use: '用于概率、随机比例。' },
        { sig: '随机整数 从（数）到（数）', desc: '返回指定区间内的随机整数（含两端）。', use: '如从 1 到 6 模拟掷骰子。' }
      ]},
      { cat: '文本', colour: '#795548', blocks: [
        { sig: '“文本”', desc: '一段文字，点击即可编辑。', use: '接到任何需要文本的缺口；需要数字时不要用文本。' },
        { sig: '拼接（文本）（文本）…', desc: '把多段文本连成一段，点齿轮可增加项。', use: '如把“得分：”与分数变量拼成一句话。' },
        { sig: '文本长度（文本）', desc: '返回文字的字符个数。', use: '可校验输入框是否为空（长度为 0）。' },
        { sig: '转换为 文本/数字/布尔值（值）', desc: '把任意值转换成指定类型。', use: '数字拼成提示文本前先转文本；文本数字参与计算前先转数字。' }
      ]},
      { cat: '数据列表', colour: '#9C27B0', blocks: [
        { sig: '建立列表（项…）', desc: '创建一个列表，可放多个数据项，点齿轮增减项；留空即为空列表。', use: '整体接到“设置列表数据为”即可批量显示。' },
        { sig: '列表长度（列表）', desc: '返回列表里有多少项。', use: '接列表，返回数字。' },
        { sig: '把 ● ， ● 和 ● 放在一起', desc: '把多个值组合成一个列表，点齿轮增减圆圈数量（最少 2 个）。', use: '和“建立列表”效果相同，适合临时拼一组数据。' }
      ]},
      { cat: '云列表', colour: '#1E88E5', intro: '云列表对接 SeaTable 在线表格，可在多台设备间读写同一份数据。先在本分类点“创建 SeaTable 云列表”，选择服务器并填写表格名称、UUID 和 API 密钥；每个云表格代码上的“☁ 云表格▾”可切换要操作的表格。', blocks: [
        { sig: '＋ 创建 SeaTable 云列表（按钮）', desc: '打开创建弹窗，登记一个云表格连接（名称/服务器/UUID/API 密钥）。', use: '创建后本分类才会出现下面的云表格代码。' },
        { sig: '⚙ 管理 SeaTable 云列表（按钮）', desc: '查看、编辑或删除已登记的云表格连接。', use: '换密钥或不用了可在此管理。' },
        { sig: '（云表格▾）所有表格名称', desc: '取值，返回该云表格里所有数据表的名称列表。', use: '用于先确认要操作的表名。' },
        { sig: '（云表格▾）查询表（表名）的所有行', desc: '取值（异步），返回指定数据表的全部行。', use: '常配合循环与“取字段”逐行读取。' },
        { sig: '（云表格▾）SQL 查询（语句）', desc: '取值，用 SQL 语句灵活查询，如 SELECT * FROM `表名`。', use: '表名两侧用反引号 `，适合筛选/排序。' },
        { sig: '（云表格▾）表（表名）的行数', desc: '取值，返回该表的数据行数。', use: '用于统计记录总数。' },
        { sig: '（云表格▾）从表（表名）取行 Id 为（Id）的一行', desc: '取值，按行唯一 Id 取一整行。', use: '行 Id 用“取字段（行, _id）”获得。' },
        { sig: '（云表格▾）向表（表名）新增一行 / 字段…', desc: '动作。在“字段：”里叠放“字段 列名 = 值”代码，每块对应一列。', use: '无需手写 JSON，列名接文本、值接对应数据即可。' },
        { sig: '（云表格▾）更新表（表名）中行 Id 为（Id）的一行 / 改为…', desc: '动作。按行 Id 修改指定列，内部叠放“字段”代码。', use: '只改叠放了的列，其它列保持不变。' },
        { sig: '（云表格▾）删除表（表名）中行 Id 为（Id）的行', desc: '动作，按行 Id 删除一行，不可恢复。', use: '建议先查询确认 Id 再删除。' },
        { sig: '字段 列名（文本）= 值（任意）', desc: '一个字段对，只能叠在“新增一行/更新一行”的缺口里。', use: '左边填列名文本，右边填要写入的值。' },
        { sig: '取（一行）的字段（列名）', desc: '取值，从查询返回的一行里读取某一列；取行 Id 列名用 _id。', use: '如“取（某行）的字段（名称）”。' }
      ]},
      { cat: '颜色', colour: '#00ACC1', blocks: [
        { sig: '颜色选择器', desc: '一个颜色代码，点击可挑选颜色。', use: '接到背景色/文字颜色缺口。' },
        { sig: '红（数）绿（数）蓝（数）合成颜色', desc: '用 0~255 的三原色数值拼出颜色。', use: '可接滑块/数字做动态变色。' }
      ]},
      { cat: '变量', colour: '#EF6C00', intro: '变量用来保存会变化的数据（分数、名称、状态等）。先在分类里“新建变量”命名，再使用下列代码。', blocks: [
        { sig: '将（变量）设为（值）', desc: '把变量赋值，旧值被覆盖。', use: '初始化或重置变量时使用。' },
        { sig: '改变（变量）by（数值）', desc: '让数字变量增加（或负数减少）一个量。', use: '如“改变 分数 by 1”做加分。' },
        { sig: '（变量）的值', desc: '取值代码，读取变量当前内容。', use: '接到文本/数字/条件缺口参与运算或显示。' }
      ]}
    ],
    widget: buildWidgetHelp()
  };
})();
