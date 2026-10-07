/**
 * 云函数：places（对外地址 /api/places）
 * ─────────────────────────────────────────────────────────────
 * 它是干什么的？
 *   GET  ?city=成都 → 返回那个城市有哪些吃的、哪些玩的，以及参考价。（Day 17 上线）
 *   POST            → 新增一条「用户自填地点」，写进 places 表。（Day 18 上线）
 *
 * 为什么 GET 和 POST 在同一个函数里？
 *   云函数按地址路由：/api/places 这个地址只认 places 这一个函数。
 *   浏览器用 GET 来"读"、用 POST 来"写"，请求最终都落到这里，
 *   所以在函数内部按 httpMethod 分流 —— 而不是开两个函数。
 *
 * ── Day 19 重构：数据库代码搬家了 ──
 *   以前这个文件里混着三件事：
 *     ① 接口的事（收请求、分流、包 {ok,data,error}）
 *     ② 业务的事（校验字段、城市名换 id、查重）
 *     ③ 数据库的事（配钥匙、发 HTTP 请求、超时、整理报错）
 *   现在 ③ **整体搬到了同目录的 `db.js`（数据访问层）**，本文件只留 ①②。
 *   → 从此本文件里**不再出现 https、不再出现网关地址**，
 *     读写作法统一成 `db.select(...)` / `db.insert(...)`。
 *   ⚠️ 改"怎么连数据库"去 db.js；改"接口/业务"改本文件。
 *
 * 返回什么形状？（全项目统一，见 api-contract.md 第二节）
 *   成功：{ ok: true,  data: ...,  error: null }
 *   失败：{ ok: false, data: null, error: "人能看懂的中文说明" }
 *
 * ── POST 的防重复是两层保险 ──
 *   第 1 层（函数查重）：插入前先按 城市+名字 查一次，已存在就返回 409，
 *     报错是中文、能看懂，这是用户最常撞到的一种。
 *   第 2 层（数据库兜底）：places 表从 Day 16 起就有 UNIQUE (city_id, name)
 *     联合唯一约束 —— 就算第 1 层查漏了（比如两个人同时提交），
 *     数据库也会当场拒绝，绝不插出重复行。
 *
 * ── 校验顺序（缺什么说什么，绝不笼统报错）──
 *   请求体不是 JSON → 400 ｜ 缺 city / name / type → 400
 *   type 不是 en/play → 400 ｜ price 不是非负整数 → 400
 *   note 超过 255 字 → 400（数据库列宽就是 255，先拦住省得撞库）
 * ─────────────────────────────────────────────────────────────
 */

const db = require('./db.js');

/** 要读写的两张表 */
const TABLE_CITIES = 'cities';
const TABLE_PLACES = 'places';

/** 要取的字段（点名要，不用 `*`，理由见 cities 那个函数的注释） */
const CITY_FIELDS = 'id,name';
const PLACE_FIELDS = 'id,city_id,name,type,price,note,created_at';

/** 一次最多要多少行（理由见 cities 那个函数的注释） */
const LIMIT_ROWS = 2000;

/** 跨域头（Day 18：加了 POST —— 前端要用 POST 写数据了） */
const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/* ============================================================
   一、小工具（接口层的活）
   ============================================================ */

function ok(data) {
  return { ok: true, data: data, error: null };
}

function fail(error) {
  return { ok: false, data: null, error: error };
}

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

/** 从 event 里取出查询参数（四种可能的形状都试一遍，理由见 cities 那个函数的注释） */
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

/**
 * 从 event 里取出 POST 的请求体（JSON 字符串）并解析成对象。
 * 解析失败返回 null —— 让调用方给一句中文报错。
 *
 * 为什么要把「不是 JSON」单独拎出来？
 *   大多数 400 是"缺字段"，但"发过来的根本不是 JSON"是另一种错，
 *   报错文案不一样，混在一起会让人排查半天。
 */
function parseBody(event) {
  if (!event) return null;
  let raw = null;
  if (typeof event.body === 'string') raw = event.body;
  else if (event.body && typeof event.body === 'object') return event.body; // 平台已帮着解析好的情况
  else if (typeof event.isBase64Encoded !== 'undefined' && event.isBase64Encoded && typeof event.body === 'string') {
    raw = Buffer.from(event.body, 'base64').toString('utf8');
  }
  if (raw === null || raw === undefined) return null;
  if (String(raw).trim() === '') return null;
  try {
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : null;
  } catch (e) {
    return null;
  }
}

/* ============================================================
   二、业务：POST 的校验（纯函数，不碰网络 —— 本地就能单测）
   ============================================================ */

/**
 * 校验 POST 进来的地点数据。
 * @param {object} input 已解析的请求体
 * @returns {{valid:true, cleaned:{city,name,type,price,note}} |
 *           {valid:false, http:number, message:string}}
 *
 * 规矩：错误信息必须是中文、说出缺了什么/错了什么，绝不笼统。
 * price 可不填（按 0 算）；note 可不填（按空字符串算）。
 */
function validatePlaceInput(input) {
  // ① city 必填
  const city = (input.city === undefined || input.city === null) ? '' : String(input.city).trim();
  if (!city) {
    return { valid: false, http: 400, message: '缺少必填字段 city（城市名）。请按 {"city":"成都","name":"锦里","type":"en"} 这样的格式发。' };
  }

  // ② name 必填
  const name = (input.name === undefined || input.name === null) ? '' : String(input.name).trim();
  if (!name) {
    return { valid: false, http: 400, message: '缺少必填字段 name（地点名）。例如 {"name":"锦里"}。' };
  }
  if (name.length > 64) {
    return { valid: false, http: 400, message: 'name 太长了（' + name.length + ' 个字，上限 64）。数据库列宽就是 64，先改短再发。' };
  }

  // ③ type 必填，且只能是 en（吃）或 play（玩）—— 与数据库 CHECK 约束一致
  const type = (input.type === undefined || input.type === null) ? '' : String(input.type).trim();
  if (!type) {
    return { valid: false, http: 400, message: '缺少必填字段 type（类别）。只能填 "en"（吃）或 "play"（玩）。' };
  }
  if (type !== 'en' && type !== 'play') {
    return { valid: false, http: 400, message: 'type 的值不对：收到的是 "' + type + '"。只能填 "en"（吃）或 "play"（玩）。' };
  }

  // ④ price 可选；填了就必须是非负整数（数据库列是 INTEGER 且不许为负）
  let price = 0;
  if (input.price !== undefined && input.price !== null && input.price !== '') {
    const n = Number(input.price);
    if (!Number.isInteger(n) || n < 0) {
      return { valid: false, http: 400, message: 'price 必须是 0 或正整数（元）。收到的是 "' + input.price + '"。' };
    }
    price = n;
  }

  // ⑤ note 可选；列宽 255，超了先拦住，别等数据库报一串英文
  let note = '';
  if (input.note !== undefined && input.note !== null) {
    note = String(input.note).trim();
    if (note.length > 255) {
      return { valid: false, http: 400, message: 'note 太长了（' + note.length + ' 个字，上限 255）。请缩短后重发。' };
    }
  }

  return { valid: true, cleaned: { city: city, name: name, type: type, price: price, note: note } };
}

/* ============================================================
   三、业务：GET 的读逻辑（Day 17 逻辑，一行没改）
   ============================================================ */

/**
 * 真正干活的地方。
 * @param {string} cityName 城市名，如「成都」
 *
 * ⚠️ 注意这里**没有一行 https、没有一行网关地址** —— 那些都搬去 db.js 了。
 */
async function readPlaces(cityName) {
  // ① 必填校验 —— 先拦在前面，别去白跑两次数据库
  if (!cityName) {
    return {
      http: 400,
      body: fail('请指定城市，例如：/api/places?city=成都。可用城市见 GET /api/cities'),
    };
  }

  if (!db.hasKey()) return { http: 500, body: fail(db.noKeyHint('places')) };

  // ② 第 1 步：按名字把城市的 id 查出来
  //    名字里可能有中文，必须 encodeURIComponent 编码后才能放进网址
  const cityQs = 'select=' + CITY_FIELDS + '&name=eq.' + encodeURIComponent(cityName) + '&limit=1';

  let cityRes;
  try {
    cityRes = await db.select(TABLE_CITIES, cityQs);
  } catch (e) {
    return { http: 502, body: fail('连不上数据库网关：' + e.message) };
  }

  if (cityRes.status !== 200) return { http: 502, body: fail(db.upstreamError('城市', cityRes)) };
  if (!Array.isArray(cityRes.json)) {
    return {
      http: 502,
      body: fail('查城市时返回的不是数组。原文（截断）：' + String(cityRes.raw || '').slice(0, 300)),
    };
  }
  if (cityRes.json.length === 0) {
    return {
      http: 404,
      body: fail('没有找到城市「' + cityName + '」。可用城市见 GET /api/cities'),
    };
  }

  const cityId = cityRes.json[0].id;

  // ③ 第 2 步：拿这个 id 去 places 表查地点
  const placeQs =
    'select=' + PLACE_FIELDS +
    '&city_id=eq.' + cityId +
    '&order=id.asc&limit=' + LIMIT_ROWS;

  let placeRes;
  try {
    placeRes = await db.select(TABLE_PLACES, placeQs);
  } catch (e) {
    return { http: 502, body: fail('连不上数据库网关：' + e.message) };
  }

  if (placeRes.status !== 200) return { http: 502, body: fail(db.upstreamError('地点', placeRes)) };
  if (!Array.isArray(placeRes.json)) {
    return {
      http: 502,
      body: fail('查地点时返回的不是数组。原文（截断）：' + String(placeRes.raw || '').slice(0, 300)),
    };
  }

  return { http: 200, body: ok(placeRes.json) };
}

/* ============================================================
   四、业务：POST 的写逻辑（Day 18）
   ============================================================ */

/**
 * 新增一条用户自填地点。流程：
 *   ① 校验（上面那个纯函数）
 *   ② 查 cities 表把城市名换成 city_id（和 GET 一样的两步走）
 *   ③ 函数层查重：同城市同名已存在 → 409 中文提示
 *   ④ 插入 places 表（db.insert 内部带了 Prefer，会拿回新行）
 *   ⑤ 201 + 新行
 *
 * @param {object} input 已解析的请求体
 */
async function addPlace(input) {
  // ① 校验
  const v = validatePlaceInput(input);
  if (!v.valid) {
    return { http: v.http, body: fail(v.message) };
  }
  const c = v.cleaned;

  if (!db.hasKey()) return { http: 500, body: fail(db.noKeyHint('places')) };

  // ② 城市名 → city_id（跟 GET 一样的两步走，不写 join）
  const cityQs = 'select=' + CITY_FIELDS + '&name=eq.' + encodeURIComponent(c.city) + '&limit=1';

  let cityRes;
  try {
    cityRes = await db.select(TABLE_CITIES, cityQs);
  } catch (e) {
    return { http: 502, body: fail('连不上数据库网关：' + e.message) };
  }

  if (cityRes.status !== 200) return { http: 502, body: fail(db.upstreamError('城市', cityRes)) };
  if (!Array.isArray(cityRes.json)) {
    return {
      http: 502,
      body: fail('查城市时返回的不是数组。原文（截断）：' + String(cityRes.raw || '').slice(0, 300)),
    };
  }
  if (cityRes.json.length === 0) {
    return {
      http: 404,
      body: fail('没有找到城市「' + c.city + '」，添加不了。可用城市见 GET /api/cities'),
    };
  }

  const cityId = cityRes.json[0].id;

  // ③ 函数层查重（第 1 层保险；数据库 UNIQUE(city_id,name) 是第 2 层）
  const dupQs =
    'select=' + PLACE_FIELDS +
    '&city_id=eq.' + cityId +
    '&name=eq.' + encodeURIComponent(c.name) +
    '&limit=1';

  let dupRes;
  try {
    dupRes = await db.select(TABLE_PLACES, dupQs);
  } catch (e) {
    return { http: 502, body: fail('查重时连不上数据库网关：' + e.message) };
  }

  if (dupRes.status !== 200) return { http: 502, body: fail(db.upstreamError('重名地点', dupRes)) };
  if (Array.isArray(dupRes.json) && dupRes.json.length > 0) {
    const existed = dupRes.json[0];
    return {
      http: 409,
      body: fail('「' + c.name + '」在「' + c.city + '」已经存在（第 ' + existed.id + ' 条，' +
        (existed.type === 'en' ? '吃' : '玩') + '，参考价 ' + existed.price + ' 元），不要重复添加。'),
    };
  }

  // ④ 插入。db.insert 内部就是 POST + JSON 体，并带了 Prefer: return=representation
  let insertRes;
  try {
    insertRes = await db.insert(TABLE_PLACES, {
      city_id: cityId,
      name: c.name,
      type: c.type,
      price: c.price,
      note: c.note,
    }, PLACE_FIELDS);
  } catch (e) {
    return { http: 502, body: fail('写入时连不上数据库网关：' + e.message) };
  }

  if (insertRes.status !== 200 && insertRes.status !== 201) {
    // 数据库层兜底被触发时（第 2 层保险），把"重复"翻译成人话
    const snippet = String(insertRes.raw || '').slice(0, 300);
    if (insertRes.status === 409 || String(snippet).indexOf('uk_places_city_name') >= 0) {
      return {
        http: 409,
        body: fail('「' + c.name + '」在「' + c.city + '」已经存在（数据库唯一约束拦下的），不要重复添加。'),
      };
    }
    return {
      http: 502,
      body: fail('写入时数据库网关返回了 ' + insertRes.status + '。原文（截断）：' + snippet),
    };
  }

  // ⑤ 拿回新行。正常返回数组；个别网关返回空体，
  //    那就把我们发出去的数据补上 city_id 先还回去（id/created_at 让用户用 GET 看）
  let newRow = null;
  if (Array.isArray(insertRes.json) && insertRes.json.length > 0) {
    newRow = insertRes.json[0];
  } else {
    newRow = { city_id: cityId, name: c.name, type: c.type, price: c.price, note: c.note };
  }

  return { http: 201, body: ok(newRow) };
}

/* ============================================================
   五、入口：按 HTTP 方法分流
   ============================================================ */

exports.main = async (event, context) => {
  const isHttpRequest = !!(event && event.httpMethod);
  const method = (event && event.httpMethod) || 'GET';

  // 浏览器发跨域 POST 前会先发一个 OPTIONS"探路"（预检），这里直接放行
  if (isHttpRequest && method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (isHttpRequest && method === 'POST') {
    const input = parseBody(event);
    if (!input) {
      const body = fail('请求体不是能认的 JSON 对象。请用 Content-Type: application/json，' +
        '并按 {"city":"成都","name":"锦里","type":"en"} 这样的格式发。');
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify(body) };
    }
    const result = await addPlace(input);
    return {
      statusCode: result.http,
      headers: CORS_HEADERS,
      body: JSON.stringify(result.body),
    };
  }

  if (isHttpRequest && method !== 'GET') {
    const body = fail('这个接口只支持 GET（读）和 POST（写）。收到的是 ' + method);
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify(body) };
  }

  // ---- GET ----
  // 取出 ?city= 后面的值（顺带把两边空格去掉，"成都 "和"成都"当成同一个）
  const query = getQuery(event);
  const cityName = String((query && query.city) || '').trim();

  const result = await readPlaces(cityName);

  if (isHttpRequest) {
    return {
      statusCode: result.http,
      headers: CORS_HEADERS,
      body: JSON.stringify(result.body),
    };
  }

  return result.body;
};

/** 内部测试用：把纯校验函数露出来，本地单测不需要连数据库 */
exports._validatePlaceInput = validatePlaceInput;
