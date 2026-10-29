/* ============================================================
   FAST · 二维码（纯前端离线生成，零依赖）
   编辑器与运行时共用：页面里 <script src="qr.js"></script> 之后即可
   调用 window.FAST_QR.encode(text) / window.FAST_QR.svg(text, px, dark, light)。

   编码参数：字节模式（UTF-8）、纠错等级 M、版本 1~10 自适应
   （v10-M 数据码字 216 字节，扣掉 4 位模式 + 16 位长度后最多 213 字节）。
   分组表（每版本 M 级：[组1块数, 组1数据码字, 组2块数, 组2数据码字, 每块纠错码字]）
   已用 python qrcode 8.2 的 RS_BLOCK_TABLE 反查核对：
     v1 (1,26,16) v2 (1,44,28) v3 (1,70,44) v4 (2,50,32) v5 (2,67,43)
     v6 (4,43,27) v7 (4,49,31) v8 (2,60,38)+(2,61,39)
     v9 (3,58,36)+(2,59,37) v10 (4,69,43)+(1,70,44)
   ============================================================ */
(function (g) {
  'use strict';

  /* ---------------- UTF-8 字节 ---------------- */

  function utf8Bytes(str) {
    var out = [], i, c, c2, cp;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xC0 | (c >> 6));
        out.push(0x80 | (c & 0x3F));
      } else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length &&
                 (c2 = str.charCodeAt(i + 1)) >= 0xDC00 && c2 <= 0xDFFF) {
        cp = ((c - 0xD800) << 10) + (c2 - 0xDC00) + 0x10000;
        out.push(0xF0 | (cp >> 18));
        out.push(0x80 | ((cp >> 12) & 0x3F));
        out.push(0x80 | ((cp >> 6) & 0x3F));
        out.push(0x80 | (cp & 0x3F));
        i++;
      } else {
        out.push(0xE0 | (c >> 12));
        out.push(0x80 | ((c >> 6) & 0x3F));
        out.push(0x80 | (c & 0x3F));
      }
    }
    return out;
  }

  /* ---------------- 版本 / 分组表 ---------------- */

  var EC_M = [
    [1, 16, 0,  0, 10],
    [1, 28, 0,  0, 16],
    [1, 44, 0,  0, 26],
    [2, 32, 0,  0, 18],
    [2, 43, 0,  0, 24],
    [4, 27, 0,  0, 16],
    [4, 31, 0,  0, 18],
    [2, 38, 2, 39, 22],
    [3, 36, 2, 37, 22],
    [4, 43, 1, 44, 26]
  ];

  var ALIGN = [
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50]
  ];

  function dataCodewords(ver) {
    var s = EC_M[ver - 1];
    return s[0] * s[1] + s[2] * s[3];
  }

  function chooseVersion(byteLen) {
    var v, bits, cnt;
    for (v = 1; v <= 10; v++) {
      cnt = v < 10 ? 8 : 16;
      bits = 4 + cnt + byteLen * 8;
      if (bits <= dataCodewords(v) * 8) return v;
    }
    return 0;
  }

  /* ---------------- 位缓冲 ---------------- */

  function BitBuffer() {
    this.bytes = [];
    this.length = 0;
  }

  BitBuffer.prototype.putBit = function (bit) {
    var idx = this.length >> 3;
    if (this.bytes.length <= idx) this.bytes.push(0);
    if (bit) this.bytes[idx] |= 0x80 >> (this.length & 7);
    this.length++;
  };

  BitBuffer.prototype.put = function (num, len) {
    for (var i = len - 1; i >= 0; i--) this.putBit((num >> i) & 1);
  };

  /* ---------------- 数据码字（含终止符 / 补齐） ---------------- */

  function makeData(bytes, ver) {
    var buf = new BitBuffer(), i, cap, pad, n;
    cap = dataCodewords(ver) * 8;
    buf.put(4, 4);                                  // 字节模式 0100
    buf.put(bytes.length, ver < 10 ? 8 : 16);       // 字符计数
    for (i = 0; i < bytes.length; i++) buf.put(bytes[i], 8);
    n = Math.min(4, cap - buf.length);              // 终止符
    for (i = 0; i < n; i++) buf.putBit(0);
    while (buf.length & 7) buf.putBit(0);           // 补齐到整字节
    pad = (cap - buf.length) >> 3;
    for (i = 0; i < pad; i++) buf.put(i % 2 ? 0x11 : 0xEC, 8);
    return buf.bytes;
  }

  /* ---------------- GF(256) / Reed-Solomon ---------------- */

  var GF_EXP = [], GF_LOG = [];

  (function () {
    var i, x = 1;
    for (i = 0; i < 255; i++) {
      GF_EXP[i] = x;
      GF_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;                    // 本原多项式 0x11D
    }
    for (i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return GF_EXP[GF_LOG[a] + GF_LOG[b]];
  }

  function rsGenPoly(ecLen) {
    var poly = [1], next, ai, i, j;
    for (i = 0; i < ecLen; i++) {
      ai = GF_EXP[i];
      next = [];
      for (j = 0; j <= poly.length; j++) next[j] = 0;
      for (j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], ai);
      }
      poly = next;
    }
    return poly;
  }

  function rsRemainder(data, gen) {
    var msg = data.slice(), ecLen = gen.length - 1, i, j, factor;
    for (i = 0; i < ecLen; i++) msg.push(0);
    for (i = 0; i < data.length; i++) {
      factor = msg[i];
      if (factor !== 0) {
        for (j = 0; j < gen.length; j++) msg[i + j] ^= gfMul(gen[j], factor);
      }
    }
    return msg.slice(data.length);
  }

  function splitAndInterleave(data, ver) {
    var spec = EC_M[ver - 1], gen = rsGenPoly(spec[4]);
    var blocks = [], out = [], maxDc = 0, offset = 0, i, b, dc, ec;
    for (i = 0; i < spec[0]; i++) {
      dc = data.slice(offset, offset + spec[1]);
      offset += spec[1];
      blocks.push([dc, rsRemainder(dc, gen)]);
    }
    for (i = 0; i < spec[2]; i++) {
      dc = data.slice(offset, offset + spec[3]);
      offset += spec[3];
      blocks.push([dc, rsRemainder(dc, gen)]);
    }
    for (i = 0; i < blocks.length; i++) {
      if (blocks[i][0].length > maxDc) maxDc = blocks[i][0].length;
    }
    for (i = 0; i < maxDc; i++) {
      for (b = 0; b < blocks.length; b++) {
        if (i < blocks[b][0].length) out.push(blocks[b][0][i]);
      }
    }
    for (i = 0; i < spec[4]; i++) {
      for (b = 0; b < blocks.length; b++) out.push(blocks[b][1][i]);
    }
    return out;
  }

  /* ---------------- 矩阵（功能图形 + 数据映射） ---------------- */

  function Matrix(ver) {
    var r, c, row, resRow;
    this.ver = ver;
    this.size = ver * 4 + 17;
    this.m = [];
    this.res = [];
    for (r = 0; r < this.size; r++) {
      row = [];
      resRow = [];
      for (c = 0; c < this.size; c++) { row.push(0); resRow.push(0); }
      this.m.push(row);
      this.res.push(resRow);
    }
  }

  Matrix.prototype.set = function (r, c, v, reserved) {
    this.m[r][c] = v;
    if (reserved) this.res[r][c] = 1;
  };

  Matrix.prototype.copy = function () {
    var out = new Matrix(this.ver), r, c;
    for (r = 0; r < this.size; r++) {
      for (c = 0; c < this.size; c++) {
        out.m[r][c] = this.m[r][c];
        out.res[r][c] = this.res[r][c];
      }
    }
    return out;
  };

  Matrix.prototype.finder = function (row, col) {
    var r, c, rr, cc, dark;
    for (r = -1; r <= 7; r++) {
      rr = row + r;
      if (rr < 0 || rr >= this.size) continue;
      for (c = -1; c <= 7; c++) {
        cc = col + c;
        if (cc < 0 || cc >= this.size) continue;
        dark = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
               (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
               (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        this.set(rr, cc, dark ? 1 : 0, true);
      }
    }
  };

  Matrix.prototype.alignment = function () {
    var pos = ALIGN[this.ver - 1], i, j, r, c, cr, cc, dark;
    for (i = 0; i < pos.length; i++) {
      for (j = 0; j < pos.length; j++) {
        cr = pos[i];
        cc = pos[j];
        if (this.res[cr][cc]) continue;
        for (r = -2; r <= 2; r++) {
          for (c = -2; c <= 2; c++) {
            dark = r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
            this.set(cr + r, cc + c, dark ? 1 : 0, true);
          }
        }
      }
    }
  };

  Matrix.prototype.timing = function () {
    var i;
    for (i = 8; i < this.size - 8; i++) {
      if (!this.res[i][6]) this.set(i, 6, i % 2 === 0 ? 1 : 0, true);
      if (!this.res[6][i]) this.set(6, i, i % 2 === 0 ? 1 : 0, true);
    }
  };

  Matrix.prototype.reserveFormat = function () {
    var size = this.size, i;
    for (i = 0; i < 15; i++) {
      if (i < 6) this.res[i][8] = 1;
      else if (i < 8) this.res[i + 1][8] = 1;
      else this.res[size - 15 + i][8] = 1;
    }
    for (i = 0; i < 15; i++) {
      if (i < 8) this.res[8][size - i - 1] = 1;
      else if (i < 9) this.res[8][7] = 1;
      else this.res[8][15 - i - 1] = 1;
    }
    this.res[size - 8][8] = 1;
  };

  Matrix.prototype.reserveVersion = function () {
    var size = this.size, i;
    for (i = 0; i < 18; i++) {
      this.res[Math.floor(i / 3)][i % 3 + size - 11] = 1;
      this.res[i % 3 + size - 11][Math.floor(i / 3)] = 1;
    }
  };

  Matrix.prototype.writeFormat = function (mask) {
    var size = this.size, bits = formatBits(mask), i, v;
    for (i = 0; i < 15; i++) {
      v = (bits >> i) & 1;
      if (i < 6) this.set(i, 8, v, true);
      else if (i < 8) this.set(i + 1, 8, v, true);
      else this.set(size - 15 + i, 8, v, true);
    }
    for (i = 0; i < 15; i++) {
      v = (bits >> i) & 1;
      if (i < 8) this.set(8, size - i - 1, v, true);
      else if (i < 9) this.set(8, 7, v, true);
      else this.set(8, 15 - i - 1, v, true);
    }
    this.set(size - 8, 8, 1, true);                 // 暗模块
  };

  Matrix.prototype.writeVersion = function () {
    var bits = versionBits(this.ver), size = this.size, i, v;
    for (i = 0; i < 18; i++) {
      v = (bits >> i) & 1;
      this.set(Math.floor(i / 3), i % 3 + size - 11, v, true);
      this.set(i % 3 + size - 11, Math.floor(i / 3), v, true);
    }
  };

  Matrix.prototype.mapData = function (cw, mask) {
    var bits = [], n = this.size, row = n - 1, inc = -1;
    var base, col, cc, c, bitIdx = 0, bit, i, k;
    for (i = 0; i < cw.length; i++) {
      for (k = 7; k >= 0; k--) bits.push((cw[i] >> k) & 1);
    }
    for (base = n - 1; base > 0; base -= 2) {
      col = base <= 6 ? base - 1 : base;            // 跳过第 6 列（时序）
      while (true) {
        for (cc = 0; cc < 2; cc++) {
          c = cc === 0 ? col : col - 1;
          if (!this.res[row][c]) {
            bit = bitIdx < bits.length ? bits[bitIdx] : 0;
            bitIdx++;
            if (maskFunc(mask, row, c)) bit = bit ? 0 : 1;
            this.m[row][c] = bit;
          }
        }
        row += inc;
        if (row < 0 || row >= n) {
          row -= inc;
          inc = -inc;
          break;
        }
      }
    }
  };

  /* ---------------- 掩码 / BCH ---------------- */

  function maskFunc(pattern, r, c) {
    var t;
    switch (pattern) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return (r * c) % 2 + (r * c) % 3 === 0;
      case 6: return ((r * c) % 2 + (r * c) % 3) % 2 === 0;
      default:
        t = r * c;
        return (t % 3 + (r + c) % 2) % 2 === 0;
    }
  }

  var G15 = 0x537, G18 = 0x1F25, G15_MASK = 0x5412;

  function bitLen(x) {
    var n = 0;
    while (x) { n++; x >>= 1; }
    return n;
  }

  function formatBits(mask) {
    var data = (0 << 3) | mask,                // 纠错等级 M 指示位 00
        d = data << 10, l;
    while ((l = bitLen(d) - bitLen(G15)) >= 0) d ^= G15 << l;
    return ((data << 10) | d) ^ G15_MASK;
  }

  function versionBits(ver) {
    var d = ver << 12, l;
    while ((l = bitLen(d) - bitLen(G18)) >= 0) d ^= G18 << l;
    return (ver << 12) | d;
  }

  /* ---------------- 罚分（N1/N2/N3/N4） ---------------- */

  function penalty(m) {
    var n = m.length, p = 0, r, c, run, prev, i, cnt;

    // N1：行/列连续同色 >= 5
    for (r = 0; r < n; r++) {
      prev = m[r][0];
      run = 0;
      for (c = 0; c < n; c++) {
        if (m[r][c] === prev) run++;
        else {
          if (run >= 5) p += run - 2;
          prev = m[r][c];
          run = 1;
        }
      }
      if (run >= 5) p += run - 2;
    }
    for (c = 0; c < n; c++) {
      prev = m[0][c];
      run = 0;
      for (r = 0; r < n; r++) {
        if (m[r][c] === prev) run++;
        else {
          if (run >= 5) p += run - 2;
          prev = m[r][c];
          run = 1;
        }
      }
      if (run >= 5) p += run - 2;
    }

    // N2：2x2 同色
    for (r = 0; r < n - 1; r++) {
      for (c = 0; c < n - 1; c++) {
        if (m[r][c] === m[r][c + 1] &&
            m[r][c] === m[r + 1][c] &&
            m[r][c] === m[r + 1][c + 1]) p += 3;
      }
    }

    // N3：1:1:3:1:1 + 四侧亮区（10111010000 / 00001011101）
    function scan(get) {
      for (var q = 0; q < n - 10; ) {
        if (!get(q + 1) && get(q + 4) && !get(q + 5) &&
            get(q + 6) && !get(q + 9) &&
            (get(q) && get(q + 2) && get(q + 3) &&
             !get(q + 7) && !get(q + 8) && !get(q + 10) ||
             !get(q) && !get(q + 2) && !get(q + 3) &&
             get(q + 7) && get(q + 8) && get(q + 10))) p += 40;
        q += get(q + 10) ? 2 : 1;
      }
    }
    for (r = 0; r < n; r++) {
      scan((function (rr) {
        return function (k) { return m[rr][k]; };
      })(r));
    }
    for (c = 0; c < n; c++) {
      scan((function (cc) {
        return function (k) { return m[k][cc]; };
      })(c));
    }

    // N4：深色比例偏离 50%
    cnt = 0;
    for (r = 0; r < n; r++) for (c = 0; c < n; c++) cnt += m[r][c];
    i = Math.floor(Math.abs(cnt / (n * n) * 100 - 50) / 5);
    p += i * 10;

    return p;
  }

  /* ---------------- 主流程 ---------------- */

  function buildBase(ver) {
    var m = new Matrix(ver), size = m.size;
    m.finder(0, 0);
    m.finder(0, size - 7);
    m.finder(size - 7, 0);
    m.alignment();
    m.timing();
    m.reserveFormat();
    if (ver >= 7) m.reserveVersion();
    return m;
  }

  function build(text) {
    if (text === null || text === undefined) return null;
    var s = typeof text === 'string' ? text : String(text);
    if (s.length === 0) return null;
    var bytes = utf8Bytes(s);
    if (bytes.length > 213) return null;
    var ver = chooseVersion(bytes.length);
    if (!ver) return null;
    var cw = splitAndInterleave(makeData(bytes, ver), ver);
    var base = buildBase(ver), best = 0, bestP = 0, pat, m, p, fin, r, c, rows, row;

    for (pat = 0; pat < 8; pat++) {
      m = base.copy();
      m.mapData(cw, pat);
      p = penalty(m.m);
      if (pat === 0 || p < bestP) { bestP = p; best = pat; }
    }

    fin = base.copy();
    fin.mapData(cw, best);
    fin.writeFormat(best);
    if (ver >= 7) fin.writeVersion();

    rows = [];
    for (r = 0; r < fin.size; r++) {
      row = [];
      for (c = 0; c < fin.size; c++) row.push(fin.m[r][c] === 1);
      rows.push(row);
    }
    return { size: fin.size, matrix: rows };
  }

  function encode(text) {
    try {
      return build(text);
    } catch (e) {
      return null;
    }
  }

  function escColor(s, fallback) {
    if (typeof s !== 'string' || !s) return fallback;
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function svg(text, px, dark, light) {
    var res = encode(text), n, total, w, parts, r, c, start, d;
    if (!res) return '';
    n = res.size;
    total = n + 8;                                   // quiet zone 4 模块
    w = Number(px);
    if (!isFinite(w) || w <= 0) w = 160;
    parts = [];
    for (r = 0; r < n; r++) {
      c = 0;
      while (c < n) {
        if (res.matrix[r][c]) {
          start = c;
          while (c < n && res.matrix[r][c]) c++;
          parts.push('M' + (start + 4) + ' ' + (r + 4) +
                     'h' + (c - start) + 'v1h-' + (c - start));
        } else {
          c++;
        }
      }
    }
    d = parts.join('');
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + w +
           '" viewBox="0 0 ' + total + ' ' + total +
           '" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges">' +
           '<rect x="0" y="0" width="' + total + '" height="' + total +
           '" fill="' + escColor(light, '#fff') + '"/>' +
           '<path d="' + d + '" fill="' + escColor(dark, '#000') + '"/>' +
           '</svg>';
  }

  g.FAST_QR = {
    encode: encode,
    svg: svg
  };

})(window);
