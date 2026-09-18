/* 站点自测：用 jsdom + mock 后端，跑登录→进度→答题→换类别的完整流程。
   运行： NODE_PATH=<workspace>/node_modules node scripts/test_site.js
*/
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const WEB = path.resolve(__dirname, "..", "web");
const html = fs.readFileSync(path.join(WEB, "index.html"), "utf8");
const examJs = fs.readFileSync(path.join(WEB, "data", "exam.js"), "utf8");
const appJs = fs.readFileSync(path.join(WEB, "assets", "app.js"), "utf8");

let pass = 0, fail = 0;
const errors = [];

function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  <- " + extra : "")); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- mock 后端（内存版）
const mockUsers = {
  admin: { id: 1, username: "admin", password: "admin", is_admin: true, status: "approved", klass: "b" },
  alice: { id: 2, username: "alice", password: "secret1", is_admin: false, status: "approved", klass: "c" },
};
const mockProgress = {};   // "uid:klass" -> data
let mockSessionUid = null;

function mockFetch(url, opts) {
  opts = opts || {};
  const method = (opts.method || "GET").toUpperCase();
  const body = opts.body ? JSON.parse(opts.body) : {};
  let status = 200, data = {};

  const m = url.match(/^\/api\/progress\/([abc])$/);
  if (url === "/api/me") {
    if (mockSessionUid && mockUsers_byId[mockSessionUid]) {
      const u = mockUsers_byId[mockSessionUid];
      data = { ok: true, user: pub(u) };
    } else data = { ok: true, user: null };
  } else if (url === "/api/login") {
    const u = Object.values(mockUsers).find((x) => x.username === body.username && x.password === body.password);
    if (!u) { status = 401; data = { ok: false, error: "用户名或密码错误" }; }
    else if (u.status !== "approved") { status = 403; data = { ok: false, error: "未审核" }; }
    else { mockSessionUid = u.id; data = { ok: true, user: pub(u) }; }
  } else if (url === "/api/logout") {
    mockSessionUid = null; data = { ok: true };
  } else if (url === "/api/user/klass") {
    if (mockSessionUid && mockUsers_byId[mockSessionUid]) {
      mockUsers_byId[mockSessionUid].klass = body.klass;
      data = { ok: true, klass: body.klass };
    } else { status = 401; data = { ok: false }; }
  } else if (m) {
    const klass = m[1];
    if (!mockSessionUid) { status = 401; data = { ok: false }; }
    else if (method === "GET") {
      data = { ok: true, data: mockProgress[mockSessionUid + ":" + klass] || null };
    } else if (method === "POST") {
      mockProgress[mockSessionUid + ":" + klass] = JSON.stringify(body);
      data = { ok: true };
    }
  } else {
    status = 404; data = { ok: false };
  }
  return Promise.resolve({
    status,
    json: () => Promise.resolve(data),
  });
}
const mockUsers_byId = {};
Object.values(mockUsers).forEach((u) => { mockUsers_byId[u.id] = u; });
function pub(u) { return { id: u.id, username: u.username, is_admin: u.is_admin, status: u.status, klass: u.klass }; }

(async function main() {
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push("jsdomError: " + e.message));
  vc.on("error", (m) => errors.push("console.error: " + m));

  const dom = new JSDOM(html, {
    url: "http://localhost/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const w = dom.window;
  const d = w.document;
  w.fetch = mockFetch;
  w.addEventListener("error", (e) => errors.push("window.error: " + (e.error && e.error.stack || e.message)));
  w.scrollTo = () => {};
  w.location.replace = (h) => { w.location.hash = h; };

  console.log("\n== 加载脚本");
  w.eval(examJs);
  ok("题库数据已注入（a/b/c）", !!w.__EXAM_DATA__ && !!w.__EXAM_DATA__.a && !!w.__EXAM_DATA__.b && !!w.__EXAM_DATA__.c);
  ok("A 类 683 题", w.__EXAM_DATA__.a.meta.total === 683);
  ok("B 类 1143 题", w.__EXAM_DATA__.b.meta.total === 1143);
  ok("C 类 1282 题", w.__EXAM_DATA__.c.meta.total === 1282);
  w.eval(appJs);
  await wait(60);

  const main = () => d.getElementById("main");
  const txt = () => main().textContent.replace(/\s+/g, " ");
  const hash = async (h) => { w.location.hash = h; await wait(50); };

  console.log("\n== 未登录强制登录");
  ok("未登录时打开是登录页", txt().indexOf("登录") >= 0 && d.getElementById("lg-user"), txt().slice(0, 60));
  await hash("#/home");
  ok("未登录访问 home 重定向到登录", !!d.getElementById("lg-user"), txt().slice(0, 60));

  console.log("\n== 登录（alice，C 类）");
  d.getElementById("lg-user").value = "alice";
  d.getElementById("lg-pass").value = "secret1";
  d.getElementById("lg-go").click();
  await wait(80);
  ok("登录后进入 home", txt().indexOf("仪表盘") >= 0, txt().slice(0, 60));
  ok("登录后品牌标记为 C（用户类别）", d.querySelector(".brand-mark").textContent === "C", d.querySelector(".brand-mark").textContent);
  ok("登录后显示用户 alice", d.getElementById("auth-box").textContent.indexOf("alice") >= 0);
  ok("登录后题库为 C 类（1282 题）", txt().indexOf("1282") >= 0, txt().slice(0, 100));

  console.log("\n== 切换器已隐藏（登录锁定类别）");
  ok("侧边栏切换器隐藏", d.getElementById("class-switch").style.display === "none");

  console.log("\n== 答题 + 进度同步");
  await hash("#/practice");
  d.getElementById("b-seq").click();
  await wait(40);
  ok("进入答题器", !!d.querySelector(".qcard"));
  const opts = d.querySelectorAll(".opts .opt");
  opts[0].click();
  await wait(10);
  const sub = d.getElementById("submit");
  if (sub) { const o2 = d.querySelectorAll(".opts .opt"); if (o2[1]) o2[1].click(); await wait(6); d.getElementById("submit").click(); await wait(6); }
  const next = d.getElementById("next");
  if (next) { next.click(); await wait(10); }
  await wait(400);  // 等 syncToServer 防抖
  ok("进度已同步到后端（C 类）", !!(mockProgress["2:c"]), JSON.stringify(Object.keys(mockProgress)));
  ok("B 类进度为空（隔离）", !mockProgress["2:b"]);

  console.log("\n== 换类别（C → A，在设置页）");
  await hash("#/settings");
  ok("设置页有账号卡片", txt().indexOf("当前账号") >= 0);
  const klassBtns = d.querySelectorAll("#klass-row .btn");
  ok("设置页有 3 个类别按钮", klassBtns.length === 3);
  // 点 A
  klassBtns[0].click();
  await wait(30);
  const modalOk = d.getElementById("ok");
  ok("弹出确认框", !!modalOk);
  if (modalOk) { modalOk.click(); await wait(80); }
  ok("换类别后品牌标记为 A", d.querySelector(".brand-mark").textContent === "A", d.querySelector(".brand-mark").textContent);
  await hash("#/home");
  ok("换类别后题库为 A 类（683 题）", txt().indexOf("683") >= 0, txt().slice(0, 100));

  console.log("\n== 登出");
  d.getElementById("logout-link").click();
  await wait(60);
  ok("登出后回到登录页", !!d.getElementById("lg-user"));

  console.log("\n== 管理员登录与管理面板");
  d.getElementById("lg-user").value = "admin";
  d.getElementById("lg-pass").value = "admin";
  d.getElementById("lg-go").click();
  await wait(80);
  ok("管理员登录成功", txt().indexOf("仪表盘") >= 0);
  ok("管理员侧边栏有管理入口", d.getElementById("auth-box").textContent.indexOf("管理面板") >= 0);
  await hash("#/admin");
  ok("管理面板渲染", txt().indexOf("用户列表") >= 0 || txt().indexOf("管理面板") >= 0);

  console.log("\n== 控制台错误");
  ok("全程无未捕获错误", errors.length === 0, errors.slice(0, 4).join(" | "));

  console.log("\n================ 结果: " + pass + " 通过 / " + fail + " 失败 ================");
  dom.window.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("测试脚本自身异常:", e);
  process.exit(2);
});
