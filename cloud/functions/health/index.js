/**
 * 云函数：health（健康检查）
 * ─────────────────────────────────────────────────────────────
 * 这个函数有什么用？
 *   它是"后端还活着吗"的探针。前端调用它，如果拿回一段 JSON，
 *   就说明「前端 → 云函数 → 前端」这条路是通的。
 *
 * 为什么第一个云函数要做这个、而不是直接做业务接口？
 *   因为它最简单 —— 不读数据库、不调外部服务、不需要任何凭证。
 *   一旦它出问题，问题必定在「部署 / 权限 / 域名」这几件事上，
 *   而不是在业务逻辑里。先把地基探明，再往上盖。
 *
 * ⚠️ 它不碰任何数据，也不代表业务接口已经做好。
 *   真实业务接口在 Day 16–20 才做。
 * ─────────────────────────────────────────────────────────────
 */

const STARTED_AT = Date.now();

/* ============================================================
   跨域（CORS）—— Day 17 打开，Day 24 收紧
   ------------------------------------------------------------
   以前返回 `Access-Control-Allow-Origin: *`（**任何**网页都能读）。
   现在改成**白名单回显**：只有下面这些「自家的页面」来读，才回它自己的
   地址；陌生的网页**不回这个头**，浏览器就直接把它拦下。

   ⚠️ 这不是"防黑客"—— 它是浏览器的一条安全规矩，拦的是「别人的网页
      在用户浏览器里偷偷读我们的接口」。curl 不受跨域限制，照旧能调试。
   ============================================================ */

/** 允许来读接口的网页来源（自家页面） */
const ALLOWED_ORIGINS = [
  'https://travel-planner-d4g8o6mee9d231c64-1499365786.tcloudbaseapp.com', // 静态托管（演示台 / backend-test）
  'https://travel-planner-budget.app.workbuddy.host',                      // 在线发布链接
];

/** 本地调试放行：localhost / 127.0.0.1，任意端口 */
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * 按请求头里的 Origin 组跨域响应头。
 * @param {object} event 云函数收到的请求（HTTP 访问时带 headers）
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

/**
 * 组装要返回的数据。
 * 单独抽出来，是因为下面两种返回方式都要用同一份数据。
 */
function payload() {
  const now = new Date().toISOString();

  // 函数这次运行了多久。用 Date.now() 减去函数启动时记下的时刻。
  const uptimeSeconds = Math.round((Date.now() - STARTED_AT) / 1000);

  return {
    ok: true,               // 固定为 true —— 能返回就代表健康
    service: 'travel-planner-health',
    message: '后端连通了',
    time: now,
    uptimeSeconds: uptimeSeconds,
  };
}

/**
 * 云函数的入口。CloudBase 会在收到请求时调用它。
 *
 * ⚠️ 这里为什么要判断两种调用方式？
 *   云函数有两种被调用的途径，它们对「返回什么」的要求不一样：
 *
 *   ① SDK 调用（小程序 / 前端 SDK）—— 直接返回对象即可，
 *      调用方拿到的就是 result 字段。
 *
 *   ② HTTP 访问（浏览器直接打开网址）—— 必须返回
 *      { statusCode, headers, body }，否则浏览器不知道
 *      内容类型是 JSON、也不知道状态码，可能显示成乱码或报错。
 *
 *   判断依据：HTTP 访问时，event 里会带 httpMethod 等 HTTP 请求信息。
 *
 * @param {object} event   - 请求相关的信息（路径、参数、请求头等）
 * @param {object} context - 函数运行环境的信息（本次调用的元数据）
 */
exports.main = async (event, context) => {
  const data = payload();

  // event 里有 httpMethod，说明是浏览器通过 HTTP 访问服务调过来的
  const isHttpRequest = !!(event && event.httpMethod);

  if (isHttpRequest) {
    return {
      statusCode: 200,
      headers: corsHeaders(event),
      body: JSON.stringify(data),
    };
  }

  // SDK 调用：直接返回对象
  return data;
};
