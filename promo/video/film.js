/* 花椒写作 · 产品宣传片 —— 纯 Canvas 分镜引擎
 * ────────────────────────────────────────────────
 * 画面 1920×1080，按时间轴逐帧绘制，不依赖任何视频/图片素材。
 * 播放：requestAnimationFrame 驱动时间；导出：canvas.captureStream + MediaRecorder 实时录制。
 */
(() => {
  'use strict';

  // ══════════════════════════ 1. 常量 ══════════════════════════
  const W = 1920;
  const H = 1080;
  const MARGIN = 140;

  const PAPER = '#f4efe7';
  const CARD = '#fffbf5';
  const INK = '#1a1612';
  const INK2 = '#3c342c';
  const MUTED = '#7a6e62';
  const LINE = 'rgba(26,22,18,0.12)';
  const PEPPER = '#c23b22';
  const PEPPER_DEEP = '#9a2c18';
  const PINE = '#3d5a4a';
  const GOLD = '#b08940';

  const SERIF = '"Noto Serif SC","Songti SC","STSong","SimSun",serif';
  const SANS = '"PingFang SC","Noto Sans SC","Microsoft YaHei",system-ui,sans-serif';

  // ══════════════════════════ 2. 数学与缓动 ══════════════════════════
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const outCubic = (t) => 1 - Math.pow(1 - t, 3);
  const outQuart = (t) => 1 - Math.pow(1 - t, 4);
  const inOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const outExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
  const outBack = (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  };

  /** 场内进度：st=场景内秒数，d=延迟，dur=时长 */
  const P = (st, d, dur = 0.7, ease = outCubic) => ease(clamp((st - d) / dur));

  const cubicPoint = (p0, p1, p2, p3, t) => {
    const u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    };
  };

  // ══════════════════════════ 3. 文本 ══════════════════════════
  const setFont = (ctx, o) => {
    ctx.font = `${o.weight || 400} ${o.size || 32}px ${o.font || SANS}`;
  };

  function textWidth(ctx, s, o = {}) {
    setFont(ctx, o);
    if (!o.tracking) return ctx.measureText(s).width;
    let w = 0;
    for (const ch of s) w += ctx.measureText(ch).width + o.tracking;
    return w - o.tracking;
  }

  /** 通用文本绘制（支持字距、透明度、对齐） */
  function txt(ctx, s, x, y, opt = {}) {
    const o = {
      size: 32,
      weight: 400,
      font: SANS,
      color: INK,
      alpha: 1,
      align: 'left',
      baseline: 'alphabetic',
      tracking: 0,
      ...opt,
    };
    if (o.alpha <= 0.001) return;
    ctx.save();
    ctx.globalAlpha *= o.alpha;
    ctx.fillStyle = o.color;
    setFont(ctx, o);
    ctx.textBaseline = o.baseline;
    if (o.tracking) {
      const w = textWidth(ctx, s, o);
      let cx = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
      ctx.textAlign = 'left';
      for (const ch of s) {
        ctx.fillText(ch, cx, y);
        cx += ctx.measureText(ch).width + o.tracking;
      }
    } else {
      ctx.textAlign = o.align;
      ctx.fillText(s, x, y);
    }
    ctx.restore();
  }

  /** 中文按字断行，ASCII 视作整词 */
  function tokenize(s) {
    const toks = [];
    let buf = '';
    for (const ch of s) {
      if (/[A-Za-z0-9@.:/·\-_%]/.test(ch)) buf += ch;
      else {
        if (buf) { toks.push(buf); buf = ''; }
        toks.push(ch);
      }
    }
    if (buf) toks.push(buf);
    return toks;
  }

  /** 行首避头尾（标点不置行首） */
  const NO_LINE_START = '，。、；：？！）」』】…·”’%';
  function wrapText(ctx, s, maxW, o = {}) {
    const lines = [];
    let cur = '';
    for (const tk of tokenize(s)) {
      const test = cur + tk;
      const overflow = textWidth(ctx, test, o) > maxW;
      if (cur && overflow && !NO_LINE_START.includes(tk)) {
        lines.push(cur);
        cur = tk === ' ' ? '' : tk;
      } else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  /** 段落：自动换行，返回绘制结束的 y */
  function paragraph(ctx, s, x, y, maxW, opt = {}) {
    const o = { size: 32, lineH: 58, color: INK2, weight: 400, font: SANS, alpha: 1, ...opt };
    const lines = wrapText(ctx, s, maxW, o);
    lines.forEach((ln, i) => txt(ctx, ln, x, y + i * o.lineH, o));
    return y + lines.length * o.lineH;
  }

  // ══════════════════════════ 4. 形状与组件 ══════════════════════════
  function rr(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function panel(ctx, x, y, w, h, opt = {}) {
    const { r = 20, fill = CARD, stroke = LINE, shadow = 0, alpha = 1, lineW = 1.5 } = opt;
    if (alpha <= 0.001) return;
    ctx.save();
    ctx.globalAlpha *= alpha;
    if (shadow) {
      ctx.shadowColor = 'rgba(26,22,18,0.13)';
      ctx.shadowBlur = shadow;
      ctx.shadowOffsetY = shadow * 0.3;
    }
    rr(ctx, x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineW;
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 胶囊标签，返回宽度 */
  function pill(ctx, x, y, label, opt = {}) {
    const { size = 24, color = INK2, bg = 'rgba(26,22,18,0.06)', alpha = 1, h = 52, weight = 500, pad = 26, font = SANS } = opt;
    const o = { size, weight, font };
    const w = textWidth(ctx, label, o) + pad * 2;
    ctx.save();
    ctx.globalAlpha *= alpha;
    rr(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.restore();
    txt(ctx, label, x + pad, y + h / 2 + size * 0.36, { ...o, color, alpha, baseline: 'alphabetic' });
    return w;
  }

  function tagRow(ctx, x, y, tags, opt = {}) {
    let cx = x;
    tags.forEach((tg) => {
      cx += pill(ctx, cx, y, tg.label || tg, {
        size: 21,
        h: 42,
        pad: 18,
        color: tg.color || MUTED,
        bg: tg.bg || 'rgba(26,22,18,0.05)',
        alpha: opt.alpha,
      }) + 12;
    });
    return cx - x;
  }

  /** 红色马克笔涂抹（标题高亮） */
  function highlight(ctx, x, y, w, h, alpha) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    const g = ctx.createLinearGradient(x, y, x + w, y);
    g.addColorStop(0, 'rgba(194,59,34,0.22)');
    g.addColorStop(1, 'rgba(194,59,34,0.12)');
    ctx.fillStyle = g;
    rr(ctx, x, y, w, h, 8);
    ctx.fill();
    ctx.restore();
  }

  /** 打勾 */
  function checkMark(ctx, x, y, s, color, p) {
    if (p <= 0) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = s * 0.16;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const p1 = { x: x + s * 0.18, y: y + s * 0.54 };
    const p2 = { x: x + s * 0.42, y: y + s * 0.78 };
    const p3 = { x: x + s * 0.84, y: y + s * 0.26 };
    const a = clamp(p / 0.55);
    const b = clamp((p - 0.55) / 0.45);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(lerp(p1.x, p2.x, a), lerp(p1.y, p2.y, a));
    if (b > 0) ctx.lineTo(lerp(p2.x, p3.x, b), lerp(p2.y, p3.y, b));
    ctx.stroke();
    ctx.restore();
  }

  /** 简易折线（张力曲线用，二次平滑） */
  function smoothPath(ctx, pts) {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const xc = (pts[i].x + pts[i + 1].x) / 2;
      const yc = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
    }
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    ctx.quadraticCurveTo(prev.x, prev.y, last.x, last.y);
  }

  // ══════════════════════════ 5. 纸纹背景 ══════════════════════════
  const noiseCanvas = document.createElement('canvas');
  noiseCanvas.width = noiseCanvas.height = 260;
  {
    const g = noiseCanvas.getContext('2d');
    for (let i = 0; i < 2400; i++) {
      g.fillStyle = `rgba(26,22,18,${Math.random() * 0.05})`;
      g.fillRect(Math.random() * 260, Math.random() * 260, 1.3, 1.3);
    }
    for (let i = 0; i < 60; i++) {
      g.strokeStyle = `rgba(26,22,18,${Math.random() * 0.03})`;
      g.lineWidth = 1;
      const y = Math.random() * 260;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(260, y + Math.random() * 6 - 3);
      g.stroke();
    }
  }

  function background(ctx) {
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, H);
    const g1 = ctx.createRadialGradient(300, 40, 0, 300, 40, 950);
    g1.addColorStop(0, 'rgba(194,59,34,0.11)');
    g1.addColorStop(1, 'rgba(194,59,34,0)');
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, W, H);
    const g2 = ctx.createRadialGradient(1720, 900, 0, 1720, 900, 950);
    g2.addColorStop(0, 'rgba(61,90,74,0.10)');
    g2.addColorStop(1, 'rgba(61,90,74,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = ctx.createPattern(noiseCanvas, 'repeat');
    ctx.fillRect(0, 0, W, H);
    const g3 = ctx.createRadialGradient(W / 2, H / 2, 320, W / 2, H / 2, 1180);
    g3.addColorStop(0, 'rgba(26,22,18,0)');
    g3.addColorStop(1, 'rgba(26,22,18,0.11)');
    ctx.fillStyle = g3;
    ctx.fillRect(0, 0, W, H);
  }

  /** 墨渍晕染 */
  function inkWash(ctx, x, y, r, alpha) {
    if (r <= 1) return;
    const blobs = [
      [0, 0, 1], [0.52, -0.24, 0.72], [-0.46, 0.3, 0.66], [0.32, 0.44, 0.54], [-0.34, -0.42, 0.5],
    ];
    ctx.save();
    ctx.globalAlpha *= alpha;
    blobs.forEach(([dx, dy, s]) => {
      const g = ctx.createRadialGradient(x + dx * r, y + dy * r, 0, x + dx * r, y + dy * r, r * s);
      g.addColorStop(0, 'rgba(194,59,34,0.16)');
      g.addColorStop(0.62, 'rgba(194,59,34,0.06)');
      g.addColorStop(1, 'rgba(194,59,34,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r * 1.4, y - r * 1.4, r * 2.8, r * 2.8);
    });
    ctx.restore();
  }

  // ══════════════════════════ 6. 场景 ══════════════════════════

  /* ── S1 · 开场（6s）── */
  function scene1(ctx, st) {
    inkWash(ctx, 1560, 250, 260 * P(st, 0, 1.6, outExpo), 1);

    const a0 = P(st, 0.35, 0.8);
    txt(ctx, '本地优先 · AI 长篇小说创作台', MARGIN, 262, {
      size: 28, tracking: 12, color: PEPPER, weight: 500, alpha: a0,
    });
    const rule = P(st, 0.15, 0.9, outQuart);
    ctx.save();
    ctx.globalAlpha *= a0;
    ctx.fillStyle = PEPPER;
    rr(ctx, MARGIN, 288, 130 * rule, 6, 3);
    ctx.fill();
    ctx.restore();

    const a1 = P(st, 0.7, 0.95);
    txt(ctx, '写长篇，最难的', MARGIN, 470, { size: 112, weight: 700, font: SERIF, color: INK, alpha: a1 });

    const a2 = P(st, 1.15, 0.95);
    const keyW = textWidth(ctx, '不是写', { size: 112, weight: 700, font: SERIF });
    highlight(ctx, MARGIN - 12, 496, (keyW + 24) * P(st, 1.35, 0.8, outQuart), 122, a2);
    txt(ctx, '不是写。', MARGIN, 610, { size: 112, weight: 700, font: SERIF, color: INK, alpha: a2 });

    const a3 = P(st, 2.1, 0.9);
    paragraph(ctx, '把人物、世界观、伏笔、时间线，整理成 AI 也读得懂的结构。', MARGIN, 720, 1080, {
      size: 36, lineH: 62, color: INK2, alpha: a3,
    });

    const chips = ['数据不出本机', '多模型可选', 'EPUB · DOCX 成书'];
    let cx = MARGIN;
    chips.forEach((c, i) => {
      const a = P(st, 3 + i * 0.16, 0.7);
      cx += pill(ctx, cx, 830, c, {
        alpha: a, bg: 'rgba(194,59,34,0.08)', color: PEPPER_DEEP, h: 54, size: 25,
      }) + 16;
    });
  }

  /* ── S2 · 痛点（9s）── */
  const SCRAPS = [
    { x: 1010, y: 210, w: 310, h: 152, rot: -0.075, title: '设定文档.docx', bars: [230, 176] },
    { x: 1420, y: 296, w: 310, h: 160, rot: 0.088, title: '聊天记录 · 47 条', bars: [250, 210] },
    { x: 1078, y: 512, w: 310, h: 152, rot: 0.058, title: '便签：他到底几岁？', bars: [200, 246] },
    { x: 1478, y: 604, w: 310, h: 152, rot: -0.11, title: '大纲 v3（最终版）', bars: [246, 172] },
    { x: 1188, y: 782, w: 322, h: 152, rot: -0.042, title: '读者群补充设定', bars: [236, 190] },
  ];

  function scrapCard(ctx, s, st, i) {
    const a = P(st, 0.5 + i * 0.22, 0.8);
    if (a <= 0.001) return;
    const float = Math.sin(st * 0.7 + i * 1.9) * 6;
    const rot = s.rot + Math.sin(st * 0.5 + i) * 0.012;
    ctx.save();
    ctx.translate(s.x + s.w / 2, s.y + s.h / 2 + float);
    ctx.rotate(rot);
    ctx.translate(-s.w / 2, -s.h / 2);
    ctx.globalAlpha *= a;
    panel(ctx, 0, 0, s.w, s.h, { r: 12, fill: '#fffdf7', shadow: 30, stroke: 'rgba(26,22,18,0.10)' });
    txt(ctx, s.title, 26, 56, { size: 26, weight: 600, color: INK });
    s.bars.forEach((bw, j) => {
      ctx.fillStyle = 'rgba(26,22,18,0.14)';
      rr(ctx, 26, 82 + j * 28, bw * (0.75 + 0.25 * P(st, 0.9 + i * 0.22 + j * 0.12, 0.6)), 11, 5);
      ctx.fill();
    });
    // 红笔划线
    const sw = P(st, 1.4 + i * 0.22, 0.7);
    if (sw > 0) {
      ctx.strokeStyle = 'rgba(194,59,34,0.55)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(30, 92);
      ctx.bezierCurveTo(30 + 90 * sw, 86, 30 + 150 * sw, 98, 30 + 210 * sw, 90);
      ctx.stroke();
    }
    ctx.restore();
  }

  function scene2(ctx, st) {
    // 乱线：散落的联系
    const tangle = P(st, 1.6, 1.8);
    if (tangle > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(194,59,34,0.34)';
      ctx.lineWidth = 3;
      ctx.setLineDash([2200]);
      ctx.lineDashOffset = 2200 * (1 - tangle);
      ctx.beginPath();
      ctx.moveTo(1150, 300);
      ctx.bezierCurveTo(1320, 420, 1000, 470, 1220, 560);
      ctx.bezierCurveTo(1420, 650, 1150, 700, 1330, 800);
      ctx.bezierCurveTo(1480, 880, 1250, 890, 1280, 830);
      ctx.stroke();
      ctx.restore();
    }
    SCRAPS.forEach((s, i) => scrapCard(ctx, s, st, i));

    const a0 = P(st, 0.3, 0.8);
    txt(ctx, '痛点 · 长篇的真实困境', MARGIN, 300, { size: 28, tracking: 12, color: PEPPER, weight: 500, alpha: a0 });

    const a1 = P(st, 0.75, 0.9);
    txt(ctx, '设定散落在十几个地方，', MARGIN, 430, { size: 74, weight: 700, font: SERIF, color: INK, alpha: a1 });
    const a2 = P(st, 1.15, 0.9);
    txt(ctx, 'AI 每次都从头猜。', MARGIN, 530, { size: 74, weight: 700, font: SERIF, color: INK, alpha: a2 });

    const a3 = P(st, 2.1, 0.9);
    paragraph(ctx, '写到第 20 章，它已经忘了第 3 章埋下的伏笔；人物年龄前后对不上，还得你自己翻文档。', MARGIN, 650, 700, {
      size: 31, lineH: 56, color: INK2, alpha: a3,
    });

    const a4 = P(st, 6.6, 0.8);
    txt(ctx, '不是模型不行，是上下文没组织好。', MARGIN, 872, {
      size: 28, weight: 500, color: PEPPER_DEEP, alpha: a4,
    });
    ctx.save();
    ctx.globalAlpha *= a4;
    ctx.fillStyle = PEPPER;
    rr(ctx, MARGIN - 22, 856, 6, 26, 3);
    ctx.fill();
    ctx.restore();
  }

  /* ── S3 · 结构化资产（9s）── */
  const ASSETS = [
    {
      title: '人物卡 · 沈砚', body: '法医，32 岁。习惯在解剖台前沉默，与「夜航船」案有隐秘关联。',
      tags: [{ label: '性格弧光', color: PEPPER_DEEP, bg: 'rgba(194,59,34,0.09)' }, { label: '关系网' }, { label: '口吻卡' }],
    },
    {
      title: '世界观 · 雾港市', body: '临海工业城，九月起进入四十天雨季。旧港区管网是叙事暗线。',
      tags: [{ label: '地理', color: PINE, bg: 'rgba(61,90,74,0.10)' }, { label: '硬规则', color: PINE, bg: 'rgba(61,90,74,0.10)' }, { label: '时代' }],
    },
    {
      title: '伏笔线 · 夜航船', body: '第 3 章埋下船票残角 → 第 17 章回收。状态：待回收。',
      tags: [{ label: '待回收', color: PEPPER_DEEP, bg: 'rgba(194,59,34,0.09)' }, { label: '关联章节' }],
    },
    {
      title: '时间线 · 九月十七', body: '案发 → 尸检 → 港区封锁。跨章时间冲突自动检测。',
      tags: [{ label: '冲突检测', color: GOLD, bg: 'rgba(176,137,64,0.12)' }, { label: '双视图' }],
    },
  ];

  function assetCard(ctx, c, x, y, w, h, st, i) {
    const a = P(st, 0.7 + i * 0.18, 0.85, outBack);
    const fade = P(st, 0.7 + i * 0.18, 0.5);
    if (fade <= 0.001) return;
    const dy = lerp(46, 0, a);
    panel(ctx, x, y + dy, w, h, { r: 22, shadow: 42, alpha: fade });
    ctx.save();
    ctx.globalAlpha *= fade;
    ctx.fillStyle = i === 0 ? PEPPER : i === 1 ? PINE : i === 2 ? PEPPER_DEEP : GOLD;
    rr(ctx, x, y + dy, 8, h, 4);
    ctx.fill();
    ctx.restore();
    txt(ctx, c.title, x + 34, y + dy + 62, { size: 31, weight: 600, font: SERIF, color: INK, alpha: fade });
    paragraph(ctx, c.body, x + 34, y + dy + 116, w - 68, {
      size: 22, lineH: 38, color: MUTED, alpha: fade,
    });
    tagRow(ctx, x + 34, y + dy + h - 76, c.tags, { alpha: fade });
  }

  function scene3(ctx, st) {
    const a0 = P(st, 0.25, 0.8);
    txt(ctx, '结构化创作资产', MARGIN, 300, { size: 28, tracking: 12, color: PEPPER, weight: 500, alpha: a0 });
    const a1 = P(st, 0.6, 0.9);
    txt(ctx, '把设定，变成', MARGIN, 432, { size: 72, weight: 700, font: SERIF, color: INK, alpha: a1 });
    const a2 = P(st, 0.95, 0.9);
    txt(ctx, 'AI 读得懂的资产', MARGIN, 528, { size: 72, weight: 700, font: SERIF, color: INK, alpha: a2 });
    const a3 = P(st, 1.7, 0.9);
    paragraph(ctx, '人物、地点、设定、伏笔、时间线全部落成表格化资产。改一处，全局口径同步，不用再复制粘贴设定文档。', MARGIN, 640, 620, {
      size: 30, lineH: 54, color: INK2, alpha: a3,
    });

    const cw = 430;
    const ch = 246;
    const gap = 40;
    const x0 = 880;
    const y0 = 330;
    ASSETS.forEach((c, i) => {
      const x = x0 + (i % 2) * (cw + gap);
      const y = y0 + Math.floor(i / 2) * (ch + gap);
      assetCard(ctx, c, x, y, cw, ch, st, i);
    });

    // 资产之间的连线
    const link = P(st, 5.4, 1.6);
    if (link > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(194,59,34,0.38)';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([1200]);
      ctx.lineDashOffset = 1200 * (1 - link);
      ctx.beginPath();
      ctx.moveTo(x0 + cw, y0 + ch / 2);
      ctx.lineTo(x0 + cw + gap, y0 + ch / 2);
      ctx.moveTo(x0 + cw / 2, y0 + ch);
      ctx.lineTo(x0 + cw / 2, y0 + ch + gap);
      ctx.moveTo(x0 + cw + gap + cw / 2, y0 + ch + gap + ch / 2);
      ctx.lineTo(x0 + cw + gap + cw / 2, y0 + ch + gap + ch + gap / 2);
      ctx.stroke();
      ctx.restore();
      const dot = (dx, dy) => {
        ctx.fillStyle = PEPPER;
        ctx.beginPath();
        ctx.arc(dx, dy, 6, 0, Math.PI * 2);
        ctx.fill();
      };
      dot(x0 + cw + gap / 2, y0 + ch / 2);
      dot(x0 + cw / 2, y0 + ch + gap / 2);
    }
  }

  /* ── S4 · 上下文组装（10s）── */
  const SOURCES = [
    { label: '人物近况 · 沈砚（近 3 章）', meta: '人物卡' },
    { label: '世界观 · 雨季与港区规则', meta: '世界观' },
    { label: '伏笔 · 夜航船（待回收）', meta: '伏笔线' },
    { label: '上一章结尾 · 428 字', meta: '正文' },
    { label: '文风样本 · 4,200 字', meta: '文风' },
  ];

  function scene4(ctx, st) {
    const a0 = P(st, 0.25, 0.8);
    txt(ctx, '智能上下文组装', MARGIN, 268, { size: 28, tracking: 12, color: PEPPER, weight: 500, alpha: a0 });
    const a1 = P(st, 0.6, 0.9);
    txt(ctx, '写第 20 章，它知道该带上什么', MARGIN, 392, { size: 68, weight: 700, font: SERIF, color: INK, alpha: a1 });

    const node = { x: 1060, y: 512, w: 620, h: 300 };
    const ncx = node.x + node.w / 2;
    const ncy = node.y + node.h / 2;

    // 生成节点的呼吸环
    const pulse = (st * 0.5) % 1;
    for (let k = 0; k < 2; k++) {
      const p = (pulse + k * 0.5) % 1;
      ctx.save();
      ctx.globalAlpha = (1 - p) * 0.3 * P(st, 3.4, 1);
      ctx.strokeStyle = PEPPER;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ncx, ncy, 190 + p * 120, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 来源条目
    const chipX = MARGIN;
    const chipW = 560;
    const chipH = 72;
    const step = 96;
    const y0 = 452;

    SOURCES.forEach((s, i) => {
      const y = y0 + i * step;
      const a = P(st, 1 + i * 0.3, 0.7);
      const dx = lerp(-60, 0, a);
      if (a <= 0.001) return;
      panel(ctx, chipX + dx, y, chipW, chipH, { r: 16, alpha: a, shadow: 20 });
      ctx.save();
      ctx.globalAlpha *= a;
      ctx.fillStyle = 'rgba(194,59,34,0.75)';
      ctx.beginPath();
      ctx.arc(chipX + dx + 32, y + chipH / 2, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      txt(ctx, s.label, chipX + dx + 58, y + chipH / 2 + 10, { size: 25, weight: 500, color: INK2, alpha: a });
      txt(ctx, s.meta, chipX + dx + chipW - 28, y + chipH / 2 + 9, {
        size: 21, color: MUTED, align: 'right', alpha: a,
      });

      // 连线 + 流动的点
      const lp = P(st, 1.9 + i * 0.3, 1.3);
      if (lp > 0.01) {
        const p0 = { x: chipX + chipW + 24, y: y + chipH / 2 };
        const p3 = { x: node.x, y: ncy };
        const p1 = { x: p0.x + 180, y: p0.y };
        const p2 = { x: p3.x - 190, y: p3.y };
        ctx.save();
        ctx.strokeStyle = 'rgba(194,59,34,0.5)';
        ctx.lineWidth = 3;
        ctx.setLineDash([900]);
        ctx.lineDashOffset = 900 * (1 - lp);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
        ctx.stroke();
        ctx.restore();
        if (lp < 1) {
          const pt = cubicPoint(p0, p1, p2, p3, lp);
          ctx.fillStyle = PEPPER;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });

    // 节点卡片
    const na = P(st, 0.6, 0.9);
    panel(ctx, node.x, node.y, node.w, node.h, { r: 26, shadow: 56, alpha: na, stroke: 'rgba(194,59,34,0.28)' });
    txt(ctx, '本次生成 · 第 20 章', node.x + 44, node.y + 82, {
      size: 30, weight: 600, font: SERIF, color: INK, alpha: na,
    });
    const tokens = Math.round(lerp(0, 4218, P(st, 3.6, 2.6, outQuart)));
    txt(ctx, `${tokens.toLocaleString('en-US')} tokens`, node.x + 44, node.y + 172, {
      size: 58, weight: 700, font: SERIF, color: PEPPER, alpha: na,
    });
    txt(ctx, '上下文自动裁剪到预算内', node.x + 44, node.y + 218, {
      size: 23, color: MUTED, alpha: na,
    });
    tagRow(ctx, node.x + 44, node.y + 236, [
      { label: '来源可溯', color: PEPPER_DEEP, bg: 'rgba(194,59,34,0.09)' },
      { label: '预算裁剪' },
      { label: '语义召回' },
    ], { alpha: na });

    const la = P(st, 7.2, 0.8);
    txt(ctx, '生成前可预览「带了哪些来源」，AI 不再凭空发挥。', node.x, 892, {
      size: 25, weight: 500, color: PEPPER_DEEP, alpha: la,
    });
    ctx.save();
    ctx.globalAlpha *= la;
    ctx.fillStyle = PEPPER;
    rr(ctx, node.x - 22, 874, 6, 26, 3);
    ctx.fill();
    ctx.restore();
  }

  /* ── S5 · 一致性巡检（9s）── */
  const ISSUES = [
    { title: '时间线冲突', where: '第 12 章 · 九月十七', note: '尸检时间早于案发时间' },
    { title: '伏笔漏收', where: '夜航船', note: '第 3 章埋下，17 章前未回收' },
    { title: '性格漂移', where: '沈砚', note: '第 8 章突然变得健谈' },
  ];

  function scene5(ctx, st) {
    const a0 = P(st, 0.25, 0.8);
    txt(ctx, '一致性巡检', MARGIN, 268, { size: 28, tracking: 12, color: PEPPER, weight: 500, alpha: a0 });
    const a1 = P(st, 0.6, 0.9);
    txt(ctx, '写完不是结束，对得上才算', MARGIN, 392, { size: 68, weight: 700, font: SERIF, color: INK, alpha: a1 });

    // 张力曲线
    const box = { x: MARGIN, y: 468, w: 850, h: 430 };
    panel(ctx, box.x, box.y, box.w, box.h, { r: 24, alpha: P(st, 0.9, 0.7), shadow: 34 });
    txt(ctx, '张力曲线 · 第一卷', box.x + 40, box.y + 64, {
      size: 27, weight: 600, font: SERIF, color: INK, alpha: P(st, 1.1, 0.7),
    });
    txt(ctx, '高开 → 中段塌陷 → 卷末拉起', box.x + box.w - 40, box.y + 62, {
      size: 21, color: MUTED, align: 'right', alpha: P(st, 1.1, 0.7),
    });

    const cx0 = box.x + 62;
    const cx1 = box.x + box.w - 42;
    const cy0 = box.y + 108;
    const cy1 = box.y + box.h - 62;
    // 网格
    ctx.save();
    ctx.globalAlpha = 0.5 * P(st, 1.1, 0.7);
    ctx.strokeStyle = 'rgba(26,22,18,0.08)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i <= 3; i++) {
      const gy = cy0 + ((cy1 - cy0) / 3) * i;
      ctx.beginPath();
      ctx.moveTo(cx0, gy);
      ctx.lineTo(cx1, gy);
      ctx.stroke();
    }
    ctx.restore();

    const raw = [0.42, 0.62, 0.5, 0.72, 0.36, 0.3, 0.44, 0.38, 0.66, 0.88];
    const pts = raw.map((v, i) => ({
      x: cx0 + ((cx1 - cx0) / (raw.length - 1)) * i,
      y: cy1 - (cy1 - cy0) * v,
    }));

    const reveal = P(st, 1.4, 2.6, inOutCubic);
    if (reveal > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx0 - 20, cy0 - 40, (cx1 - cx0 + 40) * reveal, cy1 - cy0 + 90);
      ctx.clip();

      ctx.beginPath();
      smoothPath(ctx, pts);
      ctx.lineTo(pts[pts.length - 1].x, cy1);
      ctx.lineTo(pts[0].x, cy1);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, cy0, 0, cy1);
      g.addColorStop(0, 'rgba(194,59,34,0.18)');
      g.addColorStop(1, 'rgba(194,59,34,0.02)');
      ctx.fillStyle = g;
      ctx.fill();

      ctx.beginPath();
      smoothPath(ctx, pts);
      ctx.strokeStyle = PEPPER;
      ctx.lineWidth = 5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();

      pts.forEach((p, i) => {
        const t = i / (pts.length - 1);
        const a = P(reveal * 1.02, t, 0.12);
        if (a <= 0.001) return;
        ctx.save();
        ctx.globalAlpha *= a;
        ctx.fillStyle = CARD;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = PEPPER;
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.restore();
      });
    }

    // 问题清单
    ISSUES.forEach((it, i) => {
      const a = P(st, 2.2 + i * 0.75, 0.8);
      if (a <= 0.001) return;
      const y = 468 + i * 148;
      const x = 1060;
      const w = 720;
      const h = 118;
      const dx = lerp(56, 0, a);
      panel(ctx, x + dx, y, w, h, { r: 18, alpha: a, shadow: 22 });
      const fixed = P(st, 5.2 + i * 0.75, 0.8);
      const dotColor = fixed > 0.5 ? PINE : PEPPER;
      ctx.save();
      ctx.globalAlpha *= a;
      ctx.fillStyle = fixed > 0.5 ? 'rgba(61,90,74,0.12)' : 'rgba(194,59,34,0.10)';
      rr(ctx, x + dx + 28, y + 28, 62, 62, 18);
      ctx.fill();
      ctx.restore();
      if (fixed > 0) {
        checkMark(ctx, x + dx + 38, y + 38, 42, PINE, fixed);
      } else {
        ctx.save();
        ctx.globalAlpha *= a;
        ctx.fillStyle = dotColor;
        ctx.beginPath();
        ctx.arc(x + dx + 59, y + 59, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      txt(ctx, it.title, x + dx + 118, y + 52, { size: 29, weight: 600, color: INK, alpha: a });
      txt(ctx, it.note, x + dx + 118, y + 90, { size: 22, color: MUTED, alpha: a });
      txt(ctx, fixed > 0.5 ? '已修复' : it.where, x + dx + w - 32, y + 68, {
        size: 22, color: fixed > 0.5 ? PINE : PEPPER_DEEP, align: 'right', alpha: a,
      });
    });

    const la = P(st, 7.6, 0.8);
    txt(ctx, '每条问题都带章节定位，点开就能改，不用再翻文档。', 1060, 916, {
      size: 25, weight: 500, color: PEPPER_DEEP, alpha: la,
    });
    ctx.save();
    ctx.globalAlpha *= la;
    ctx.fillStyle = PEPPER;
    rr(ctx, 1038, 898, 6, 26, 3);
    ctx.fill();
    ctx.restore();
  }

  /* ── S6 · 成书（9s）── */
  function drawBook(ctx, x, y, w, h, alpha, scale) {
    if (alpha <= 0.001) return;
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.scale(scale, scale);
    ctx.translate(-x - w / 2, -y - h / 2);
    ctx.globalAlpha *= alpha;

    // 书页侧边
    ctx.fillStyle = '#fffdf7';
    rr(ctx, x + 16, y + 12, w, h, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(26,22,18,0.12)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // 书脊
    const g = ctx.createLinearGradient(x, y, x + w, y);
    g.addColorStop(0, PEPPER_DEEP);
    g.addColorStop(0.12, PEPPER);
    g.addColorStop(1, '#d2482c');
    ctx.fillStyle = g;
    rr(ctx, x, y, w, h, 16);
    ctx.fill();
    // 封面纹理
    ctx.save();
    rr(ctx, x, y, w, h, 16);
    ctx.clip();
    ctx.globalAlpha *= 0.16;
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + w * 0.72, y, w * 0.03, h);
    ctx.restore();

    // 书名纸签
    const lx = x + 62;
    const ly = y + 118;
    const lw = w - 124;
    const lh = 232;
    ctx.fillStyle = 'rgba(255,251,245,0.94)';
    rr(ctx, lx, ly, lw, lh, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(26,22,18,0.14)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    txt(ctx, '雾港夜航', lx + lw / 2, ly + 104, {
      size: 50, weight: 700, font: SERIF, color: INK, align: 'center', tracking: 4,
    });
    ctx.fillStyle = 'rgba(26,22,18,0.18)';
    ctx.fillRect(lx + 62, ly + 140, lw - 124, 2);
    txt(ctx, '沈砚手记 · 第一卷', lx + lw / 2, ly + 186, {
      size: 25, color: MUTED, align: 'center', tracking: 3,
    });
    ctx.restore();
  }

  function scene6(ctx, st) {
    const a0 = P(st, 0.25, 0.8);
    txt(ctx, '导出与成书', W / 2, 268, { size: 28, tracking: 12, color: PEPPER, weight: 500, align: 'center', alpha: a0 });
    const a1 = P(st, 0.55, 0.9);
    txt(ctx, '从初稿到成书，一键出', W / 2, 386, {
      size: 68, weight: 700, font: SERIF, color: INK, align: 'center', alpha: a1,
    });

    // 手稿页飞入成书
    for (let i = 0; i < 3; i++) {
      const p = P(st, 0.55 + i * 0.2, 1.35, inOutCubic);
      if (p <= 0 || p >= 1) continue;
      const x = lerp(280 + i * 60, 1330, p);
      const y = lerp(470 + i * 40, 560, p);
      ctx.save();
      ctx.globalAlpha *= (1 - p) * 0.85;
      ctx.translate(x, y);
      ctx.rotate(lerp(-0.12 + i * 0.05, 0, p));
      panel(ctx, 0, 0, 300, 380, { r: 10, fill: '#fffdf7', shadow: 24 });
      for (let k = 0; k < 7; k++) {
        ctx.fillStyle = 'rgba(26,22,18,0.12)';
        rr(ctx, 28, 48 + k * 42, 200 + ((k * 37) % 80), 12, 6);
        ctx.fill();
      }
      ctx.restore();
    }

    const bookA = P(st, 1.45, 0.7);
    const bookS = lerp(0.86, 1, P(st, 1.45, 1, outBack));
    drawBook(ctx, 1160, 440, 380, 470, bookA, bookS);

    // 盖章：已导出
    const stamper = P(st, 6, 0.7, outBack);
    if (stamper > 0.001) {
      ctx.save();
      ctx.translate(1332, 832);
      ctx.rotate(-0.16 + 0.06 * (1 - stamper));
      ctx.scale(lerp(1.5, 1, stamper), lerp(1.5, 1, stamper));
      ctx.globalAlpha *= P(st, 6, 0.35);
      ctx.fillStyle = 'rgba(255,248,242,0.16)';
      ctx.strokeStyle = 'rgba(255,248,242,0.92)';
      ctx.lineWidth = 4;
      rr(ctx, -118, -42, 236, 84, 12);
      ctx.fill();
      ctx.stroke();
      txt(ctx, '已 导 出', 0, 15, {
        size: 38, weight: 700, font: SERIF, color: '#fff8f2', align: 'center', tracking: 8,
      });
      ctx.restore();
    }

    // 格式徽章
    const formats = [
      { name: 'EPUB 3', note: '阅读器 / 自出版' },
      { name: 'DOCX', note: '投稿给编辑' },
      { name: 'Markdown', note: 'Obsidian / Notion' },
      { name: 'HTML', note: '打印成 PDF' },
      { name: 'TXT', note: '通用文本' },
      { name: 'JSON', note: '全量备份' },
    ];
    formats.forEach((f, i) => {
      const a = P(st, 2.2 + i * 0.22, 0.7, outBack);
      const fade = P(st, 2.2 + i * 0.22, 0.4);
      if (fade <= 0.001) return;
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 210 + col * 400;
      const y = 512 + row * 126;
      const dy = lerp(28, 0, a);
      panel(ctx, x, y + dy, 356, 98, { r: 18, alpha: fade, shadow: 18 });
      ctx.save();
      ctx.globalAlpha *= fade;
      ctx.fillStyle = 'rgba(194,59,34,0.10)';
      rr(ctx, x + 22, y + dy + 22, 54, 54, 14);
      ctx.fill();
      ctx.restore();
      txt(ctx, f.name[0], x + 49, y + dy + 62, {
        size: 26, weight: 700, font: SERIF, color: PEPPER_DEEP, align: 'center', alpha: fade,
      });
      txt(ctx, f.name, x + 96, y + dy + 46, { size: 27, weight: 600, color: INK, alpha: fade });
      txt(ctx, f.note, x + 96, y + dy + 78, { size: 20, color: MUTED, alpha: fade });
    });

    const la = P(st, 5.2, 0.8);
    txt(ctx, 'ZIP / EPUB / DOCX 全部自研实现，零第三方依赖。', 210, 916, {
      size: 25, weight: 500, color: PEPPER_DEEP, alpha: la,
    });
  }

  /* ── S7 · 收尾（8s）── */
  function scene7(ctx, st) {
    inkWash(ctx, W / 2, 470, 420 * P(st, 0, 2, outExpo), 0.9);

    const sp = P(st, 0.15, 0.95, outQuart);
    const scale = lerp(1.75, 1, sp);
    const rot = lerp(-0.14, 0, sp);
    ctx.save();
    ctx.translate(W / 2, 372);
    ctx.rotate(rot);
    ctx.scale(scale, scale);
    ctx.globalAlpha *= P(st, 0.15, 0.4);
    const g = ctx.createLinearGradient(-95, -95, 95, 95);
    g.addColorStop(0, PEPPER);
    g.addColorStop(1, PEPPER_DEEP);
    ctx.fillStyle = g;
    rr(ctx, -95, -95, 190, 190, 30);
    ctx.fill();
    ctx.restore();
    txt(ctx, '椒', W / 2, 412, {
      size: 104, weight: 700, font: SERIF, color: '#fff8f2', align: 'center', alpha: sp,
    });

    // 印章落下后的余波
    const ring = P(st, 1.05, 1.5);
    if (ring > 0 && ring < 1) {
      ctx.save();
      ctx.globalAlpha = (1 - ring) * 0.34;
      ctx.strokeStyle = PEPPER;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(W / 2, 372, 110 + ring * 260, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const a1 = P(st, 1.1, 1);
    txt(ctx, '花椒写作', W / 2, 622, {
      size: 96, weight: 700, font: SERIF, color: INK, align: 'center', tracking: 10, alpha: a1,
    });
    const a2 = P(st, 1.75, 0.9);
    txt(ctx, '把长篇小说，写成 AI 也读得懂的结构。', W / 2, 712, {
      size: 38, color: INK2, align: 'center', alpha: a2,
    });

    const rule = P(st, 2.3, 0.9, outQuart);
    ctx.save();
    ctx.globalAlpha *= a2;
    ctx.fillStyle = PEPPER;
    rr(ctx, W / 2 - 90 * rule, 764, 180 * rule, 5, 3);
    ctx.fill();
    ctx.restore();

    const a3 = P(st, 2.9, 0.9);
    txt(ctx, '本地优先 · 数据不出本机 · DeepSeek / Kimi / 本地模型', W / 2, 838, {
      size: 27, color: MUTED, align: 'center', tracking: 4, alpha: a3,
    });
  }

  // ══════════════════════════ 7. 时间轴 ══════════════════════════
  const SCENES = [
    { title: '开场', dur: 6, draw: scene1, caption: '写长篇，最难的不是写。' },
    { title: '痛点', dur: 9, draw: scene2, caption: '设定散落各处，AI 每次都从头猜。' },
    { title: '结构资产', dur: 9, draw: scene3, caption: '花椒写作把它们整理成结构化的创作资产。' },
    { title: '上下文组装', dur: 10, draw: scene4, caption: '每次生成，自动带上该带的上下文。' },
    { title: '一致性巡检', dur: 9, draw: scene5, caption: '冲突、漏收、漂移 —— 一眼可见，点开就改。' },
    { title: '成书导出', dur: 9, draw: scene6, caption: '一键成书：EPUB、DOCX、全量备份。' },
    { title: '品牌收尾', dur: 8, draw: scene7, caption: '花椒写作 · 本地优先的 AI 长篇创作台。' },
  ];
  let acc = 0;
  SCENES.forEach((s) => { s.start = acc; acc += s.dur; });
  const DURATION = acc;

  const sceneIndexAt = (t) => {
    let idx = 0;
    for (let i = 0; i < SCENES.length; i++) if (t >= SCENES[i].start) idx = i;
    return idx;
  };

  function drawCaption(ctx, sc, st, alpha) {
    if (!state.cc) return;
    const cap = typeof sc.caption === 'function' ? sc.caption(st) : sc.caption;
    if (!cap) return;
    const size = 30;
    const o = { size, weight: 500, font: SANS };
    const w = textWidth(ctx, cap, o) + 96;
    const x = W / 2 - w / 2;
    const y = 950;
    panel(ctx, x, y, w, 82, {
      r: 41, fill: 'rgba(255,251,245,0.9)', stroke: 'rgba(26,22,18,0.10)', alpha: alpha * 0.96,
    });
    txt(ctx, cap, W / 2, y + 52, { ...o, color: INK2, align: 'center', alpha });
  }

  /** 分镜转场：红笔横扫 */
  function transitionSweep(ctx, t) {
    for (const sc of SCENES) {
      if (sc.start === 0) continue;
      const d = t - sc.start;
      if (d < -0.32 || d > 0.48) continue;
      const p = inOutCubic(clamp((d + 0.32) / 0.8));
      const x = lerp(-260, W + 260, p);
      ctx.save();
      const g = ctx.createLinearGradient(x - 300, 0, x, 0);
      g.addColorStop(0, 'rgba(244,239,231,0)');
      g.addColorStop(1, 'rgba(244,239,231,0.72)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 300, 0, 300, H);
      ctx.fillStyle = 'rgba(194,59,34,0.55)';
      ctx.fillRect(x - 3, 0, 5, H);
      ctx.restore();
    }
  }

  // ══════════════════════════ 8. 渲染 ══════════════════════════
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const DEBUG = new URLSearchParams(location.search).has('debug');

  function render(t) {
    const time = clamp(t, 0, DURATION);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    background(ctx);

    const idx = sceneIndexAt(time);
    const sc = SCENES[idx];
    const st = time - sc.start;

    // 淡入淡出：进出各自动，衔接处「落到纸面」
    const fadeIn = outCubic(clamp(st / 0.55));
    const fadeOut = outCubic(clamp((sc.dur - st) / 0.32));
    const alpha = Math.min(fadeIn, fadeOut);
    const scale = lerp(0.988, 1, fadeIn);

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(scale, scale);
    ctx.translate(-W / 2, -H / 2);
    ctx.globalAlpha = alpha;
    sc.draw(ctx, st, time);
    ctx.restore();

    transitionSweep(ctx, time);
    drawCaption(ctx, sc, st, Math.min(outCubic(clamp(st / 0.5)), outCubic(clamp((sc.dur - st) / 0.3))));

    if (DEBUG) {
      txt(ctx, `t=${time.toFixed(2)} · ${sc.title}`, W - 40, H - 30, {
        size: 34, color: 'rgba(26,22,18,0.5)', align: 'right',
      });
    }
  }

  // ══════════════════════════ 9. 播放控制 ══════════════════════════
  const state = {
    playing: false,
    t: 0,
    loop: false,
    cc: true,
    exporting: false,
  };

  const $ = (id) => document.getElementById(id);
  const btnPlay = $('btn-play');
  const btnCC = $('btn-cc');
  const btnLoop = $('btn-loop');
  const btnExport = $('btn-export');
  const btnCancel = $('btn-cancel');
  const overlay = $('overlay');
  const exportFill = $('export-fill');
  const exportPct = $('export-pct');
  const track = $('track');
  const trackFill = $('track-fill');
  const knob = $('knob');
  const ticksEl = $('ticks');
  const scenesEl = $('scenes');
  const timeCur = $('time-cur');
  const timeDur = $('time-dur');

  const fmt = (s) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec < 10 ? '0' : ''}${sec}`;
  };

  timeDur.textContent = fmt(DURATION);

  // 分镜刻度 + 场景芯片
  SCENES.forEach((s, i) => {
    const tick = document.createElement('i');
    tick.style.left = `${(s.start / DURATION) * 100}%`;
    ticksEl.appendChild(tick);

    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.innerHTML = `<b>${i + 1}</b>${s.title}`;
    chip.addEventListener('click', () => {
      seek(s.start + 0.02);
      play();
    });
    scenesEl.appendChild(chip);
  });

  function setPlayIcon() {
    btnPlay.textContent = state.playing ? '❚❚' : '▶';
    btnPlay.setAttribute('aria-label', state.playing ? '暂停' : '播放');
  }

  function syncUI() {
    const ratio = state.t / DURATION;
    trackFill.style.width = `${ratio * 100}%`;
    knob.style.left = `${ratio * 100}%`;
    track.setAttribute('aria-valuenow', Math.round(ratio * 100));
    timeCur.textContent = fmt(state.t);
    const idx = sceneIndexAt(state.t);
    Array.from(scenesEl.children).forEach((c, i) => c.classList.toggle('on', i === idx));
  }

  function seek(t) {
    state.t = clamp(t, 0, DURATION);
    render(state.t);
    syncUI();
  }

  function play() {
    if (state.exporting) return;
    if (state.t >= DURATION - 0.01) state.t = 0;
    state.playing = true;
    setPlayIcon();
  }

  function pause() {
    state.playing = false;
    setPlayIcon();
  }

  btnPlay.addEventListener('click', () => (state.playing ? pause() : play()));
  btnCC.addEventListener('click', () => {
    state.cc = !state.cc;
    btnCC.setAttribute('aria-pressed', String(state.cc));
    render(state.t);
  });
  btnLoop.addEventListener('click', () => {
    state.loop = !state.loop;
    btnLoop.setAttribute('aria-pressed', String(state.loop));
  });

  // 进度条拖动
  let dragging = false;
  const posToTime = (e) => {
    const r = track.getBoundingClientRect();
    return clamp((e.clientX - r.left) / r.width) * DURATION;
  };
  track.addEventListener('pointerdown', (e) => {
    if (state.exporting) return;
    dragging = true;
    track.setPointerCapture(e.pointerId);
    pause();
    seek(posToTime(e));
  });
  track.addEventListener('pointermove', (e) => { if (dragging) seek(posToTime(e)); });
  track.addEventListener('pointerup', (e) => {
    dragging = false;
    try { track.releasePointerCapture(e.pointerId); } catch { /* 忽略 */ }
  });

  document.addEventListener('keydown', (e) => {
    if (state.exporting) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (state.playing) pause();
      else play();
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      seek(state.t + 5);
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      seek(state.t - 5);
    } else if (/^Digit[1-7]$/.test(e.code)) {
      const i = Number(e.code.slice(5)) - 1;
      seek(SCENES[i].start + 0.02);
      play();
    }
  });

  // ══════════════════════════ 10. 导出视频 ══════════════════════════
  const MIME_CANDIDATES = [
    { mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4', label: 'MP4', bitrate: 8_000_000 },
    { mime: 'video/mp4', ext: 'mp4', label: 'MP4', bitrate: 8_000_000 },
    { mime: 'video/webm;codecs=vp9', ext: 'webm', label: 'WebM', bitrate: 6_000_000 },
    { mime: 'video/webm;codecs=vp8', ext: 'webm', label: 'WebM', bitrate: 5_000_000 },
    { mime: 'video/webm', ext: 'webm', label: 'WebM', bitrate: 5_000_000 },
  ];

  function pickMime() {
    if (typeof MediaRecorder === 'undefined') return null;
    for (const c of MIME_CANDIDATES) {
      if (MediaRecorder.isTypeSupported(c.mime)) return c;
    }
    return null;
  }

  const spec = pickMime();
  if (spec && spec.ext === 'webm') btnExport.textContent = '导出 WebM';
  if (!spec) {
    btnExport.disabled = true;
    btnExport.title = '当前浏览器不支持 MediaRecorder 录制';
  }

  let recorder = null;
  let cancelled = false;

  function finishDownload(blob, ext) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `花椒写作-宣传片.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function stopExport(save) {
    cancelled = !save;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    if (!save) {
      state.exporting = false;
      overlay.hidden = true;
      btnExport.disabled = !spec;
      setPlayIcon();
    }
  }

  function startExport() {
    if (!spec || state.exporting) return;
    pause();
    seek(0);
    cancelled = false;
    overlay.hidden = false;
    btnExport.disabled = true;
    btnPlay.disabled = true;

    const stream = canvas.captureStream(0);
    const videoTrack = stream.getVideoTracks()[0];
    recorder = new MediaRecorder(stream, { mimeType: spec.mime, videoBitsPerSecond: spec.bitrate });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      state.exporting = false;
      overlay.hidden = true;
      btnPlay.disabled = false;
      btnExport.disabled = !spec;
      setPlayIcon();
      if (!cancelled && chunks.length) {
        finishDownload(new Blob(chunks, { type: spec.mime.split(';')[0] }), spec.ext);
      }
    };

    state.exporting = true;
    recorder.start(250);

    const frameStep = 1000 / 30;
    let nextAt = performance.now();
    const t0 = performance.now();

    const tick = () => {
      if (!state.exporting) return;
      const el = (performance.now() - t0) / 1000;
      const t = Math.min(DURATION, el);
      render(t);
      videoTrack.requestFrame();
      const pct = Math.round((t / DURATION) * 100);
      exportFill.style.width = `${pct}%`;
      exportPct.textContent = `${pct}%`;
      syncUI();
      if (t >= DURATION) {
        setTimeout(() => stopExport(true), 400);
        return;
      }
      nextAt += frameStep;
      setTimeout(tick, Math.max(0, nextAt - performance.now()));
    };

    render(0);
    videoTrack.requestFrame();
    nextAt = performance.now() + frameStep;
    setTimeout(tick, frameStep);
  }

  btnExport.addEventListener('click', startExport);
  btnCancel.addEventListener('click', () => stopExport(false));

  // ══════════════════════════ 11. 主循环 ══════════════════════════
  let last = performance.now();
  function loop(now) {
    const dt = (now - last) / 1000;
    last = now;
    if (state.playing && !state.exporting) {
      state.t += dt;
      if (state.t >= DURATION) {
        if (state.loop) state.t = 0;
        else { state.t = DURATION; pause(); }
      }
      render(state.t);
      syncUI();
    }
    requestAnimationFrame(loop);
  }

  render(0);
  syncUI();
  setPlayIcon();
  requestAnimationFrame(loop);

  // 字体就绪后重绘，避免首帧回退字体
  if (document.fonts && document.fonts.ready) {
    const reload = () => {
      render(state.t);
      Promise.all([
        document.fonts.load('700 112px "Noto Serif SC"'),
        document.fonts.load('500 32px "Noto Sans SC"'),
      ]).then(() => render(state.t)).catch(() => {});
    };
    document.fonts.ready.then(reload).catch(() => {});
  }

  // 调试与截图：window.__film.seek(秒) / ?t=秒 / ?autoplay
  window.__film = { seek, play, pause, render, DURATION, SCENES };

  const params = new URLSearchParams(location.search);
  if (params.has('t')) seek(Number(params.get('t')));
  if (params.has('autoplay')) play();
})();
