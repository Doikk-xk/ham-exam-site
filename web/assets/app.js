/* ==========================================================================
   业余无线电 A/B/C 类练题站 · 应用逻辑
   数据：window.__EXAM_DATA__ 由 data/exam.js 提供（CRAC 2025 年版 A/B/C 类题库）
   ========================================================================== */
(function () {
  "use strict";

  var ALL = window.__EXAM_DATA__;   // { a: {...}, b: {...}, c: {...} }
  var CLASS_ORDER = ["a", "b", "c"];
  var CLASS_LABEL = { a: "A 类", b: "B 类", c: "C 类" };

  // 当前类别相关的派生数据，随 switchClass 重建
  var D = null, QS = [], META = null, byId = {}, groups = {}, SINGLE_IDS = [], MULTI_IDS = [];

  function buildClassData(k) {
    D = ALL[k];
    QS = D.q;
    META = D.meta;
    byId = {};
    QS.forEach(function (q) { byId[q.i] = q; });
    groups = {};
    META.chapters.forEach(function (c) {
      c.groups.forEach(function (g) { groups[g.g] = { name: g.name, ids: [], chap: c.id }; });
    });
    QS.forEach(function (q) { groups[q.g].ids.push(q.i); });
    SINGLE_IDS = QS.filter(function (q) { return q.t === 0; }).map(function (q) { return q.i; });
    MULTI_IDS = QS.filter(function (q) { return q.t === 1; }).map(function (q) { return q.i; });
  }

  /* ====================================================== 工具 */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function h(html) { var t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function sample(arr, n) { return shuffle(arr).slice(0, n); }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function daysBetween(a, b) {
    return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
  }
  function mmss(sec) {
    sec = Math.max(0, Math.round(sec));
    return pad(Math.floor(sec / 60)) + ":" + pad(sec % 60);
  }
  function mmssLong(sec) {
    sec = Math.max(0, Math.round(sec));
    var m = Math.floor(sec / 60);
    return (m > 0 ? m + " 分 " : "") + (sec % 60) + " 秒";
  }
  function pct(a, b) { return b ? Math.round((a / b) * 100) : 0; }
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._tm);
    t._tm = setTimeout(function () { t.classList.remove("show"); }, 1900);
  }

  /* ====================================================== 状态 */
  // 全局设置与每类别进度分开存储：设置共享，进度按类别隔离
  var SETTINGS_KEY = "crac_settings_v1";
  var STATE_PREFIX = "crac_state_v1_";   // + a/b/c
  var LEGACY_KEY = "crac_b_state_v1";     // 旧版单类数据，首次加载迁移到 B 类

  var DEFAULT_SETTINGS = {
    shuffleOptions: true, autoNext: false, examDate: "2026-11-14", dailyGoal: 120,
    theme: "light", removeWrongOnCorrect: true, curClass: "b"
  };
  var DEFAULT_STATE = {
    progress: {},   // qid -> {r, w, last}
    wrong: [],
    fav: [],
    history: [],
    daily: {},
    seq: 0,
    practice: {},   // 各练习目标的断点进度 { [key]: { pos, ans, revealed } }
    plan: {}
  };

  function loadSettings() {
    var s = {};
    try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {}; } catch (e) { s = {}; }
    var out = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    if (s && typeof s === "object") for (var k in s) if (k in out) out[k] = s[k];
    return out;
  }
  function loadState(klass) {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(STATE_PREFIX + klass) || "null"); } catch (e) { raw = null; }
    if (!raw) {
      // 迁移旧版单类数据 -> B 类
      if (klass === "b") {
        try {
          var leg = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
          if (leg) {
            raw = JSON.parse(JSON.stringify(DEFAULT_STATE));
            ["progress", "wrong", "fav", "history", "daily", "practice", "plan"].forEach(function (k) { if (leg[k]) raw[k] = leg[k]; });
            if (typeof leg.seq === "number") raw.seq = leg.seq;
          }
        } catch (e) {}
      }
    }
    if (!raw) raw = JSON.parse(JSON.stringify(DEFAULT_STATE));
    return raw;
  }

  var S = loadState("b");            // 当前类别进度状态
  S.settings = loadSettings();       // 全局设置挂在 S.settings 上，代码里无需改动

  // 当前类别（默认 B 类）
  var curClass = S.settings.curClass || "b";
  if (!ALL[curClass]) curClass = "b";
  if (curClass !== "b") { S = loadState(curClass); S.settings = loadSettings(); }
  buildClassData(curClass);

  function switchClass(k) {
    if (!ALL[k] || k === curClass) return;
    // 先把当前类别的进度 flush
    flush();
    S.settings.curClass = k;
    saveSettings();
    curClass = k;
    S = loadState(k);
    S.settings = loadSettings();
    buildClassData(k);
    renderClassSwitcher();
    renderNavCounts();
    route();
    // 登录态下，切类别后从服务器拉取该类别进度（覆盖本地缓存）
    if (AUTH.user) {
      pullFromServer().then(function () {
        buildClassData(k);
        renderNavCounts();
        route();
      });
    }
  }

  // 当前类别考试规则
  function examRule() { return META.exam; }
  function ruleText() {
    var e = examRule();
    return e.count + " 题 / " + e.minutes + " 分钟 / 答对 " + e.pass + " 题为合格";
  }

  /* ====================================================== 后端同步层 */
  var AUTH = { user: null };
  var SYNC_TM = null;

  function api(path, opts) {
    opts = opts || {};
    var o = {
      method: opts.method || "GET",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin"
    };
    if (opts.body !== undefined) o.body = JSON.stringify(opts.body);
    return fetch(path, o).then(function (resp) {
      return resp.json().then(function (data) {
        return { status: resp.status, data: data };
      }).catch(function () {
        return { status: resp.status, data: {} };
      });
    });
  }

  function syncToServer() {
    if (!AUTH.user) return;
    clearTimeout(SYNC_TM);
    SYNC_TM = setTimeout(function () {
      api("/api/progress/" + curClass, { method: "POST", body: S }).then(function (r) {
        if (r.status === 401) setLoggedOut();
      });
    }, 300);
  }

  function pullFromServer() {
    return api("/api/progress/" + curClass).then(function (r) {
      if (r.status === 200 && r.data.ok && r.data.data) {
        try {
          var remote = JSON.parse(r.data.data);
          var merged = JSON.parse(JSON.stringify(DEFAULT_STATE));
          ["progress", "wrong", "fav", "history", "daily", "practice", "plan"].forEach(function (k) {
            if (remote[k]) merged[k] = remote[k];
          });
          if (typeof remote.seq === "number") merged.seq = remote.seq;
          merged.settings = S.settings;
          S = merged;
          localStorage.setItem(STATE_PREFIX + curClass, JSON.stringify(S));
        } catch (e) {}
      }
    });
  }

  function setLoggedOut() {
    AUTH.user = null;
    renderAuthUI();
    renderNavCounts();
    toast("已退出登录");
    // 登出后回到登录页
    route();
  }

  var saveTm = null;
  function save() {
    clearTimeout(saveTm);
    saveTm = setTimeout(flush, 120);
  }
  function flush() {
    clearTimeout(saveTm);
    saveTm = null;
    try { localStorage.setItem(STATE_PREFIX + curClass, JSON.stringify(S)); } catch (e) { /* 配额满时忽略 */ }
    saveSettings();
    syncToServer();
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S.settings)); } catch (e) {}
  }
  window.addEventListener("beforeunload", function () { if (saveTm) flush(); });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden" && saveTm) flush();
  });

  function rec(qid) {
    if (!S.progress[qid]) S.progress[qid] = { r: 0, w: 0, last: 0 };
    return S.progress[qid];
  }
  function hasDone(qid) { var r = S.progress[qid]; return !!(r && (r.r + r.w) > 0); }

  function recordAnswer(qid, ok) {
    var r = rec(qid);
    r.last = Date.now();
    if (ok) { r.r++; } else { r.w++; }
    var wi = S.wrong.indexOf(qid);
    if (ok) {
      if (S.settings.removeWrongOnCorrect && wi >= 0) S.wrong.splice(wi, 1);
    } else if (wi < 0) {
      S.wrong.push(qid);
    }
    var d = S.daily[today()] || (S.daily[today()] = { n: 0, c: 0 });
    d.n++; if (ok) d.c++;
    save();
    renderNavCounts();
  }

  function renderNavCounts() {
    $("#nav-wrong").textContent = S.wrong.length;
    $("#nav-fav").textContent = S.fav.length;
  }

  /* ====================================================== 会话（练习） */
  var sess = null;   // {mode,title,ids,pos,perm,ans,revealed,key}

  function newSession(mode, title, ids, key) {
    sess = {
      mode: mode, title: title, ids: ids, pos: 0,
      perm: {}, ans: {}, revealed: {}, key: key || null
    };
    return sess;
  }
  function permOf(q) {
    var key = String(q.i);
    if (!sess.perm[key]) {
      var base = q.o.map(function (_, i) { return i; });
      sess.perm[key] = S.settings.shuffleOptions ? shuffle(base) : base;
    }
    return sess.perm[key];
  }
  // 显示位置 -> 原始下标
  function origIdx(q, disp) { return permOf(q)[disp]; }

  function judge(q, dispPicked) {
    var picked = dispPicked.map(function (d) { return origIdx(q, d); }).sort(function (a, b) { return a - b; });
    var ans = q.a.slice().sort(function (a, b) { return a - b; });
    if (picked.length !== ans.length) return { ok: false, why: picked.length < ans.length ? "少选" : "多选", picked: picked };
    for (var i = 0; i < ans.length; i++) if (picked[i] !== ans[i]) return { ok: false, why: "选错", picked: picked };
    return { ok: true, picked: picked };
  }

  /* ====================================================== 路由 */
  var VIEWS = {};
  function go(hash) { location.hash = hash; }
  var PUBLIC_ROUTES = { login: 1, register: 1 };
  function route() {
    var hash = location.hash.replace(/^#\/?/, "") || "home";
    var parts = hash.split("/");
    var name = parts[0] || "home";
    var arg = parts.slice(1).join("/");

    // 登录保护：未登录只能访问 login/register
    if (!AUTH.user && !PUBLIC_ROUTES[name]) {
      if (name !== "login") { location.replace("#/login"); }
      name = "login";
      arg = "";
    }
    // 已登录则不能再进登录/注册页
    if (AUTH.user && PUBLIC_ROUTES[name]) {
      location.replace("#/home");
      name = "home";
      arg = "";
    }
    // 管理员路由保护
    if (name === "admin" && (!AUTH.user || !AUTH.user.is_admin)) {
      location.replace("#/home");
      name = "home";
      arg = "";
    }

    // 练习/考试进行中离开保护
    if (exam && !exam.submitted && name !== "exam") { /* 允许后台继续，仅提示 */ }

    var fn = VIEWS[name] || VIEWS.home;
    var main = $("#main");
    stopExamTimer();
    main.innerHTML = "";
    main.classList.remove("wide");
    document.body.classList.toggle("bare", PUBLIC_ROUTES[name] === 1);
    fn(main, arg);
    document.querySelectorAll(".nav-item").forEach(function (a) {
      a.classList.toggle("active", a.getAttribute("href") === "#/" + name);
    });
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);

  /* ====================================================== 视图：仪表盘 */
  VIEWS.home = function (root) {
    var total = META.total;
    var done = 0, right = 0, wrongCnt = S.wrong.length;
    QS.forEach(function (q) {
      var r = S.progress[q.i];
      if (r) { done++; right += r.r; }
    });
    var answered = 0;
    QS.forEach(function (q) { var r = S.progress[q.i]; if (r) answered += r.r + r.w; });
    var acc = pct(right, answered);

    var dd = S.settings.examDate ? daysBetween(today(), S.settings.examDate) : null;
    var d = S.daily[today()] || { n: 0, c: 0 };
    var goalPct = pct(d.n, S.settings.dailyGoal);

    var stage = "";
    if (dd === null) stage = "未设置考试日期";
    else if (dd < 0) stage = "考试日期已过，请到设置里更新";
    else if (dd > 45) stage = "基础期 · 全面过题";
    else if (dd > 21) stage = "强化期 · 章节收口";
    else if (dd > 7) stage = "冲刺期 · 全真模拟";
    else stage = "决战期 · 只过错题";

    root.appendChild(h(
      '<div class="page-head"><div><h1>仪表盘</h1>' +
      '<p>' + esc(META.title) + ' · ' + esc(META.klass) + ' · 共 ' + total + ' 题（单选 ' + META.single + ' / 多选 ' + META.multi + '）</p>' +
      '</div><div class="row">' +
      '<button class="btn" data-go="#/chapter">章节专项</button>' +
      '<button class="btn primary" data-go="#/exam">开始模考</button>' +
      '</div></div>'
    ));

    // 倒计时 + 今日
    var top = h('<div class="grid g3" style="margin-bottom:16px"></div>');
    top.appendChild(h(
      '<div class="card"><div class="stat"><span class="k">距考试还有</span>' +
      '<span class="v">' + (dd === null ? "—" : (dd >= 0 ? dd : 0)) + '<small>天</small></span></div>' +
      '<div class="small muted" style="margin-top:8px">考试日 ' + esc(S.settings.examDate || "未设置") + ' · ' + esc(stage) + '</div>' +
      '<div class="small muted" style="margin-top:2px">' + esc(META.klass) + '：' + ruleText() + '</div></div>'
    ));
    top.appendChild(h(
      '<div class="card"><div class="stat"><span class="k">今日已练</span>' +
      '<span class="v">' + d.n + '<small>题</small></span></div>' +
      '<div class="bar" style="margin:10px 0 8px"><i style="width:' + Math.min(100, goalPct) + '%"></i></div>' +
      '<div class="small muted">今日正确 ' + d.c + ' 题（' + pct(d.c, d.n) + '%） · 目标 ' + S.settings.dailyGoal + ' 题 / 天</div></div>'
    ));
    top.appendChild(h(
      '<div class="card"><div class="stat"><span class="k">累计正确率</span>' +
      '<span class="v">' + acc + '<small>%</small></span></div>' +
      '<div class="small muted" style="margin-top:8px">累计作答 ' + answered + ' 次 · 做对 ' + right + ' 次</div>' +
      '<div class="small muted" style="margin-top:2px">已覆盖 ' + done + ' / ' + total + ' 题（' + pct(done, total) + '%）</div></div>'
    ));
    root.appendChild(top);

    // 章节掌握度
    var cg = h('<div class="card"><h2>章节掌握度</h2><div id="chapbars"></div>' +
      '<div class="legend"><span><i style="background:var(--ok)"></i>正确率</span><span><i style="background:var(--accent)"></i>覆盖进度</span></div></div>');
    root.appendChild(cg);
    var cb = $("#chapbars", cg);
    META.chapters.forEach(function (c) {
      var ids = [];
      c.groups.forEach(function (g) { ids = ids.concat(groups[g.g].ids); });
      var st = agg(ids);
      cb.appendChild(barLine(c.name, st.acc, st.cover, ids.length + " 题", "#/chapter"));
    });

    // 最近模考
    var hist = S.history.slice(-6).reverse();
    var hc = h('<div class="card"><h2>最近模拟考试</h2>' +
      (hist.length ? '<table class="tbl"><thead><tr><th>时间</th><th>得分</th><th>用时</th><th>结果</th></tr></thead><tbody>' +
        hist.map(function (x) {
          return '<tr><td class="small">' + esc(x.t) + '</td><td><b>' + x.score + '</b> / ' + x.total + '</td>' +
            '<td class="small">' + esc(x.dur) + '</td>' +
            '<td>' + (x.pass ? '<span class="chip ok">合格</span>' : '<span class="chip bad">未通过</span>') + '</td></tr>';
        }).join("") + '</tbody></table>'
        : '<div class="empty"><div class="big">◷</div>还没有模考记录，做一套试试手</div>') +
      '</div>');
    root.appendChild(hc);

    var quick = h('<div class="card"><h2>快捷开始</h2><div class="row"></div></div>');
    root.appendChild(quick);
    var qr = $(".row", quick);
    [
      ["顺序练习（继续）", function () { startSeq(); }],
      ["随机练习 " + examRule().count + " 题", function () { startPractice("rand", "随机练习", sample(QS.map(function (q) { return q.i; }), examRule().count)); }],
      ["未做过的题", function () { startPractice("unseen", "未做过的题", QS.filter(function (q) { return !hasDone(q.i); }).map(function (q) { return q.i; }), "unseen"); }],
      ["多选专项（" + MULTI_IDS.length + " 题）", function () { startPractice("multi", "多选专项", MULTI_IDS, "multi"); }],
      ["错题重练", function () { startPractice("wrong", "错题重练", S.wrong.slice()); }],
      ["只看收藏", function () { startPractice("fav", "收藏题", S.fav.slice()); }]
    ].forEach(function (b) {
      var btn = h('<button class="btn">' + b[0] + "</button>");
      btn.onclick = b[1];
      qr.appendChild(btn);
      return btn;
    });

    root.querySelectorAll("[data-go]").forEach(function (el) {
      el.onclick = function () { go(el.getAttribute("data-go")); };
    });
  };

  function agg(ids) {
    var done = 0, ans = 0, ok = 0;
    ids.forEach(function (i) {
      var r = S.progress[i];
      if (!r) return;
      done++;
      ans += r.r + r.w;
      ok += r.r;
    });
    return { done: done, acc: pct(ok, ans), cover: pct(done, ids.length), ans: ans, ok: ok };
  }

  function barLine(name, acc, cover, tail, href) {
    var node = h(
      '<div class="barline" ' + (href ? 'style="cursor:pointer"' : "") + '>' +
      '<div class="name">' + esc(name) + '<em>' + esc(tail) + '</em></div>' +
      '<div><div class="bar ' + (acc >= 90 ? "ok" : acc && acc < 60 ? "bad" : "") + '"><i style="width:' + acc + '%"></i></div>' +
      '<div class="bar" style="margin-top:4px;height:5px"><i style="width:' + cover + '%"></i></div></div>' +
      '<div class="tail">正确率 <b>' + acc + '%</b> · 覆盖 ' + cover + '%</div></div>'
    );
    if (href) node.onclick = function () { go(href); };
    return node;
  }

  /* ====================================================== 视图：顺序 / 随机练习 */
  VIEWS.practice = function (root) {
    root.appendChild(h('<div class="page-head"><div><h1>顺序 / 随机练习</h1>' +
      '<p>按题库顺序从头刷，进度自动保存；也可以随机抽题。</p></div></div>'));

    var card = h('<div class="card"><h2>练习设置</h2>' +
      '<div class="setrow"><div class="lbl"><b>起始位置</b><span>上次停在顺序第 ' + (S.seq + 1) + ' 题</span></div>' +
      '<div class="row"><input class="input" id="seqnum" type="number" min="1" max="' + QS.length + '" value="' + (S.seq + 1) + '" style="width:110px"></div></div>' +
      '<div class="setrow"><div class="lbl"><b>随机抽题数量</b><span>从全题库随机抽取</span></div>' +
      '<select class="input" id="randnum"><option>30</option><option selected>60</option><option>100</option><option>200</option></select></div>' +
      '<div class="setrow"><div class="lbl"><b>选项乱序</b><span>正式机考会打乱选项位置，建议保持开启</span></div>' +
      toggle("shuffleOptions") + '</div>' +
      '<div class="setrow"><div class="lbl"><b>答对自动跳下一题</b><span>答错的题会停留，方便看正确答案</span></div>' +
      toggle("autoNext") + '</div>' +
      '</div>');
    root.appendChild(card);

    var row = h('<div class="card"><div class="row">' +
      '<button class="btn primary lg" id="b-seq">继续顺序练习</button>' +
      '<button class="btn lg" id="b-seq0">从第 1 题开始</button>' +
      '<button class="btn lg" id="b-rand">随机练习</button>' +
      '<button class="btn lg" id="b-unseen">只练没做过的</button>' +
      '<button class="btn lg" id="b-multi">多选专项</button>' +
      '<button class="btn lg" id="b-hard">我错得最多的题</button>' +
      '</div></div>');
    root.appendChild(row);

    $("#b-seq", row).onclick = function () {
      var v = Math.max(1, Math.min(QS.length, parseInt($("#seqnum", card).value, 10) || 1));
      S.seq = v - 1; save(); startSeq();
    };
    $("#b-seq0", row).onclick = function () { S.seq = 0; save(); startSeq(); };
    $("#b-rand", row).onclick = function () {
      var n = +$("#randnum", card).value;
      startPractice("rand", "随机练习 " + n + " 题", sample(QS.map(function (q) { return q.i; }), n));
    };
    $("#b-unseen", row).onclick = function () {
      var ids = QS.filter(function (q) { return !hasDone(q.i); }).map(function (q) { return q.i; });
      if (!ids.length) return toast("全部题目都做过了");
      startPractice("unseen", "未做过的题", ids, "unseen");
    };
    $("#b-multi", row).onclick = function () { startPractice("multi", "多选专项", MULTI_IDS, "multi"); };
    $("#b-hard", row).onclick = function () {
      var ids = QS.filter(function (q) { var r = S.progress[q.i]; return r && r.w > 0; })
        .sort(function (a, b) { return S.progress[b.i].w - S.progress[a.i].w; })
        .slice(0, 60).map(function (q) { return q.i; });
      if (!ids.length) return toast("还没有错题记录");
      startPractice("hard", "高频错题 60 题", ids);
    };
    bindToggles(card);
  };

  function startSeq() {
    var ids = QS.map(function (q) { return q.i; });
    var s = newSession("seq", "顺序练习", ids);
    s.pos = Math.max(0, Math.min(S.seq, ids.length - 1));
    renderRunner($("#main"), s);
  }

  // 练习目标断点：按 key 持久化 pos / ans / revealed，做到一半关掉下次续练
  function practiceKey(mode, title, ids, key) {
    if (key) return mode + ":" + key;
    // 无显式 key 时，用 ids 的稳定指纹兜底（顺序敏感）
    return mode + ":" + ids.join(",");
  }
  function savePracticeProgress(s) {
    if (!s.key) return;
    S.practice[s.key] = { pos: s.pos, ans: s.ans, revealed: s.revealed };
    save();
  }
  function clearPracticeProgress(key) {
    if (key && S.practice[key]) { delete S.practice[key]; save(); }
  }

  function startPractice(mode, title, ids, key) {
    if (!ids.length) return toast("没有符合条件的题目");
    var pk = practiceKey(mode, title, ids, key);
    var s = newSession(mode, title, ids, pk);
    // 断点续练：恢复上次的进度与作答记录
    var saved = S.practice[pk];
    if (saved && saved.ans) {
      s.pos = Math.max(0, Math.min(saved.pos || 0, ids.length - 1));
      // 仅恢复仍在本次 ids 里的作答记录
      var idSet = {};
      ids.forEach(function (i) { idSet[i] = 1; });
      Object.keys(saved.ans || {}).forEach(function (qid) {
        if (idSet[qid]) s.ans[qid] = saved.ans[qid];
      });
      Object.keys(saved.revealed || {}).forEach(function (qid) {
        if (idSet[qid]) s.revealed[qid] = saved.revealed[qid];
      });
    }
    renderRunner($("#main"), s);
  }

  function bindToggles(root) {
    root.querySelectorAll("[data-toggle]").forEach(function (cb) {
      cb.onchange = function () {
        S.settings[cb.getAttribute("data-toggle")] = cb.checked;
        save();
        if (cb.getAttribute("data-toggle") === "shuffleOptions") {
          if (sess) sess.perm = {};
          if (sess) renderRunner($("#main"), sess);
        }
      };
    });
  }
  function toggle(key) {
    return '<label class="switch"><input type="checkbox" data-toggle="' + key + '"' +
      (S.settings[key] ? " checked" : "") + '><i></i></label>';
  }

  /* ====================================================== 练习答题器 */
  function renderRunner(root, s) {
    stopExamTimer();
    sess = s;
    root.innerHTML = "";
    root.classList.add("wide");
    var q = byId[s.ids[s.pos]];
    var st = s.ans[q.i];
    var answered = !!(st && st.res);   // 已判分（多选仅勾选不算）
    var perm = permOf(q);

    root.appendChild(h('<div class="page-head"><div><h1>' + esc(s.title) +
      '</h1><p>共 ' + s.ids.length + ' 题 · 第 ' + (s.pos + 1) + ' 题 · ' +
      '<span class="mono">' + esc(q.c) + '</span></p></div>' +
      '<div class="row">' + toggleInline() + '<button class="btn" id="exit">返回</button></div></div>'));
    var shufCb = $("#shuf-inline", root);
    if (shufCb) shufCb.onchange = function () {
      S.settings.shuffleOptions = shufCb.checked;
      save();
      sess.perm = {};
      renderRunner(root, s);
    };

    var wrap = h('<div class="qwrap"></div>');
    root.appendChild(wrap);

    /* ---- 题目卡 ---- */
    var card = h('<div class="qcard"></div>');
    card.appendChild(h(
      '<div class="qhead">' +
      '<span class="idx">' + (s.pos + 1) + " / " + s.ids.length + '</span>' +
      '<span class="chip">' + esc(groups[q.g].name) + " · " + esc(q.s) + '</span>' +
      (q.t === 0 ? '<span class="chip single">单选</span>' : '<span class="chip multi">多选</span>') +
      (S.fav.indexOf(q.i) >= 0 ? '<span class="chip ok">已收藏</span>' : "") +
      '<span class="spacer"></span>' +
      (S.progress[q.i] ? '<span class="small muted">累计 对' + rec(q.i).r + ' / 错' + rec(q.i).w + '</span>' : '<span class="small muted">未做过</span>') +
      '</div>'
    ));

    var body = h('<div class="qbody"></div>');
    body.appendChild(h('<div class="stem">' + esc(q.q) + "</div>"));
    if (q.m) body.appendChild(h('<div class="qimg"><img src="' + esc(q.m) + '" alt="题图"></div>'));

    var optBox = h('<div class="opts"></div>');
    body.appendChild(optBox);

    var picked = (st && st.disp) ? st.disp.slice() : [];
    var revealed = answered || !!s.revealed[q.i];

    perm.forEach(function (oi, di) {
      var cls = "opt" + (revealed ? " locked" : "");
      var mark = "";
      if (revealed) {
        var isAns = q.a.indexOf(oi) >= 0;
        var isPick = picked.indexOf(di) >= 0;
        if (isAns) { cls += " right"; mark = "正确答案"; }
        else if (isPick) { cls += " wrong"; mark = "你选的"; }
      } else if (picked.indexOf(di) >= 0) {
        cls += " sel";
      }
      var node = h('<button class="' + cls + '" data-di="' + di + '">' +
        '<span class="key">' + String.fromCharCode(65 + di) + '</span>' +
        '<span style="flex:1">' + esc(q.o[oi]) + '</span>' +
        (mark ? '<span class="mark">' + mark + "</span>" : "") +
        "</button>");
      node.onclick = function () {
        if (revealed) return;
        if (q.t === 0) {
          s.ans[q.i] = { disp: [di] };
          finishAnswer(s, q, [di], true);
        } else {
          var arr = (s.ans[q.i] && s.ans[q.i].disp) ? s.ans[q.i].disp.slice() : [];
          var k = arr.indexOf(di);
          if (k >= 0) arr.splice(k, 1); else arr.push(di);
          s.ans[q.i] = { disp: arr };
          renderRunner(root, s);
        }
      };
      optBox.appendChild(node);
    });

    // 判分结果
    if (answered) {
      var r = st.res;
      var dispAns = q.a.map(function (oi) { return perm.indexOf(oi); })
        .sort(function (a, b) { return a - b; })
        .map(function (d) { return String.fromCharCode(65 + d); }).join("");
      var you = (st.disp || []).slice().sort(function (a, b) { return a - b; })
        .map(function (d) { return String.fromCharCode(65 + d); }).join("") || "未作答";
      if (r.ok) {
        body.appendChild(h('<div class="verdict ok"><b>回答正确</b>' +
          '<span class="sub">正确答案：' + dispAns + "　你的答案：" + you + "</span></div>"));
      } else {
        var why = q.t === 1
          ? (r.why === "少选" ? "多选题必须与标准答案完全一致 —— 少选了。" : r.why === "多选" ? "多选题必须与标准答案完全一致 —— 多选了。" : "多选题必须与标准答案完全一致 —— 选项选错了。")
          : "";
        body.appendChild(h('<div class="verdict bad"><b>回答错误</b>' +
          '<span class="sub">正确答案：' + dispAns + "　你的答案：" + you + (why ? "　" + why : "") + "</span></div>"));
      }
      if (q.e) body.appendChild(h('<div class="explain"><b>解析</b>' + esc(q.e) + "</div>"));
    } else if (q.t === 1) {
      body.appendChild(h('<div class="callout small">多选题需要选完所有正确选项后点“提交答案”。正式考试中多选必须与标准答案完全一致，多选、少选都不得分。</div>'));
    }

    card.appendChild(body);

    /* ---- 底栏 ---- */
    var foot = h('<div class="qfoot">' +
      (answered || s.revealed[q.i] ? "" : '<button class="btn ghost" id="show">显示答案</button>') +
      '<div class="nav-group">' +
      '<button class="btn nav-btn" id="prev">← 上一题</button>' +
      '<button class="btn nav-btn" id="next">下一题 →</button>' +
      '</div>' +
      (q.t === 1 && !answered ? '<button class="btn primary" id="submit">提交答案</button>' : "") +
      '<span class="spacer"></span>' +
      '<button class="btn ghost" id="fav">' + (S.fav.indexOf(q.i) >= 0 ? "★ 取消收藏" : "☆ 收藏") + '</button>' +
      '<span class="kbdhint"><span class="kbd">1-4</span> 选项 <span class="kbd">←</span><span class="kbd">→</span> 翻页 <span class="kbd">Enter</span> 提交/下一题 <span class="kbd">F</span> 收藏</span>' +
      '</div>');
    card.appendChild(foot);
    wrap.appendChild(card);

    $("#prev", foot).onclick = function () { jump(-1); };
    $("#next", foot).onclick = function () { jump(1); };
    $("#fav", foot).onclick = function () { toggleFav(q.i); renderRunner(root, s); };
    if ($("#show", foot)) $("#show", foot).onclick = function () { s.revealed[q.i] = true; renderRunner(root, s); };
    if ($("#submit", foot)) $("#submit", foot).onclick = function () {
      var arr = (s.ans[q.i] && s.ans[q.i].disp) || [];
      if (!arr.length) return toast("请先选择答案");
      finishAnswer(s, q, arr, false);
    };

    /* ---- 侧栏答题卡 ---- */
    var side = h('<div class="sheet"></div>');
    var cardIds = s.ids;
    var grid = h('<div class="sheet-card"><h3><span>答题卡</span><span class="small muted" id="cnt"></span></h3>' +
      '<div class="sheet-grid" id="grid"></div>' +
      '<div class="legend"><span><i style="background:var(--ok)"></i>对</span><span><i style="background:var(--bad)"></i>错</span>' +
      '<span><i style="background:var(--accent-soft);border:1px solid var(--accent)"></i>当前</span></div></div>');
    side.appendChild(grid);
    var g = $("#grid", grid);
    cardIds.forEach(function (id, k) {
      var a = s.ans[id];
      var cls = "cell" + (a && a.res ? (a.res.ok ? " right" : " wrong") : a ? " done" : "");
      if (k === s.pos) cls += " cur";
      var node = h('<button class="' + cls + '">' + (k + 1) + "</button>");
      node.onclick = function () {
        s.pos = k;
        if (s.mode !== "seq") savePracticeProgress(s);
        renderRunner(root, s);
      };
      g.appendChild(node);
    });
    var okN = 0, badN = 0;
    cardIds.forEach(function (id) {
      var a = s.ans[id];
      if (a && a.res) { if (a.res.ok) okN++; else badN++; }
    });
    $("#cnt", grid).textContent = "对 " + okN + " · 错 " + badN + " · 余 " + (cardIds.length - okN - badN);

    // 本会话小结
    var sum = h('<div class="sheet-card"><h3>本次练习</h3>' +
      '<div class="small muted" style="line-height:1.9">' +
      '已答 ' + (okN + badN) + ' 题<br>正确率 <b>' + pct(okN, okN + badN) + '%</b><br>' +
      '错题本累计 ' + S.wrong.length + ' 题</div></div>');
    side.appendChild(sum);
    var b2 = h('<button class="btn sm ghost" style="width:100%">清空本次作答记录</button>');
    b2.onclick = function () {
      s.ans = {}; s.revealed = {};
      savePracticeProgress(s);
      renderRunner(root, s);
    };
    sum.appendChild(b2);
    // 重新练习：清空该目标的断点进度，从头再来
    if (s.key) {
      var b3 = h('<button class="btn sm" style="width:100%">重新练习（从头开始）</button>');
      b3.onclick = function () {
        s.pos = 0; s.ans = {}; s.revealed = {};
        savePracticeProgress(s);
        renderRunner(root, s);
        toast("已重新开始");
      };
      sum.appendChild(b3);
    }
    wrap.appendChild(side);

    $("#exit", root).onclick = function () {
      if (s.mode !== "seq") savePracticeProgress(s);
      go("#/home");
    };

    function jump(d) {
      var np = s.pos + d;
      if (np < 0) return toast("已经是第一题");
      if (np >= s.ids.length) return toast("已经是最后一题，可以返回看看答题卡");
      s.pos = np;
      if (s.mode === "seq") { S.seq = np; save(); }
      else savePracticeProgress(s);
      renderRunner(root, s);
    }
  }

  function toggleInline() {
    return '<label class="chip" style="gap:7px;cursor:pointer"><input type="checkbox" id="shuf-inline" ' +
      (S.settings.shuffleOptions ? "checked" : "") + ' style="accent-color:var(--accent)"> 选项乱序</label>';
  }

  function finishAnswer(s, q, dispArr, auto) {
    var r = judge(q, dispArr);
    s.ans[q.i] = { disp: dispArr.slice(), res: r };
    recordAnswer(q.i, r.ok);
    if (s.mode === "seq") S.seq = s.pos;
    else savePracticeProgress(s);
    save();
    var root = $("#main");
    if (auto && r.ok && S.settings.autoNext && s.pos < s.ids.length - 1) {
      s.pos++;
      if (s.mode === "seq") S.seq = s.pos;
      else savePracticeProgress(s);
      save();
      renderRunner(root, s);
      window.scrollTo(0, 0);
      return;
    }
    renderRunner(root, s);
  }

  function toggleFav(qid) {
    var k = S.fav.indexOf(qid);
    if (k >= 0) { S.fav.splice(k, 1); toast("已取消收藏"); }
    else { S.fav.push(qid); toast("已加入收藏"); }
    save();
    renderNavCounts();
  }

  /* ====================================================== 视图：章节专项 */
  VIEWS.chapter = function (root, arg) {
    root.appendChild(h('<div class="page-head"><div><h1>章节专项</h1>' +
      '<p>按题库大纲分类练习。点章节名可按整章练，点小节可按小节练。</p></div></div>'));

    META.chapters.forEach(function (c) {
      var ids = [];
      c.groups.forEach(function (g) { ids = ids.concat(groups[g.g].ids); });
      var st = agg(ids);
      var card = h('<div class="card"></div>');
      card.appendChild(h(
        '<div class="row" style="justify-content:space-between;margin-bottom:12px">' +
        '<div><h2 style="margin:0">第 ' + c.id + " 章 · " + esc(c.name) + '</h2>' +
        '<div class="small muted">共 ' + c.n + ' 题（单选 ' + c.single + " / 多选 " + c.multi + '） · 覆盖 ' + st.cover + '% · 正确率 ' + st.acc + '%</div></div>' +
        '<button class="btn primary" data-ids="' + c.id + '">练这一章</button></div>'
      ));
      var list = h("<div></div>");
      c.groups.forEach(function (g) {
        var gst = agg(groups[g.g].ids);
        var line = h('<div class="barline" style="cursor:pointer">' +
          '<div class="name">' + esc(g.name) + '<em>' + g.n + ' 题</em></div>' +
          '<div><div class="bar ' + (gst.acc >= 90 ? "ok" : gst.acc && gst.acc < 60 ? "bad" : "") + '"><i style="width:' + gst.acc + '%"></i></div>' +
          '<div class="bar" style="margin-top:4px;height:5px"><i style="width:' + gst.cover + '%"></i></div></div>' +
          '<div class="tail">' + gst.cover + '% · ' + gst.acc + '%</div></div>');
        line.onclick = function () { startPractice("chapter", c.name + " · " + g.name, groups[g.g].ids.slice(), c.id + "." + g.g); };
        list.appendChild(line);
      });
      card.appendChild(list);
      root.appendChild(card);
      $("[data-ids]", card).onclick = function () {
        startPractice("chapter", "第 " + c.id + " 章 · " + c.name, ids.slice(), "ch" + c.id);
      };
    });

    if (arg) {
      var c = META.chapters.filter(function (x) { return x.id === arg; })[0];
      if (c) {
        var ids2 = [];
        c.groups.forEach(function (g) { ids2 = ids2.concat(groups[g.g].ids); });
        startPractice("chapter", "第 " + c.id + " 章 · " + c.name, ids2, "ch" + c.id);
      }
    }
  };

  /* ====================================================== 视图：模拟考试 */
  var exam = null;
  var examTimer = null;

  VIEWS.exam = function (root) {
    var e = examRule();
    var verify = e.verify ? ' <span class="chip" style="color:var(--warn);background:var(--warn-soft);border-color:transparent">规则待核实</span>' : "";
    root.appendChild(h('<div class="page-head"><div><h1>模拟考试</h1>' +
      '<p>完全按正式规则组卷：' + e.count + ' 题（单选 ' + e.single + ' + 多选 ' + e.multi + '），限时 ' + e.minutes + ' 分钟，答对 ' + e.pass + ' 题为合格。多选题必须与标准答案完全一致。' + verify + '</p></div></div>'));

    root.appendChild(h('<div class="grid g4" style="margin-bottom:16px">' +
      '<div class="card"><div class="stat"><span class="k">试卷题量</span><span class="v">' + e.count + '<small>题</small></span></div><div class="small muted">单选 ' + e.single + ' · 多选 ' + e.multi + '</div></div>' +
      '<div class="card"><div class="stat"><span class="k">答题时间</span><span class="v">' + e.minutes + '<small>分钟</small></span></div><div class="small muted">到时自动交卷</div></div>' +
      '<div class="card"><div class="stat"><span class="k">合格线</span><span class="v">' + e.pass + '<small>题</small></span></div><div class="small muted">每题 1 分</div></div>' +
      '<div class="card"><div class="stat"><span class="k">历史模考</span><span class="v">' + S.history.length + '<small>次</small></span></div>' +
      '<div class="small muted">最高 ' + (S.history.length ? Math.max.apply(null, S.history.map(function (x) { return x.score; })) : 0) + ' 分</div></div>' +
      '</div>'));

    var opt = h('<div class="card"><h2>组卷方式</h2>' +
      '<div class="setrow"><div class="lbl"><b>全真卷</b><span>' + e.single + ' 单选 + ' + e.multi + ' 多选，随机抽取，不打乱章节</span></div>' +
      '<button class="btn primary" id="full">开始考试</button></div>' +
      '<div class="setrow"><div class="lbl"><b>只考错题卷</b><span>从错题本中抽题（不足 ' + e.count + ' 题时按实际数量）</span></div>' +
      '<button class="btn" id="wrongpaper">开始考试</button></div>' +
      '<div class="setrow"><div class="lbl"><b>多选强化卷</b><span>30 道多选题专项（不计入模考成绩）</span></div>' +
      '<button class="btn" id="multipaper">开始考试</button></div>' +
      '<div class="setrow"><div class="lbl"><b>选项乱序</b><span>与正式机考一致，建议保持开启</span></div>' + toggle("shuffleOptions") + '</div>' +
      '</div>');
    root.appendChild(opt);
    bindToggles(opt);

    $("#full", opt).onclick = function () { startExam(buildPaper(), "全真模拟卷", e.minutes * 60, true); };
    $("#wrongpaper", opt).onclick = function () {
      if (!S.wrong.length) return toast("错题本是空的");
      startExam(buildPaper({ pool: S.wrong }), "错题模拟卷", e.minutes * 60, false);
    };
    $("#multipaper", opt).onclick = function () {
      startExam(sample(MULTI_IDS, Math.min(30, MULTI_IDS.length)), "多选强化卷", 30 * 60, false);
    };
  };

  function buildPaper(opts) {
    opts = opts || {};
    var e = examRule();
    if (opts.pool) {
      var ids = sample(opts.pool, Math.min(e.count, opts.pool.length));
      return { ids: shuffle(ids), single: ids.filter(function (i) { return byId[i].t === 0; }).length };
    }
    var s = sample(SINGLE_IDS, e.single);
    var m = sample(MULTI_IDS, e.multi);
    return { ids: shuffle(s.concat(m)), single: e.single, multi: e.multi };
  }

  function startExam(paper, title, seconds, official) {
    exam = {
      ids: paper.ids, title: title, answers: {}, pos: 0,
      total: seconds, left: seconds, startTs: Date.now(),
      official: !!official, submitted: false, perm: {}, flagged: {}
    };
    exam.ids.forEach(function (id) {
      var q = byId[id];
      var base = q.o.map(function (_, i) { return i; });
      exam.perm[id] = S.settings.shuffleOptions ? shuffle(base) : base;
    });
    renderExam($("#main"), false);
    startExamTimer();
  }

  function stopExamTimer() {
    if (examTimer) { clearInterval(examTimer); examTimer = null; }
  }
  function startExamTimer() {
    stopExamTimer();
    examTimer = setInterval(function () {
      if (!exam || exam.submitted) return stopExamTimer();
      exam.left--;
      var el = $("#timer");
      if (el) {
        el.textContent = mmss(exam.left);
        el.className = "timer" + (exam.left <= 300 ? " danger" : exam.left <= 600 ? " warn" : "");
      }
      if (exam.left <= 0) { stopExamTimer(); submitExam(true); }
    }, 1000);
  }

  function renderExam(root, showResult) {
    root.innerHTML = "";
    root.classList.add("wide");
    if (exam.submitted && showResult) return renderExamResult(root);

    var q = byId[exam.ids[exam.pos]];
    var st = exam.answers[q.i];
    var perm = exam.perm[q.i];

    root.appendChild(h('<div class="page-head"><div><h1>' + esc(exam.title) +
      (exam.official ? ' <span class="chip single">全真模式</span>' : ' <span class="chip">练习模式</span>') + '</h1>' +
      '<p>第 ' + (exam.pos + 1) + ' / ' + exam.ids.length + ' 题 · 已答 ' + Object.keys(exam.answers).length +
      ' 题 · <span class="mono">' + esc(q.c) + '</span></p></div>' +
      '<div class="row"><span class="timer" id="timer">' + mmss(exam.left) + '</span>' +
      '<button class="btn" id="quit">放弃</button>' +
      '<button class="btn primary" id="submit-now">交卷</button></div></div>'));

    var wrap = h('<div class="qwrap"></div>');
    root.appendChild(wrap);

    var card = h('<div class="qcard"></div>');
    card.appendChild(h('<div class="qhead">' +
      '<span class="idx">第 ' + (exam.pos + 1) + ' 题</span>' +
      (q.t === 0 ? '<span class="chip single">单选</span>' : '<span class="chip multi">多选</span>') +
      '<span class="spacer"></span>' +
      '<span class="small muted">' + esc(groups[q.g].name) + '</span>' +
      '<button class="btn ghost sm" id="flag">' + (exam.flagged[q.i] ? "⚑ 已标记" : "⚐ 标记待定") + '</button>' +
      '</div>'));

    var body = h('<div class="qbody"></div>');
    body.appendChild(h('<div class="stem">' + esc(q.q) + "</div>"));
    if (q.m) body.appendChild(h('<div class="qimg"><img src="' + esc(q.m) + '" alt="题图"></div>'));
    var opts = h('<div class="opts"></div>');
    body.appendChild(opts);
    var picked = st ? st.slice() : [];
    perm.forEach(function (oi, di) {
      var node = h('<button class="opt' + (picked.indexOf(di) >= 0 ? " sel" : "") + '">' +
        '<span class="key">' + String.fromCharCode(65 + di) + "</span>" +
        '<span style="flex:1">' + esc(q.o[oi]) + "</span></button>");
      node.onclick = function () {
        var arr = exam.answers[q.i] ? exam.answers[q.i].slice() : [];
        if (q.t === 0) { arr = [di]; }
        else { var k = arr.indexOf(di); if (k >= 0) arr.splice(k, 1); else arr.push(di); }
        exam.answers[q.i] = arr;
        if (q.t === 0 && exam.pos < exam.ids.length - 1) { exam.pos++; }
        renderExam(root, false);
        startExamTimer();
      };
      opts.appendChild(node);
    });
    card.appendChild(body);

    var foot = h('<div class="qfoot">' +
      '<button class="btn" id="prev">← 上一题</button>' +
      '<button class="btn" id="next">下一题 →</button>' +
      '<span class="spacer"></span>' +
      '<span class="kbdhint"><span class="kbd">1-4</span> 选项 <span class="kbd">←</span><span class="kbd">→</span> 翻页</span>' +
      '<button class="btn" id="clear">清除本题作答</button></div>');
    card.appendChild(foot);
    wrap.appendChild(card);

    $("#prev", foot).onclick = function () { if (exam.pos > 0) { exam.pos--; renderExam(root, false); } };
    $("#next", foot).onclick = function () { if (exam.pos < exam.ids.length - 1) { exam.pos++; renderExam(root, false); } };
    $("#clear", foot).onclick = function () { delete exam.answers[q.i]; renderExam(root, false); };
    $("#flag", card).onclick = function () { exam.flagged[q.i] = !exam.flagged[q.i]; renderExam(root, false); };
    $("#quit", root).onclick = function () {
      confirmBox("放弃本次考试？", "当前作答不会计入成绩。", function () {
        stopExamTimer(); exam = null; go("#/exam");
      });
    };
    $("#submit-now", root).onclick = function () { submitExam(false); };

    // 答题卡
    var side = h('<div class="sheet"><div class="sheet-card">' +
      '<h3><span>答题卡</span><span class="small muted">已答 <b>' + Object.keys(exam.answers).length + "</b> / " + exam.ids.length + '</span></h3>' +
      '<div class="sheet-grid" id="grid"></div>' +
      '<div class="legend"><span><i style="background:var(--accent-soft);border:1px solid var(--accent)"></i>已答</span>' +
      '<span><i style="background:var(--panel-2);border:1px solid var(--border)"></i>未答</span>' +
      '<span><i style="background:var(--warning, #fbbf24)"></i>标记</span></div>' +
      '<button class="btn primary" style="width:100%;margin-top:12px" id="submit2">交卷</button>' +
      '</div></div>');
    side.appendChild(h('<div class="sheet-card"><div class="small muted" style="line-height:1.9">' +
      '合格线：答对 <b>' + examRule().pass + '</b> 题<br>多选题必须与标准答案完全一致<br>剩余时间到 0 会自动交卷</div></div>'));
    wrap.appendChild(side);
    var g = $("#grid", side);
    exam.ids.forEach(function (id, k) {
      var cls = "cell" + (exam.answers[id] ? " done" : "") + (k === exam.pos ? " cur" : "");
      if (exam.flagged[id]) cls += " done";
      var node = h('<button class="' + cls + '"' + (exam.flagged[id] ? ' style="border-color:var(--warn);color:var(--warn)"' : "") + ">" + (k + 1) + "</button>");
      node.onclick = function () { exam.pos = k; renderExam(root, false); };
      g.appendChild(node);
    });
    $("#submit2", side).onclick = function () { submitExam(false); };
  }

  function submitExam(auto) {
    if (!exam || exam.submitted) return;
    var unanswered = exam.ids.length - Object.keys(exam.answers).length;
    var doIt = function () {
      stopExamTimer();
      var score = 0, detail = [];
      exam.ids.forEach(function (id) {
        var q = byId[id], perm = exam.perm[id];
        var pickedDisp = exam.answers[id] || [];
        var picked = pickedDisp.map(function (d) { return perm[d]; }).sort(function (a, b) { return a - b; });
        var ans = q.a.slice().sort(function (a, b) { return a - b; });
        var ok = picked.length === ans.length && picked.every(function (v, i) { return v === ans[i]; });
        if (ok) score++;
        detail.push({ id: id, ok: ok, picked: picked, perm: perm, blank: pickedDisp.length === 0 });
        if (!ok && pickedDisp.length) recordAnswer(id, false);
        else if (ok) recordAnswer(id, true);
      });
      var used = exam.total - exam.left;
      exam.submitted = true;
      var passLine = examRule().pass;
      exam.result = {
        score: score, total: exam.ids.length, pass: score >= passLine && exam.official,
        used: mmssLong(used), official: exam.official, detail: detail, auto: !!auto
      };
      if (exam.official) {
        S.history.push({
          t: new Date().toLocaleString("zh-CN", { hour12: false }).slice(0, 16),
          score: score, total: exam.ids.length, pass: score >= passLine, dur: mmssLong(used)
        });
        if (S.history.length > 60) S.history = S.history.slice(-60);
        save();
      }
      renderExamResult($("#main"));
    };
    if (auto) { doIt(); toast("时间到，已自动交卷"); return; }
    if (unanswered > 0) {
      confirmBox("确认交卷？", "还有 " + unanswered + " 题未作答，未作答按错处理。", doIt);
    } else doIt();
  }

  function renderExamResult(root) {
    var r = exam.result;
    root.innerHTML = "";
    root.appendChild(h('<div class="page-head"><div><h1>考试结果</h1><p>' + esc(exam.title) + " · " + esc(new Date().toLocaleString("zh-CN", { hour12: false }).slice(0, 16)) + "</p></div>" +
      '<div class="row"><button class="btn" id="again">再考一次</button><button class="btn" id="back">返回</button>' +
      '<button class="btn primary" id="drill">把错题加入错题本并重练</button></div></div>'));

    var unans = r.detail.filter(function (d) { return d.blank; }).length;
    var wrongN = r.detail.filter(function (d) { return !d.ok && !d.blank; }).length;
    root.appendChild(h('<div class="card"><div class="score-hero">' +
      '<div class="num ' + (r.pass ? "pass" : "fail") + '">' + r.score + '</div>' +
      '<div class="small muted" style="margin-top:8px">答对 ' + r.score + ' / ' + r.total + ' 题　用时 ' + esc(r.used) + '</div>' +
      (r.official
        ? '<div class="tag ' + (r.pass ? "pass" : "fail") + '">' + (r.pass ? "合格 · 达到 " + examRule().pass + " 题标准" : "未通过 · 差 " + (examRule().pass - r.score) + " 题") + "</div>"
        : '<div class="tag pass">练习模式（不计入模考记录）</div>') +
      (r.auto ? '<div class="small muted" style="margin-top:10px">时间为 0，已自动交卷</div>' : "") +
      '</div></div>'));

    root.appendChild(h('<div class="grid g4">' +
      '<div class="card"><div class="stat"><span class="k">正确</span><span class="v" style="color:var(--ok)">' + r.score + '</span></div></div>' +
      '<div class="card"><div class="stat"><span class="k">错误</span><span class="v" style="color:var(--bad)">' + wrongN + '</span></div></div>' +
      '<div class="card"><div class="stat"><span class="k">未作答</span><span class="v">' + unans + '</span></div></div>' +
      '<div class="card"><div class="stat"><span class="k">正确率</span><span class="v">' + pct(r.score, r.total) + '<small>%</small></span></div></div>' +
      '</div>'));

    var rev = h('<div class="card"><h2>逐题回顾</h2><div class="qlist" id="rev"></div></div>');
    root.appendChild(rev);
    var list = $("#rev", rev);
    r.detail.forEach(function (d, k) {
      var q = byId[d.id], perm = d.perm;
      var ansTxt = q.a.map(function (oi) { return perm.indexOf(oi); }).sort(function (a, b) { return a - b; })
        .map(function (x) { return String.fromCharCode(65 + x); }).join("");
      var youTxt = d.picked.map(function (oi) { return perm.indexOf(oi); }).sort(function (a, b) { return a - b; })
        .map(function (x) { return String.fromCharCode(65 + x); }).join("") || "未作答";
      var item = h('<div class="qitem"><div class="meta">' + (k + 1) + "<br>" + esc(q.c) + "</div>" +
        '<div class="body"><div class="txt">' + esc(q.q) + "</div>" +
        '<div class="ans ' + (d.ok ? "" : "") + '" style="' + (d.ok ? "" : "color:var(--bad)") + '">' +
        (d.ok ? "✓ 正确" : "✗ 错误") + "　正确答案 " + ansTxt + "（" + esc(q.a.map(function (oi) { return q.o[oi]; }).join(" / ").slice(0, 80)) + "…）　你的答案 " + youTxt +
        "</div>" +
        (q.e ? '<div class="explain sm">' + esc(q.e) + "</div>" : "") +
        "</div></div>");
      list.appendChild(item);
    });

    $("#again", root).onclick = function () { exam = null; route(); go("#/exam"); };
    $("#back", root).onclick = function () { go("#/home"); };
    $("#drill", root).onclick = function () {
      var ids = r.detail.filter(function (d) { return !d.ok; }).map(function (d) { return d.id; });
      ids.forEach(function (i) { if (S.wrong.indexOf(i) < 0) S.wrong.push(i); });
      save(); renderNavCounts();
      if (!ids.length) return toast("本次全对，无错题");
      exam = null;
      startPractice("wrong", "本次考试错题", ids);
    };
  }

  /* ====================================================== 视图：错题本 / 收藏 */
  VIEWS.wrong = function (root) { listView(root, "错题本", S.wrong, "还没有错题，去练几题吧"); };
  VIEWS.fav = function (root) { listView(root, "收藏", S.fav, "还没有收藏题目，答题时按 F 或点★收藏"); };

  function listView(root, title, ids, emptyText) {
    root.appendChild(h('<div class="page-head"><div><h1>' + title + '</h1><p>共 ' + ids.length + ' 题</p></div>' +
      '<div class="row"><button class="btn primary" id="drill">开始重练</button>' +
      (title === "错题本" ? '<button class="btn" id="clear">清空</button>' : "") +
      '<button class="btn" id="clearstats">重置全部学习数据</button></div></div>'));

    if (!ids.length) {
      root.appendChild(h('<div class="card"><div class="empty"><div class="big">☺</div>' + esc(emptyText) + "</div></div>"));
    } else {
      var card = h('<div class="card"><div class="qlist" id="list"></div></div>');
      root.appendChild(card);
      var list = $("#list", card);
      ids.slice().reverse().forEach(function (id) {
        var q = byId[id];
        var r = S.progress[id] || { r: 0, w: 0 };
        var item = h('<div class="qitem"><div class="meta">' + esc(q.c) + "<br>" + esc(q.s) + "</div>" +
          '<div class="body"><div class="txt">' + esc(q.q) + "</div>" +
          '<div class="small muted" style="margin-top:5px">正确答案：' + q.a.map(function (i) { return String.fromCharCode(65 + i); }).join("") +
          "　·　" + esc(q.a.map(function (i) { return q.o[i]; }).join(" / ").slice(0, 70)) + "…" +
          "　·　做对 " + r.r + " 次 / 做错 " + r.w + " 次</div>" +
          (q.e ? '<div class="explain sm">' + esc(q.e) + "</div>" : "") +
          "</div>" +
          '<div class="acts"><button class="btn sm" data-view="' + id + '">查看</button>' +
          '<button class="btn sm ghost" data-del="' + id + '">' + (title === "错题本" ? "移除" : "取消收藏") + "</button></div></div>");
        list.appendChild(item);
      });
      card.querySelectorAll("[data-view]").forEach(function (b) {
        b.onclick = function () { startPractice("single", "单题查看", [+b.getAttribute("data-view")]); };
      });
      card.querySelectorAll("[data-del]").forEach(function (b) {
        b.onclick = function () {
          var id = +b.getAttribute("data-del");
          var arr = title === "错题本" ? S.wrong : S.fav;
          var k = arr.indexOf(id);
          if (k >= 0) arr.splice(k, 1);
          save(); renderNavCounts(); route();
        };
      });
      $("#drill", root).onclick = function () {
        startPractice("wrong", title + "重练", shuffle(ids));
      };
      if ($("#clear", root)) $("#clear", root).onclick = function () {
        confirmBox("清空错题本？", "将移除全部 " + S.wrong.length + " 道错题记录，此操作不可撤销。", function () {
          S.wrong = []; save(); renderNavCounts(); route(); toast("错题本已清空");
        });
      };
    }
    $("#clearstats", root).onclick = function () {
      confirmBox("重置全部学习数据？", "当前类别（" + CLASS_LABEL[curClass] + "）的练习进度、错题本、收藏、模考记录都会清空，题库本身不受影响。", function () {
        localStorage.removeItem(STATE_PREFIX + curClass);
        S = loadState(curClass); S.settings = loadSettings();
        renderNavCounts(); applyTheme(); route(); toast("已重置");
      });
    };
  }

  /* ====================================================== 视图：题库检索 */
  var searchState = { kw: "", chap: "all", type: "all", only: "all", page: 50 };

  VIEWS.browse = function (root) {
    root.appendChild(h('<div class="page-head"><div><h1>题库检索</h1>' +
      '<p>共 ' + QS.length + ' 题。可按关键词、章节、题型筛选，适合集中背某一类知识点。</p></div></div>'));

    var bar = h('<div class="card"><div class="row">' +
      '<input class="input" id="kw" placeholder="搜索题干或选项…" style="flex:1;min-width:280px" value="' + esc(searchState.kw) + '">' +
      '<select class="input" id="chap"><option value="all">全部章节</option>' +
      META.chapters.map(function (c) { return '<option value="' + c.id + '">第 ' + c.id + " 章 " + esc(c.name) + "</option>"; }).join("") +
      '</select>' +
      '<select class="input" id="type"><option value="all">全部题型</option><option value="0">单选</option><option value="1">多选</option></select>' +
      '<select class="input" id="only"><option value="all">全部状态</option><option value="unseen">未做过</option>' +
      '<option value="wrong">做错过</option><option value="fav">已收藏</option></select>' +
      '<button class="btn primary" id="do">搜索</button>' +
      '</div></div>');
    root.appendChild(bar);
    $("#chap", bar).value = searchState.chap;
    $("#type", bar).value = searchState.type;
    $("#only", bar).value = searchState.only;

    var res = h('<div class="card"><div class="small muted" id="cnt" style="margin-bottom:10px"></div><div class="qlist" id="list"></div>' +
      '<div style="text-align:center;margin-top:14px"><button class="btn" id="more">加载更多</button></div></div>');
    root.appendChild(res);

    function run(reset) {
      if (reset) searchState.page = 50;
      searchState.kw = $("#kw", bar).value.trim();
      searchState.chap = $("#chap", bar).value;
      searchState.type = $("#type", bar).value;
      searchState.only = $("#only", bar).value;
      var kw = searchState.kw.toLowerCase();
      var hits = QS.filter(function (q) {
        if (searchState.chap !== "all" && q.g.split(".")[0] !== searchState.chap) return false;
        if (searchState.type !== "all" && String(q.t) !== searchState.type) return false;
        if (searchState.only === "unseen" && hasDone(q.i)) return false;
        if (searchState.only === "wrong") { var r0 = S.progress[q.i]; if (!r0 || !r0.w) return false; }
        if (searchState.only === "fav" && S.fav.indexOf(q.i) < 0) return false;
        if (kw) {
          var hay = (q.q + " " + q.o.join(" ") + " " + q.c + " " + q.s).toLowerCase();
          if (hay.indexOf(kw) < 0) return false;
        }
        return true;
      });
      $("#cnt", res).textContent = "命中 " + hits.length + " 题（显示前 " + Math.min(hits.length, searchState.page) + " 题）";
      var list = $("#list", res);
      list.innerHTML = "";
      hits.slice(0, searchState.page).forEach(function (q) {
        var item = h('<div class="qitem"><div class="meta">' + esc(q.c) + "<br>" + esc(q.s) + "<br>" +
          (q.t === 0 ? "单选" : "多选") + "</div>" +
          '<div class="body"><div class="txt">' + esc(q.q) + "</div>" +
          '<div class="small" style="margin-top:6px;color:var(--ok)">答案 ' + q.a.map(function (i) { return String.fromCharCode(65 + i); }).join("") +
          "　" + esc(q.a.map(function (i) { return q.o[i]; }).join(" ／ ").slice(0, 90)) + "</div>" +
          '<div class="small muted" style="margin-top:4px">选项：' + q.o.map(function (o, i) {
            return String.fromCharCode(65 + i) + ". " + esc(o.slice(0, 34));
          }).join("　") + "</div>" +
          "</div>" +
          '<div class="acts"><button class="btn sm" data-view="' + q.i + '">练习</button>' +
          '<button class="btn sm ghost" data-fav="' + q.i + '">' + (S.fav.indexOf(q.i) >= 0 ? "★" : "☆") + "</button></div></div>");
        list.appendChild(item);
      });
      $("#more", res).style.display = hits.length > searchState.page ? "" : "none";
      list.querySelectorAll("[data-view]").forEach(function (b) {
        b.onclick = function () { startPractice("single", "单题练习", [+b.getAttribute("data-view")]); };
      });
      list.querySelectorAll("[data-fav]").forEach(function (b) {
        b.onclick = function () { toggleFav(+b.getAttribute("data-fav")); run(false); };
      });
      res._hits = hits;
    }
    $("#do", bar).onclick = function () { run(true); };
    $("#kw", bar).onkeydown = function (e) { if (e.key === "Enter") run(true); };
    ["chap", "type", "only"].forEach(function (id) { $("#" + id, bar).onchange = function () { run(true); }; });
    $("#more", res).onclick = function () { searchState.page += 50; run(false); };
    run(true);
  };

  /* ====================================================== 视图：学习统计 */
  VIEWS.stats = function (root) {
    var answered = 0, right = 0, done = 0;
    QS.forEach(function (q) {
      var r = S.progress[q.i];
      if (!r) return;
      done++; answered += r.r + r.w; right += r.r;
    });
    root.appendChild(h('<div class="page-head"><div><h1>学习统计</h1><p>看清哪一章最薄，把时间花在正确率低的地方。</p></div></div>'));

    root.appendChild(h('<div class="grid g4" style="margin-bottom:16px">' +
      '<div class="card"><div class="stat"><span class="k">覆盖题目</span><span class="v">' + done + '<small>/' + QS.length + '</small></span></div><div class="bar" style="margin-top:8px"><i style="width:' + pct(done, QS.length) + '%"></i></div></div>' +
      '<div class="card"><div class="stat"><span class="k">总作答次数</span><span class="v">' + answered + '</span></div><div class="small muted">含重复练习</div></div>' +
      '<div class="card"><div class="stat"><span class="k">累计正确率</span><span class="v" style="color:' + (pct(right, answered) >= 88 ? "var(--ok)" : "var(--text)") + '">' + pct(right, answered) + '<small>%</small></span></div><div class="small muted">目标 88% 以上</div></div>' +
      '<div class="card"><div class="stat"><span class="k">错题本</span><span class="v" style="color:var(--bad)">' + S.wrong.length + '</span></div><div class="small muted">答对后自动移出</div></div>' +
      '</div>'));

    // 最近 21 天练习量
    var days = [];
    for (var i = 20; i >= 0; i--) {
      var d = new Date(); d.setDate(d.getDate() - i);
      var key = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      days.push({ k: key, n: (S.daily[key] || {}).n || 0, c: (S.daily[key] || {}).c || 0 });
    }
    var maxN = Math.max(30, Math.max.apply(null, days.map(function (x) { return x.n; })));
    var bars = days.map(function (x, k) {
      var hgt = Math.round((x.n / maxN) * 110);
      var w = 680 / days.length;
      return '<rect x="' + (k * w + 4) + '" y="' + (118 - hgt) + '" width="' + (w - 8) + '" height="' + hgt +
        '" rx="3" fill="var(--accent)" opacity="' + (x.n ? .85 : .18) + '"><title>' + x.k + "：" + x.n + " 题，正确 " + x.c + "</title></rect>" +
        (k % 3 === 0 ? '<text x="' + (k * w + w / 2) + '" y="132" font-size="9.5" fill="var(--text-3)" text-anchor="middle">' + x.k.slice(5) + "</text>" : "");
    }).join("");
    root.appendChild(h('<div class="card"><h2>最近 21 天练习量</h2>' +
      '<svg viewBox="0 0 680 140" style="width:100%;height:150px">' +
      '<line x1="0" y1="118" x2="680" y2="118" stroke="var(--border)"></line>' + bars + "</svg></div>"));

    // 章节 / 小节正确率
    var card = h('<div class="card"><h2>各章节正确率</h2><div id="bars"></div></div>');
    root.appendChild(card);
    var box = $("#bars", card);
    META.chapters.forEach(function (c) {
      var ids = [];
      c.groups.forEach(function (g) { ids = ids.concat(groups[g.g].ids); });
      var st = agg(ids);
      box.appendChild(barLine("第 " + c.id + " 章 " + c.name, st.acc, st.cover, ids.length + " 题"));
      c.groups.forEach(function (g) {
        var gst = agg(groups[g.g].ids);
        box.appendChild(h('<div class="barline" style="padding-left:22px;grid-template-columns:200px 1fr 108px">' +
          '<div class="name small">' + esc(g.name) + '<em>' + g.n + "</em></div>" +
          '<div><div class="bar ' + (gst.acc >= 90 ? "ok" : gst.acc && gst.acc < 60 ? "bad" : "") + '"><i style="width:' + gst.acc + '%"></i></div></div>' +
          '<div class="tail small">' + gst.ans + " 次作答 · " + gst.acc + "%</div></div>"));
      });
    });

    // 最难的题
    var hard = QS.filter(function (q) { var r = S.progress[q.i]; return r && r.w > 0; })
      .sort(function (a, b) { return (S.progress[b.i].w - S.progress[b.i].r) - (S.progress[a.i].w - S.progress[a.i].r) || S.progress[b.i].w - S.progress[a.i].w; })
      .slice(0, 15);
    var hc = h('<div class="card"><h2>最需要攻克的题（按错误次数排序）</h2>' +
      (hard.length ? '<div class="qlist" id="hard"></div>' : '<div class="empty">还没有错题数据</div>') + "</div>");
    root.appendChild(hc);
    if (hard.length) {
      var hl = $("#hard", hc);
      hard.forEach(function (q) {
        var r = S.progress[q.i];
        var item = h('<div class="qitem"><div class="meta">' + esc(q.c) + "<br>" + esc(q.s) + "</div>" +
          '<div class="body"><div class="txt">' + esc(q.q.slice(0, 120)) + "</div>" +
          '<div class="small muted" style="margin-top:4px">错 ' + r.w + " 次 / 对 " + r.r + " 次</div></div>" +
          '<div class="acts"><button class="btn sm" data-view="' + q.i + '">练习</button></div></div>');
        hl.appendChild(item);
      });
      hl.querySelectorAll("[data-view]").forEach(function (b) {
        b.onclick = function () { startPractice("single", "重点题突破", [ +b.getAttribute("data-view") ]); };
      });
    }
  };

  /* ====================================================== 视图：备考规划 */
  var PLAN = [
    {
      id: "p0", when: "现在 · 报名与资格核对", title: "先确认你能不能报、什么时候报",
      items: [
        "已持有 A 类《业余无线电台操作证书》，且业余无线电台执照已满 6 个月（B 类报名硬性条件）",
        "报名材料：白底证件照（jpg，头像占 2/3）、身份证正反面、电台执照照片、近期通联日志",
        "报名入口：crac.org.cn「能力验证 → 考生入口」，或手机装「智谱」App →「特别入口 → 考试报名」",
        "考试通知发布渠道：所在地省/市工业和信息化局网站（一般在考前 3～4 周发通知），先关注起来",
        "考试免费；每名考生只有一次机会，弃考或不合格要等下一批重新报名"
      ],
      note: "考场纪律：开考后 15～20 分钟未入场即取消资格；手机、纸质资料一律不能带。"
    },
    {
      id: "p1", from: "2026-09-16", to: "2026-09-27", when: "第 1～2 周（约 9/16 – 9/27）", title: "阶段一 · 摸底 + 法规章拿下来",
      items: [
        "第一天先做一次全真模拟（60 题 / 60 分钟），把分数记在仪表盘上，作为基准线",
        "顺序练习刷完第 1 章「法规与频率管理」219 题 —— 这章最容易靠记忆拿满",
        "每天 60～80 题；错题自动进错题本，睡前把当天错题过一遍",
        "把《业余无线电台管理办法》的几个关键点背下来：执照有效期、呼号使用规则、B 类权限、处罚条款",
        "本阶段末：再做一次模拟，目标 ≥ 35 分"
      ]
    },
    {
      id: "p2", from: "2026-09-28", to: "2026-10-18", when: "第 3～5 周（9/28 – 10/18）", title: "阶段二 · 全题库过完一遍",
      items: [
        "按章节推进：第 2 章 国际规则与通联操作（333 题）→ 第 3 章 设备、天线与电波传播（318 题）",
        "→ 第 4 章 电工电子基础（242 题）→ 第 5 章 安全与电磁兼容（31 题）",
        "每天 100～120 题；每完成一章，用「章节专项」把该章正确率刷到 80% 以上再进下一章",
        "多选题单独练：用「多选专项」把 196 道多选题全过一遍（多选必须完全一致，最容易丢分）",
        "每周日一次限时全真模拟，目标 ≥ 42 分"
      ],
      note: "第 4 章的电工电子是 B 类新增的硬骨头，公式（欧姆定律、功率、dB、波长 λ=300/f）要动手算，别只背答案。"
    },
    {
      id: "p3", from: "2026-10-19", to: "2026-10-31", when: "第 6～7 周（10/19 – 10/31）", title: "阶段三 · 薄弱点收口",
      items: [
        "只练错题本 + 未做过的题；错 2 次以上的题反复刷到不再错",
        "集中整理背诵清单：频段划分表（HF/VHF/UHF 各波段频率范围）、四十多个常用 Q 简语、字母解释法",
        "集中整理：呼号前缀/分区、发射类别代号（A1A、J3E、F3E…）、天线与馈线的关键结论",
        "每周 2 次全真模拟，限时 60 分钟不暂停、不查资料，目标稳定 ≥ 48 分"
      ]
    },
    {
      id: "p4", from: "2026-11-01", to: "2099-12-31", when: "第 8 周起（11/1 – 考前）", title: "阶段四 · 冲刺与临场",
      items: [
        "每天 1 套全真模拟，模拟完立刻过错题，控制在 70 分钟内完成一轮",
        "把「最需要攻克的题」列表刷到全部答对",
        "考前 48 小时下载打印准考证，核对考试时间地点（考试时间可能调整）",
        "考前一天只看错题本和背诵清单，不刷新题，早点睡"
      ],
      note: "考场上：单选别纠结，一题一分钟；多选不确定就按最保守的选，多选少选都不得分，宁可少选也别乱加。"
    }
  ];

  VIEWS.plan = function (root) {
    var dd = S.settings.examDate ? daysBetween(today(), S.settings.examDate) : null;
    root.appendChild(h('<div class="page-head"><div><h1>备考规划</h1>' +
      '<p>从今天到考试日的分阶段安排' + (dd !== null && dd >= 0 ? '（剩 ' + dd + " 天）" : "") + '。勾选进度会保存在本地。</p></div></div>'));

    root.appendChild(h('<div class="card"><div class="callout"><b>考试规则速记（2025 年版题库）</b><br>' +
      esc(META.klass) + '卷共 <b>' + examRule().count + ' 题</b>：单选 ' + examRule().single + ' 题 + 多选 ' + examRule().multi + ' 题；答题时间 <b>' + examRule().minutes + ' 分钟</b>；<b>答对 ' + examRule().pass + ' 题</b>为合格。<br>' +
      '多选题必须与标准答案<b>完全一致</b>，多选、少选都不得分。<br>' +
      '答案选项在组卷时会被<b>打乱</b>，所以别靠位置记忆，要理解内容。</div></div>'));

    var tl = h('<div class="card"><h2>分阶段计划</h2><div class="tl"></div></div>');
    root.appendChild(tl);
    var box = $(".tl", tl);
    PLAN.forEach(function (p, pi) {
      var t = today();
      var cls = "";
      if (p.from && p.to) {
        if (t > p.to) cls = " done";
        else if (t >= p.from) cls = " now";
      }
      var item = h('<div class="tl-item' + cls + '"></div>');
      item.appendChild(h("<h3>" + esc(p.title) +
        (cls === " now" ? ' <span class="chip single">当前阶段</span>' : cls === " done" ? ' <span class="chip ok">已完成</span>' : "") +
        '</h3><div class="when">' + esc(p.when) + "</div>"));
      var ul = h("<ul></ul>");
      p.items.forEach(function (t, ti) {
        var key = p.id + ":" + ti;
        var done = !!S.plan[key];
        var li = h('<li><label class="check' + (done ? " done" : "") + '"><input type="checkbox" ' +
          (done ? "checked" : "") + "><span>" + esc(t) + "</span></label></li>");
        li.querySelector("input").onchange = function (e) {
          S.plan[key] = e.target.checked; save();
          li.querySelector("label").classList.toggle("done", e.target.checked);
          updatePlanProgress();
        };
        ul.appendChild(li);
      });
      item.appendChild(ul);
      if (p.note) item.appendChild(h('<div class="callout warn small" style="margin-top:10px">' + esc(p.note) + "</div>"));
      box.appendChild(item);
    });

    var pc = h('<div class="card"><h2>计划完成度</h2><div id="pp"></div></div>');
    root.appendChild(pc);
    function updatePlanProgress() {
      var total = 0, done = 0;
      PLAN.forEach(function (p) { p.items.forEach(function (t, i) { total++; if (S.plan[p.id + ":" + i]) done++; }); });
      $("#pp", pc).innerHTML = '<div class="bar"><i style="width:' + pct(done, total) + '%"></i></div>' +
        '<div class="small muted" style="margin-top:8px">已完成 ' + done + " / " + total + " 项（" + pct(done, total) + "%）</div>";
    }
    updatePlanProgress();

    root.appendChild(h('<div class="card"><h2>每日固定动作</h2><ol class="small" style="line-height:2;color:var(--text-2);margin:0;padding-left:20px">' +
      "<li>早上：错题本重练 20 题（唤醒记忆）</li>" +
      "<li>白天：新题 60～100 题（按当前阶段章节推进）</li>" +
      "<li>晚上：多选专项 20 题 + 今天错题再看一遍</li>" +
      "<li>周末：1～2 套限时全真模拟，记录分数看趋势</li></ol></div>"));
  };

  /* ====================================================== 视图：设置 */
  VIEWS.settings = function (root) {
    root.appendChild(h('<div class="page-head"><div><h1>设置</h1><p>答题偏好、考试计划与账号管理。</p></div></div>'));

    // 账号卡片（登录后显示）
    if (AUTH.user) {
      var acct = h('<div class="card"><h2>账号</h2>' +
        '<div class="setrow"><div class="lbl"><b>当前账号</b><span>登录用户</span></div>' +
        '<div>' + esc(AUTH.user.username) + (AUTH.user.is_admin ? ' <span class="chip single">管理员</span>' : "") + '</div></div>' +
        '<div class="setrow"><div class="lbl"><b>考试类别</b><span>切换后题库与进度按类别隔离</span></div>' +
        '<div class="row" id="klass-row"></div></div>' +
        '<div class="setrow"><div class="lbl"><b>修改密码</b><span id="pwd-hint">' +
        (AUTH.user.is_admin ? "管理员需密码登录，请设置或更新密码" : "普通用户无需密码，留空保持免密登录") +
        '</span></div>' +
        '<div class="row" style="gap:8px"><input class="input" type="password" id="pwd-new" placeholder="新密码" style="width:180px">' +
        '<button class="btn" id="pwd-save">保存</button></div></div>' +
        "</div>");
      root.appendChild(acct);
      $("#pwd-save", acct).onclick = function () {
        var v = $("#pwd-new", acct).value;
        if (AUTH.user.is_admin && v.length < 6) { toast("密码至少 6 位"); return; }
        api("/api/user/password", { method: "POST", body: { password: v } }).then(function (r) {
          if (r.data && r.data.ok) { toast("密码已更新"); $("#pwd-new", acct).value = ""; }
          else toast((r.data && r.data.error) || "修改失败");
        });
      };
      var kr = $("#klass-row", acct);
      CLASS_ORDER.forEach(function (k) {
        var b = h('<button class="btn' + (k === curClass ? " primary" : "") + '" data-k="' + k + '">' + CLASS_LABEL[k] + "</button>");
        b.onclick = function () {
          if (k === curClass) return;
          confirmBox("切换到 " + CLASS_LABEL[k] + "？", "切换后题库和练习进度会切换到该类别，原类别进度仍保留。", function () {
            api("/api/user/klass", { method: "POST", body: { klass: k } }).then(function (r) {
              if (r.data.ok) {
                AUTH.user.klass = k;
                // 先 flush 当前类别，再切换
                flush();
                S.settings.curClass = k;
                saveSettings();
                curClass = k;
                S = loadState(k); S.settings = loadSettings();
                buildClassData(k);
                pullFromServer().then(function () {
                  buildClassData(k);
                  renderClassSwitcher();
                  renderNavCounts();
                  toast("已切换到 " + CLASS_LABEL[k]);
                  route();
                });
              } else {
                toast(r.data.error || "切换失败");
              }
            });
          });
        };
        kr.appendChild(b);
      });
    }

    var card = h('<div class="card"><h2>答题</h2>' +
      '<div class="setrow"><div class="lbl"><b>选项乱序</b><span>正式机考会打乱选项，强烈建议开启</span></div>' + toggle("shuffleOptions") + "</div>" +
      '<div class="setrow"><div class="lbl"><b>答对自动跳下一题</b><span>答错时仍会停留显示答案</span></div>' + toggle("autoNext") + "</div>" +
      '<div class="setrow"><div class="lbl"><b>答对后从错题本移除</b><span>关闭则错题一直保留，方便反复看</span></div>' + toggle("removeWrongOnCorrect") + "</div>" +
      "</div>");
    root.appendChild(card);
    bindToggles(card);

    var c2 = h('<div class="card"><h2>计划</h2>' +
      '<div class="setrow"><div class="lbl"><b>考试日期</b><span>用于仪表盘倒计时，等通知下来再改也可以</span></div>' +
      '<input class="input" type="date" id="exdate" value="' + esc(S.settings.examDate) + '"></div>' +
      '<div class="setrow"><div class="lbl"><b>每日目标题量</b><span>仪表盘按这个数算今天的完成度</span></div>' +
      '<input class="input" type="number" id="goal" min="10" max="600" step="10" value="' + S.settings.dailyGoal + '" style="width:110px"></div>' +
      "</div>");
    root.appendChild(c2);
    $("#exdate", c2).onchange = function () { S.settings.examDate = this.value; save(); toast("考试日期已更新"); };
    $("#goal", c2).onchange = function () { S.settings.dailyGoal = Math.max(10, +this.value || 120); save(); toast("目标已更新"); };

    var c3 = h('<div class="card"><h2>数据</h2>' +
      '<div class="setrow"><div class="lbl"><b>导出学习记录</b><span>JSON 文件，可备份到别处或换浏览器后导入</span></div>' +
      '<div class="row"><button class="btn" id="exp">导出</button><button class="btn" id="imp">导入</button></div></div>' +
      '<div class="setrow"><div class="lbl"><b>清空全部学习数据</b><span>进度、错题本、收藏、模考记录全部重置</span></div>' +
      '<button class="btn" id="reset">重置</button></div>' +
      "</div>");
    root.appendChild(c3);
    $("#exp", c3).onclick = function () {
      var blob = new Blob([JSON.stringify(S, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "ham-" + curClass + "-progress-" + today() + ".json";
      a.click();
    };
    $("#imp", c3).onclick = function () {
      var inp = document.createElement("input");
      inp.type = "file";
      inp.accept = ".json";
      inp.onchange = function () {
        var f = inp.files[0]; if (!f) return;
        var fr = new FileReader();
        fr.onload = function () {
          try {
            var obj = JSON.parse(fr.result);
            localStorage.setItem(STATE_PREFIX + curClass, JSON.stringify(obj));
            S = loadState(curClass); S.settings = loadSettings();
            renderNavCounts(); route(); toast("导入成功");
          } catch (e) { toast("文件格式不对"); }
        };
        fr.readAsText(f);
      };
      inp.click();
    };
    $("#reset", c3).onclick = function () {
      confirmBox("清空当前类别学习数据？", "此操作不可撤销。", function () {
        localStorage.removeItem(STATE_PREFIX + curClass);
        S = loadState(curClass); S.settings = loadSettings();
        renderNavCounts(); route(); toast("已清空");
      });
    };

    var c4 = h('<div class="card"><h2>关于题库</h2>' +
      '<table class="tbl"><tbody>' +
      "<tr><td>题库版本</td><td>" + esc(META.version) + "</td></tr>" +
      "<tr><td>类别</td><td>" + esc(META.klass) + "</td></tr>" +
      "<tr><td>题目总数</td><td>" + META.total + " 题（单选 " + META.single + " / 多选 " + META.multi + "）</td></tr>" +
      "<tr><td>配图题</td><td>" + META.imaged + " 题</td></tr>" +
      "<tr><td>数据来源</td><td>" + esc(META.source) + "</td></tr>" +
      "<tr><td>公布时间</td><td>2025 年 7 月 28 日（2025 年版，现行为最新版）</td></tr>" +
      "</tbody></table>" +
      '<div class="callout small" style="margin-top:14px">题库以中国无线电协会业余无线电分会（CRAC）官网公布的版本为准。' +
      '若官方发布新版题库，重新跑一次 build_site.py 即可更新本站数据。</div>' +
      "</div>");
    root.appendChild(c4);
  };

  /* ====================================================== 账号视图：登录 / 注册 / 管理员 */
  function renderAuthUI() {
    var box = $("#auth-box");
    if (!box) return;
    box.innerHTML = "";
    if (AUTH.user) {
      var u = AUTH.user;
      box.appendChild(h(
        '<div class="auth-user"><span class="dot"></span><b>' + esc(u.username) + "</b>" +
        (u.is_admin ? '<span class="admin-tag">管理员</span>' : "") + "</div>"
      ));
      var links = h('<div class="auth-links"></div>');
      if (u.is_admin) {
        var a1 = h('<a href="#/admin">▣ 管理面板</a>');
        links.appendChild(a1);
      }
      var a2 = h('<a href="javascript:;" id="logout-link">⎋ 退出登录</a>');
      a2.onclick = function () {
        api("/api/logout", { method: "POST" }).then(function () { setLoggedOut(); });
      };
      links.appendChild(a2);
      box.appendChild(links);
    } else {
      box.appendChild(h(
        '<div class="auth-links">' +
        '<a href="#/login">登录</a>' +
        '<a href="#/register">注册</a>' +
        "</div>"
      ));
    }
  }

  VIEWS.login = function (root) {
    var wrap = h('<div class="auth-wrap"><div class="auth-brand">' +
      '<div class="brand-mark">HAM</div>' +
      '<h1>业余无线电练题站</h1>' +
      '<p>输入用户名即可登录</p>' +
      '</div></div>');
    // 普通用户免密；管理员需账号+密码
    var card = h('<div class="card auth-form">' +
      '<div class="field"><label>用户名</label><input id="lg-user" autocomplete="username"></div>' +
      '<div class="field" id="lg-pass-field" style="display:none"><label>密码</label><input id="lg-pass" type="password" autocomplete="current-password"></div>' +
      '<div class="err" id="lg-err"></div>' +
      '<button class="btn primary" id="lg-go" style="width:100%">登录</button>' +
      '<div class="hint" id="lg-mode-hint">管理员请点下方「管理员登录」</div>' +
      '<div class="hint" style="margin-top:6px"><a href="javascript:;" id="lg-toggle">管理员登录</a> · 还没有账号？<a href="#/register">去注册</a></div>' +
      '</div>');
    wrap.appendChild(card);
    root.appendChild(wrap);

    var isAdminMode = false;
    var passField = $("#lg-pass-field", card);
    var toggle = $("#lg-toggle", card);
    var modeHint = $("#lg-mode-hint", card);
    function setMode(admin) {
      isAdminMode = admin;
      passField.style.display = admin ? "" : "none";
      toggle.textContent = admin ? "返回用户登录" : "管理员登录";
      modeHint.textContent = admin ? "" : "管理员请点下方「管理员登录」";
    }
    toggle.onclick = function () { setMode(!isAdminMode); };

    function doLogin() {
      var username = $("#lg-user", card).value.trim();
      var password = $("#lg-pass", card).value;
      var err = $("#lg-err", card);
      err.textContent = "";
      if (!username) { err.textContent = "请输入用户名"; return; }
      if (isAdminMode && !password) { err.textContent = "请输入密码"; return; }
      api("/api/login", { method: "POST", body: { username: username, password: password } }).then(function (r) {
        if (r.status === 200 && r.data.ok) {
          AUTH.user = r.data.user;
          // 锁定到用户所选类别
          var uk = AUTH.user.klass || "b";
          S.settings.curClass = uk;
          saveSettings();
          curClass = uk;
          buildClassData(uk);
          pullFromServer().then(function () {
            renderAuthUI();
            renderNavCounts();
            renderClassSwitcher();
            toast("登录成功，欢迎 " + username);
            go("#/home");
          });
        } else {
          err.textContent = (r.data && r.data.error) || "登录失败";
        }
      });
    }
    $("#lg-go", card).onclick = doLogin;
    $("#lg-user", card).onkeydown = function (e) { if (e.key === "Enter") doLogin(); };
    $("#lg-pass", card).onkeydown = function (e) { if (e.key === "Enter") doLogin(); };
  };

  VIEWS.register = function (root) {
    var wrap = h('<div class="auth-wrap"><div class="auth-brand">' +
      '<div class="brand-mark">HAM</div>' +
      '<h1>注册账号</h1>' +
      '<p>填用户名、选类别，无需密码</p>' +
      '</div></div>');
    var card = h('<div class="card auth-form"><div class="field"><label>用户名</label><input id="rg-user" autocomplete="username"></div>' +
      '<div class="field"><label>激活码（可选）</label><input id="rg-code" autocomplete="off" placeholder="有激活码可直接通过，留空需管理员审核"></div>' +
      '<div class="field"><label>你要考哪一类</label>' +
      '<div class="row" style="gap:8px">' +
      '<button class="btn klass-pick" data-k="a">A 类</button>' +
      '<button class="btn klass-pick" data-k="b">B 类</button>' +
      '<button class="btn klass-pick" data-k="c">C 类</button>' +
      '</div><div class="hint" id="klass-hint" style="margin-top:6px"></div></div>' +
      '<div class="err" id="rg-err"></div>' +
      '<button class="btn primary" id="rg-go" style="width:100%">注册</button>' +
      '<div class="hint">已有账号？<a href="#/login">去登录</a></div></div>');
    wrap.appendChild(card);
    root.appendChild(wrap);

    var pickedKlass = "b";
    var klassDesc = { a: "A 类：30 题 / 30 分钟 / 25 分合格", b: "B 类：60 题 / 60 分钟 / 45 分合格", c: "C 类：80 题 / 90 分钟 / 60 分合格" };
    function refreshKlass() {
      card.querySelectorAll(".klass-pick").forEach(function (b) {
        b.classList.toggle("primary", b.getAttribute("data-k") === pickedKlass);
      });
      $("#klass-hint", card).textContent = klassDesc[pickedKlass];
    }
    card.querySelectorAll(".klass-pick").forEach(function (b) {
      b.onclick = function () { pickedKlass = b.getAttribute("data-k"); refreshKlass(); };
    });
    refreshKlass();

    function doRegister() {
      var username = $("#rg-user", card).value.trim();
      var code = $("#rg-code", card).value.trim();
      var err = $("#rg-err", card);
      err.textContent = "";
      if (!username) { err.textContent = "请输入用户名"; return; }
      api("/api/register", { method: "POST", body: { username: username, klass: pickedKlass, code: code } }).then(function (r) {
        if (r.status === 200 && r.data.ok) {
          err.textContent = "";
          if (r.data.status === "approved") {
            confirmBox("注册成功", "你的账号已创建，可直接登录开始练题。", function () { go("#/login"); });
          } else {
            confirmBox("注册成功", "你的账号已提交，等待管理员审核通过后即可登录。", function () { go("#/login"); });
          }
        } else {
          err.textContent = (r.data && r.data.error) || "注册失败";
        }
      });
    }
    $("#rg-go", card).onclick = doRegister;
    $("#rg-user", card).onkeydown = function (e) { if (e.key === "Enter") doRegister(); };
    $("#rg-code", card).onkeydown = function (e) { if (e.key === "Enter") doRegister(); };
  };

  VIEWS.admin = function (root) {
    if (!AUTH.user || !AUTH.user.is_admin) {
      root.appendChild(h('<div class="page-head"><div><h1>管理面板</h1></div></div>'));
      root.appendChild(h('<div class="card"><div class="empty">无权限访问</div></div>'));
      return;
    }
    root.appendChild(h('<div class="page-head"><div><h1>管理面板</h1>' +
      '<p>审核用户、管理激活码、清空数据。本面板仅管理员可见。</p></div></div>'));

    // ----- 激活码管理 -----
    var codeCard = h('<div class="card"><h2>激活码管理</h2>' +
      '<p class="small muted">填激活码注册的用户直接通过（免审核）；留空注册需管理员审核。激活码可设「次激活」（限定次数）或「永久」（不限次），并可选有效期。</p>' +
      '<div class="row" style="margin-bottom:6px;flex-wrap:wrap">' +
      '<input id="new-code" placeholder="输入新激活码" autocomplete="off" style="flex:1;min-width:160px">' +
      '<select id="code-type" style="min-width:110px"><option value="permanent">永久激活（不限次）</option><option value="limited">次激活（限次数）</option></select>' +
      '<input id="code-uses" type="number" min="1" placeholder="次数" style="width:80px;display:none">' +
      '<button class="btn primary" id="add-code">添加</button></div>' +
      '<div class="row" style="margin-bottom:10px;flex-wrap:wrap;align-items:center">' +
      '<label class="small muted" style="margin:0">有效期（可选）：</label>' +
      '<input id="code-expire" type="number" min="1" placeholder="留空 = 永久有效" style="min-width:160px">' +
      '<span class="small muted">天</span>' +
      '</div>' +
      '<div id="code-list"></div></div>');
    root.appendChild(codeCard);

    // 类型切换：次激活时显示次数输入框
    $("#code-type", codeCard).onchange = function () {
      var limited = $("#code-type", codeCard).value === "limited";
      $("#code-uses", codeCard).style.display = limited ? "" : "none";
    };

    function loadCodes() {
      api("/api/admin/codes").then(function (r) {
        var list = $("#code-list", codeCard);
        if (!r.data.ok) { list.innerHTML = '<div class="empty">加载失败</div>'; return; }
        var codes = r.data.codes;
        if (!codes.length) { list.innerHTML = '<div class="empty">暂无激活码，请先添加</div>'; return; }
        var now = Math.floor(Date.now() / 1000);
        var html = '<table class="tbl"><thead><tr><th>激活码</th><th>类型</th><th>用量</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>';
        codes.forEach(function (c) {
          // 类型
          var typeTxt = c.max_uses > 0 ? '次激活（' + c.used_count + '/' + c.max_uses + '）' : '永久激活（已用 ' + c.used_count + ' 次）';
          // 状态
          var expired = c.expire_days && (c.created_at + c.expire_days * 86400) <= now;
          var exhausted = c.max_uses > 0 && c.used_count >= c.max_uses;
          var st;
          if (!c.enabled) st = '<span class="chip" style="color:var(--warn)">已停用</span>';
          else if (expired) st = '<span class="chip" style="color:var(--warn)">已过期</span>';
          else if (exhausted) st = '<span class="chip" style="color:var(--warn)">次数已用完</span>';
          else st = '<span class="chip ok">可用</span>';
          var t = c.created_at ? new Date(c.created_at * 1000).toLocaleString("zh-CN", { hour12: false }).slice(0, 16) : "—";
          var exp = c.expire_days ? '有效期 ' + c.expire_days + ' 天' : '永久有效';
          html += '<tr><td><b>' + esc(c.code) + '</b><div class="small muted">' + exp + '</div></td><td>' + typeTxt + '</td><td>' + c.used_count + '</td><td>' + st + '</td><td class="small">' + t + '</td><td>' +
            '<button class="btn sm" data-toggle="' + c.id + '">' + (c.enabled ? "停用" : "启用") + '</button> ' +
            '<button class="btn sm" data-delcode="' + c.id + '">删除</button>' +
            '</td></tr>';
        });
        html += '</tbody></table>';
        list.innerHTML = html;
        list.querySelectorAll("[data-toggle]").forEach(function (b) {
          b.onclick = function () {
            api("/api/admin/codes/" + b.getAttribute("data-toggle") + "/toggle", { method: "POST" }).then(function (r) {
              if (r.data.ok) { toast("已更新"); loadCodes(); } else toast(r.data.error || "失败");
            });
          };
        });
        list.querySelectorAll("[data-delcode]").forEach(function (b) {
          b.onclick = function () {
            var id = b.getAttribute("data-delcode");
            confirmBox("删除激活码？", "删除后该激活码将无法再用于注册，已注册用户不受影响。", function () {
              api("/api/admin/codes/" + id + "/delete", { method: "POST" }).then(function (r) {
                if (r.data.ok) { toast("已删除"); loadCodes(); } else toast(r.data.error || "失败");
              });
            });
          };
        });
      });
    }
    $("#add-code", codeCard).onclick = function () {
      var inp = $("#new-code", codeCard);
      var code = inp.value.trim();
      if (!code) { toast("请输入激活码"); return; }
      var limited = $("#code-type", codeCard).value === "limited";
      var maxUses = 0;
      if (limited) {
        maxUses = parseInt($("#code-uses", codeCard).value, 10);
        if (!maxUses || maxUses < 1) { toast("请输入有效的使用次数"); return; }
      }
      var expireStr = $("#code-expire", codeCard).value.trim();
      var expireDays = expireStr ? parseInt(expireStr, 10) : null;
      if (expireDays !== null && (!expireDays || expireDays < 1)) { toast("有效期天数需为正整数"); return; }
      var body = { code: code, max_uses: maxUses };
      if (expireDays) body.expire_days = expireDays;
      api("/api/admin/codes", { method: "POST", body: body }).then(function (r) {
        if (r.data.ok) { inp.value = ""; $("#code-uses", codeCard).value = ""; $("#code-expire", codeCard).value = ""; toast("已添加"); loadCodes(); }
        else toast(r.data.error || "添加失败");
      });
    };
    loadCodes();

    var stat = h('<div class="card"><h2>数据管理</h2><div class="row"></div></div>');
    root.appendChild(stat);
    var sr = $(".row", stat);
    var bClear = h('<button class="btn" id="clear-users">清空所有非管理员用户</button>');
    var bReset = h('<button class="btn" id="reset-progress">重置所有用户进度</button>');
    sr.appendChild(bClear);
    sr.appendChild(bReset);
    bClear.onclick = function () {
      confirmBox("清空所有非管理员用户？", "将删除所有普通用户账号及其学习进度，管理员账号保留。此操作不可撤销。", function () {
        api("/api/admin/clear-users", { method: "POST" }).then(function (r) {
          if (r.data.ok) { toast("已清空 " + r.data.deleted + " 个用户"); loadUsers(); }
          else toast(r.data.error || "操作失败");
        });
      });
    };
    bReset.onclick = function () {
      confirmBox("重置所有用户进度？", "将清空所有用户（含管理员）的学习进度，账号保留。", function () {
        api("/api/admin/reset-progress", { method: "POST" }).then(function (r) {
          if (r.data.ok) { toast("已重置 " + r.data.reset + " 条进度"); loadUsers(); }
          else toast(r.data.error || "操作失败");
        });
      });
    };

    var card = h('<div class="card"><h2>用户列表</h2><div id="user-list"></div></div>');
    root.appendChild(card);

    function loadUsers() {
      api("/api/admin/users").then(function (r) {
        var list = $("#user-list", card);
        if (!r.data.ok) { list.innerHTML = '<div class="empty">加载失败</div>'; return; }
        var users = r.data.users;
        if (!users.length) { list.innerHTML = '<div class="empty">暂无用户</div>'; return; }
        var html = '<table class="tbl"><thead><tr><th>用户名</th><th>状态</th><th>角色</th><th>注册时间</th><th>操作</th></tr></thead><tbody>';
        users.forEach(function (u) {
          var statusTxt = u.status === "approved" ? '<span class="chip ok">已通过</span>' : '<span class="chip" style="color:var(--warn)">待审核</span>';
          var roleTxt = u.is_admin ? '<span class="chip single">管理员</span>' : "普通用户";
          var t = u.created_at ? new Date(u.created_at * 1000).toLocaleString("zh-CN", { hour12: false }).slice(0, 16) : "—";
          html += '<tr><td><b>' + esc(u.username) + "</b></td><td>" + statusTxt + "</td><td>" + roleTxt + "</td><td class='small'>" + t + "</td><td>";
          if (!u.is_admin) {
            if (u.status !== "approved") html += '<button class="btn sm primary" data-approve="' + u.id + '">通过</button> ';
            html += '<button class="btn sm" data-del="' + u.id + '">删除</button>';
          } else {
            html += '<span class="small muted">—</span>';
          }
          html += "</td></tr>";
        });
        html += "</tbody></table>";
        list.innerHTML = html;
        list.querySelectorAll("[data-approve]").forEach(function (b) {
          b.onclick = function () {
            api("/api/admin/users/" + b.getAttribute("data-approve") + "/approve", { method: "POST" }).then(function (r) {
              if (r.data.ok) { toast("已通过"); loadUsers(); } else toast(r.data.error || "失败");
            });
          };
        });
        list.querySelectorAll("[data-del]").forEach(function (b) {
          b.onclick = function () {
            var id = b.getAttribute("data-del");
            confirmBox("删除用户？", "将删除该用户及其全部学习进度，不可撤销。", function () {
              api("/api/admin/users/" + id + "/delete", { method: "POST" }).then(function (r) {
                if (r.data.ok) { toast("已删除"); loadUsers(); } else toast(r.data.error || "失败");
              });
            });
          };
        });
      });
    }
    loadUsers();
  };

  /* ====================================================== 弹窗 */
  function confirmBox(title, text, onOk) {
    var root = $("#modal-root");
    var mask = h('<div class="modal-mask"><div class="modal"><h3>' + esc(title) + "</h3><p>" + esc(text) + "</p>" +
      '<div class="acts"><button class="btn" id="no">取消</button><button class="btn primary" id="ok">确认</button></div></div></div>');
    root.appendChild(mask);
    $("#no", mask).onclick = function () { root.innerHTML = ""; };
    $("#ok", mask).onclick = function () { root.innerHTML = ""; onOk(); };
    mask.onclick = function (e) { if (e.target === mask) root.innerHTML = ""; };
  }

  /* ====================================================== 键盘 */
  document.addEventListener("keydown", function (e) {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
    var isExam = !!exam && !exam.submitted;
    var isPractice = !!sess && !isExam;
    if (!isExam && !isPractice) return;

    var q = isExam ? byId[exam.ids[exam.pos]] : byId[sess.ids[sess.pos]];
    var picked = isExam ? (exam.answers[q.i] || []) : ((sess.ans[q.i] && sess.ans[q.i].disp) || []);
    var permLen = isExam ? exam.perm[q.i].length : permOf(q).length;

    var num = "123456789".indexOf(e.key);
    if (num >= 0 && num < permLen) {
      var btns = document.querySelectorAll(".opts .opt");
      if (btns[num]) btns[num].click();
      e.preventDefault();
      return;
    }
    var letter = "abcdefgh".indexOf(e.key.toLowerCase());
    if (letter >= 0 && letter < permLen) {
      var btns2 = document.querySelectorAll(".opts .opt");
      if (btns2[letter]) btns2[letter].click();
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowRight" || e.key === " ") {
      var n1 = $("#next"); if (n1) { n1.click(); e.preventDefault(); }
    } else if (e.key === "ArrowLeft") {
      var p1 = $("#prev"); if (p1) { p1.click(); e.preventDefault(); }
    } else if (e.key === "Enter") {
      if (isExam) {
        if (q.t === 1) { var nx = $("#next"); if (nx) nx.click(); }
        else { var n2 = $("#next"); if (n2) n2.click(); }
        e.preventDefault();
      } else {
        var sb = $("#submit");
        if (sb) { sb.click(); e.preventDefault(); }
        else { var n3 = $("#next"); if (n3) { n3.click(); e.preventDefault(); } }
      }
    } else if (e.key === "f" || e.key === "F") {
      if (isPractice) { var fb = $("#fav"); if (fb) fb.click(); e.preventDefault(); }
    }
  });

  /* ====================================================== 主题 */
  function applyTheme() {
    document.documentElement.setAttribute("data-theme", S.settings.theme === "dark" ? "dark" : "light");
    var b = $("#theme-btn");
    if (b) b.textContent = S.settings.theme === "dark" ? "切换浅色模式" : "切换深色模式";
  }

  /* ====================================================== 类别切换器 */
  function renderClassSwitcher() {
    var box = $("#class-switch");
    if (!box) return;
    // 登录后锁定到用户所选类别，隐藏切换器；未登录也不显示（必须登录才能用）
    box.style.display = "none";
    box.innerHTML = "";
    // 品牌区标记字母随当前类别变化
    var mark = $(".brand-mark");
    if (mark) mark.textContent = curClass.toUpperCase();
    $("#brand-sub").textContent = META.version + " · " + META.total + " 题";
  }

  /* ====================================================== 启动 */
  function boot() {
    applyTheme();
    // 侧边栏：目标路由与当前一致时 hashchange 不会触发，这里手动重渲染
    document.querySelectorAll(".nav-item").forEach(function (a) {
      a.addEventListener("click", function () {
        var target = a.getAttribute("href");
        setTimeout(function () { if (location.hash === target) route(); }, 0);
      });
    });
    $("#theme-btn").onclick = function () {
      S.settings.theme = S.settings.theme === "dark" ? "light" : "dark";
      save(); applyTheme();
    };
    $("#foot-note").innerHTML = esc(META.source) + "<br>题库 " + esc(META.version) + " · 仅供参考，以官方为准";
    renderClassSwitcher();
    renderAuthUI();
    renderNavCounts();
    // 启动时检测登录态
    api("/api/me").then(function (r) {
      if (r.status === 200 && r.data.ok && r.data.user) {
        AUTH.user = r.data.user;
        var uk = AUTH.user.klass || "b";
        S.settings.curClass = uk;
        saveSettings();
        curClass = uk;
        buildClassData(uk);
        renderAuthUI();
        renderClassSwitcher();
        pullFromServer().then(function () {
          buildClassData(curClass);
          renderNavCounts();
          route();
        });
      } else {
        // 未登录：强制去登录页
        route();
      }
    });
  }
  boot();
})();
