/**
 * 云函数：cities（对外地址 GET /api/cities）
 * ─────────────────────────────────────────────────────────────
 * 它是干什么的？
 *   把数据库里那张 cities 表（370 个城市）通过一个公网地址吐出来。
 *   前端拿到的就是一个数组，数组里每一项是一个城市。
 *
 * 它跟 health 那个函数的区别？
 *   health 不碰数据，只回一句"我还活着"。
 *   这个函数**真的去读数据库** —— 所以它是第一个"业务接口"。
 *
 * ── Day 19 重构：数据库代码搬家了 ──
 *   以前这个文件里混着两件事：
 *     ① 接口的事（收请求、判方法、把结果包成 {ok,data,error}）
 *     ② 数据库的事（配钥匙、拼网关地址、发 HTTP 请求、超时、整理报错）
 *   现在 ② **整体搬到了同目录的 `db.js`（数据访问层）**，本文件只留 ①。
 *
 *   → 从此本文件里**不再出现 https、不再出现网关地址**；
 *     它只说"我要读 cities 表、要这几列"，由 db.js 去操心"怎么读"。
 *   ⚠️ 改"怎么连数据库"去 db.js；改"接口怎么返回"改本文件。
 *
 * 返回什么形状？（全项目统一，见 api-contract.md 第二节）
 *   成功：{ ok: true,  data: [...], error: null }
 *   失败：{ ok: false, data: null,  error: "人能看懂的中文说明" }
 *   ⚠️ 三个字段永远都在。成功时 error 是 null，失败时 data 是 null ——
 *      前端不用先判断"这个字段存不存在"，写法简单一半。
 *
 * ── Day 23：三类错误提示统一 ──
 *   ① 输入/参数类（400/404/409）② 服务未配置（500）③ 上游/网络类（502）——
 *   三类**都只返回中文**。第 ③ 类以前会把网关原文（英文报错、内部主机名、
 *   JSON 片段）直接甩给用户，现在改成：原文写进函数日志，返回体只给一句中文。
 *   ⚠️ 最外层还加了一层 try/catch 兜底：没预料的异常也返回中文 500。
 * ─────────────────────────────────────────────────────────────
 */

const db = require('./db.js');

/** 要读的表 */
const TABLE = 'cities';

/**
 * 要取的字段 —— 是"点名要"，不是 `select=*`。
 *
 * 为什么不用 `*`：`*` 的意思是"表里有什么就给什么"。
 * 将来表加了内部字段（比如给运维看的备注），`*` 会**自动把它泄露出去**。
 * 点名要的写法有个好处：**加了新字段，接口不会跟着变** —— 想暴露哪些是显式决定的。
 */
const FIELDS = 'id,name,created_at';

/**
 * 一次最多要多少行。
 * 为什么写这个：这类网关（PostgREST）通常有个**默认返回上限**，不确定它给多少，
 * 所以显式要一个大数字 —— 免得"表里 370 行、接口只给 100 行"这种事悄悄发生。
 */
const LIMIT_ROWS = 2000;

/* ============================================================
   跨域（CORS）—— Day 17 打开，Day 24 收紧
   ------------------------------------------------------------
   以前固定返回 `Access-Control-Allow-Origin: *`（任何网页都能读）。
   现在改成**白名单回显**：只有白名单里的「自家页面」来读，才回它自己的
   地址；陌生网页**不回这个头**，浏览器直接拦下。curl 不受影响。
   ============================================================ */

/** 允许来读接口的网页来源（自家页面） */
const ALLOWED_ORIGINS = [
  'https://travel-planner-d4g8o6mee9d231c64-1499365786.tcloudbaseapp.com', // 静态托管（演示台 / backend-test）
  'https://travel-planner-budget.app.workbuddy.host',                      // 在线发布链接
];

/** 本地调试放行：localhost / 127.0.0.1，任意端口 */
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * 跨域头。让浏览器能读、也让 OPTIONS 预检能过 —— 但只对白名单来源。
 * @param {object} event 云函数收到的请求
 * @returns {object} 响应头
 */
function corsHeaders(event) {
  const h = (event && event.headers) || {};
  const origin = h.origin || h.Origin || '';
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
  if (ALLOWED_ORIGINS.indexOf(origin) >= 0 || LOCAL_ORIGIN_RE.test(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

/* ============================================================
   一、小工具（接口层的活）
   ============================================================ */

/** 成功的返回体 */
function ok(data) {
  return { ok: true, data: data, error: null };
}

/** 失败的返回体。error 一律是给人看的中文，不要塞英文报错原文。 */
function fail(error) {
  return { ok: false, data: null, error: error };
}

/** 把 "a=1&b=2" 这种查询串解析成对象 */
function parseQueryString(qs) {
  const out = {};
  String(qs || '').split('&').forEach(function (pair) {
    if (!pair) return;
    const i = pair.indexOf('=');
    const k = i < 0 ? pair : pair.slice(0, i);
    const v = i < 0 ? '' : pair.slice(i + 1);
    out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
  });
  return out;
}

/**
 * 从 event 里取出查询参数。
 *
 * ⚠️ 为什么写得这么"啰嗦"（四处都试一遍）？
 *   我们不确定 HTTP 访问服务把查询参数放在哪个字段里。与其猜一个然后猜错，
 *   不如**每种可能都看一眼**，谁有就用谁。（这是"不猜"的写法。）
 */
function getQuery(event) {
  if (!event) return {};
  if (event.queryStringParameters && typeof event.queryStringParameters === 'object') {
    return event.queryStringParameters;
  }
  if (typeof event.queryString === 'string') return parseQueryString(event.queryString);
  if (typeof event.rawPath === 'string' && event.rawPath.indexOf('?') >= 0) {
    return parseQueryString(event.rawPath.split('?')[1]);
  }
  if (typeof event.path === 'string' && event.path.indexOf('?') >= 0) {
    return parseQueryString(event.path.split('?')[1]);
  }
  return {};
}

/* ============================================================
   二、业务：读 cities 表
   ============================================================ */

/**
 * 真正干活的地方：读 cities 表。
 * 返回 { http: 该给浏览器的状态码, body: 该给浏览器的 JSON }
 *
 * ⚠️ 注意这里**没有一行 https、没有一行网关地址** —— 那些都搬去 db.js 了。
 */
async function readCities() {
  // 钥匙没配 —— 这是最容易犯的部署错误，所以单独给一条说人话的提示
  if (!db.hasKey()) {
    return { http: 500, body: fail(db.noKeyHint('cities')) };
  }

  // 拼查询串：点名要字段 + 按 id 排序（保证每次顺序一样）+ 最多要 LIMIT_ROWS 行
  const qs = 'select=' + FIELDS + '&order=id.asc&limit=' + LIMIT_ROWS;

  let res;
  try {
    res = await db.select(TABLE, qs);
  } catch (e) {
    return { http: 502, body: fail(db.networkError('城市', e)) };
  }

  if (res.status !== 200) {
    return { http: 502, body: fail(db.upstreamError('城市', res)) };
  }

  // 正常应该拿到一个数组。不是数组说明网关给的是别的东西（比如错误对象）
  if (!Array.isArray(res.json)) {
    return { http: 502, body: fail(db.badShapeError('城市列表', res)) };
  }

  return { http: 200, body: ok(res.json) };
}

/* ============================================================
   三、入口
   ============================================================ */

/**
 * 云函数入口。CloudBase 收到请求时调用它。
 *
 * ⚠️ 这里为什么要判断两种调用方式？（跟 health 一样）
 *   SDK 调用   → 直接返回对象，调用方拿到的就是 result
 *   HTTP 访问  → 必须返回 { statusCode, headers, body }，否则浏览器不知道
 *                内容类型是 JSON、也不知道状态码
 *   判断依据：HTTP 访问时 event 里会带 httpMethod
 */
async function handle(event, context) {
  const isHttpRequest = !!(event && event.httpMethod);
  const method = (event && event.httpMethod) || 'GET';

  // 浏览器跨域之前会先发一个 OPTIONS 探路请求，要答应它
  if (isHttpRequest && method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(event), body: '' };
  }

  // 这个接口只读，别的方法一律拒绝
  if (isHttpRequest && method !== 'GET') {
    const body = fail('这个接口只支持 GET（只看数据，不改数据）。收到的是 ' + method);
    return { statusCode: 405, headers: corsHeaders(event), body: JSON.stringify(body) };
  }

  const result = await readCities();

  if (isHttpRequest) {
    return {
      statusCode: result.http,
      headers: corsHeaders(event),
      body: JSON.stringify(result.body),
    };
  }

  // SDK 调用：直接返回对象
  return result.body;
}

/**
 * 云函数入口。
 *
 * ── Day 23：最外层兜底的一层 try/catch（第 3 类错误）──
 *   任何**没被预料**的异常（例如地址里的百分号写错，decodeURIComponent 会抛
 *   URIError），一旦抛出，平台会回它自己的英文错误页/堆栈 —— 又是一句裸报错。
 *   这里兜住：转成一句中文 + 500，原始堆栈写进函数日志。
 *   ⚠️ 不是"异常处理框架"，就一个 try/catch。
 */
exports.main = async (event, context) => {
  try {
    return await handle(event, context);
  } catch (e) {
    console.error('[cities] 未预料的异常 | ' + ((e && e.stack) || e));
    const body = fail('后端内部出错了（不是你的请求问题），请稍后再试。');
    const isHttpRequest = !!(event && event.httpMethod);
    if (isHttpRequest) {
      return { statusCode: 500, headers: corsHeaders(event), body: JSON.stringify(body) };
    }
    return body;
  }
};
