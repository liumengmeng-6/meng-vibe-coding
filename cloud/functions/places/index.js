/**
 * 云函数：places（对外地址 /api/places）
 * ─────────────────────────────────────────────────────────────
 * 它是干什么的？
 *   GET    ?city=成都 → 返回那个城市有哪些吃的、哪些玩的，以及参考价。（Day 17 上线）
 *   POST              → 新增一条「用户自填地点」，写进 places 表。（Day 18 上线）
 *   PATCH  ?id=63     → 改一条地点（name / type / price / note）。（Day 22 上线）
 *   DELETE ?id=63     → 删一条地点。（Day 22 上线）
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
 *
 * ── Day 22：删除为什么比新增更容易出事？ ──
 *   ✅ 新增写坏了：顶多多一行垃圾，删掉就行 —— **可逆**。
 *   ❌ 删除写坏了：PostgREST 网关有个默认行为 ——
 *        DELETE 请求**不带过滤条件时，会删光整张表**，而且不报错、没提示。
 *      一行 `db.remove('places', '', ...)` 就能让 15 条数据归零。
 *   所以本文件对"改"和"删"都加了**三道确认**，一道不少：
 *     第 1 道（拦在前面）：必须带 ?id=，且必须是正整数 —— 缺了直接 400，
 *         **绝不允许一个没有条件的 PATCH / DELETE 发到数据库**。
 *     第 2 道（先查后动）：先按 id 查一次，查不到 → 404，**根本不发删除**。
 *         （顺带拿到这一行的完整快照，给第 3 道用）
 *     第 3 道（看得见）：删完把**被删掉的那一行**原样返回（PATCH 则返回改完后的行），
 *         让人一眼看到"到底动了哪条、动成了什么样"。
 *   ⚠️ 还有一条纪律：PATCH 只允许改 name / type / price / note 四个字段。
 *      想改 city 不行（换城市 = 删掉重加）—— 少一个可动的地方，就少一处能出事的地方。
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

/** 跨域头（Day 18：加了 POST；Day 22：再加 PATCH、DELETE —— 前端要能改和删） */
const CORS_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
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
   二之二、业务：PATCH / DELETE 的校验（Day 22）
   ============================================================ */

/** PATCH 允许改的字段白名单。city 故意不在里面 —— 换城市请删掉重加。 */
const PATCHABLE_FIELDS = ['name', 'type', 'price', 'note'];

/** 明确不许改的字段（发过来就报错，而不是"默默忽略"——默默忽略最容易让人以为改成功了） */
const FORBIDDEN_FIELDS = ['id', 'city', 'city_id', 'created_at'];

/**
 * 校验地址里的 ?id=63。
 * @returns {{ok:true,id:number} | {ok:false,message:string}}
 *
 * ⚠️ 这是"三道确认"的第 1 道，也是最重要的一道：
 *    没有它，一个不带条件的 DELETE 就能清空整张表。
 */
function parseId(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return {
      ok: false,
      message: '必须带 id，例如 ?id=63（想删/改哪一条）。' +
        '这里不许多余的余地：没有 id 的删除会把整张表清空，所以函数直接拒绝，绝不转发给数据库。',
    };
  }
  const s = String(raw).trim();
  const n = Number(s);
  if (!/^\d+$/.test(s) || !Number.isInteger(n) || n <= 0) {
    return { ok: false, message: 'id 必须是正整数（收到的是 "' + raw + '"）。' };
  }
  return { ok: true, id: n };
}

/**
 * 校验 PATCH 进来的"要改的内容"。
 * @returns {{valid:true, patch:{...}} | {valid:false, http:number, message:string}}
 *
 * 规矩：
 *   · 只认 name / type / price / note 四个字段，多一个都报错（包括想改 city、id）
 *   · 一个字段都没给 → 400（空请求等于什么都没说）
 *   · 给了的字段，规矩跟 POST 时一模一样（type 只能 en/play、price 非负整数、note ≤ 255）
 *   · name 不许改成空串（那是"删名字"，用 DELETE 才是正事）
 */
function validatePlacePatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, http: 400, message: '请求体要是 JSON 对象，例如 {"price":25}。' };
  }

  const keys = Object.keys(input);
  if (keys.length === 0) {
    return {
      valid: false, http: 400,
      message: '没有要改的字段。请按 {"price":25} 这样的格式，至少填一项：name / type / price / note。',
    };
  }

  const forbidden = keys.filter(function (k) { return FORBIDDEN_FIELDS.indexOf(k) >= 0; });
  if (forbidden.length > 0) {
    return {
      valid: false, http: 400,
      message: '不支持修改字段 ' + forbidden.join('、') + '。能改的只有：name（名字）、type（类别）、price（价格）、note（备注）。想换城市请删掉重加。',
    };
  }

  const unknown = keys.filter(function (k) { return PATCHABLE_FIELDS.indexOf(k) < 0; });
  if (unknown.length > 0) {
    return {
      valid: false, http: 400,
      message: '不认识的字段：' + unknown.join('、') + '。能改的只有：name / type / price / note。',
    };
  }

  const patch = {};

  // name：可以改，但不能改成空
  if (keys.indexOf('name') >= 0) {
    const name = (input.name === undefined || input.name === null) ? '' : String(input.name).trim();
    if (!name) {
      return { valid: false, http: 400, message: 'name 不能改成空。要么给个新名字，要么别带这个字段（想删掉这一条请用 DELETE）。' };
    }
    if (name.length > 64) {
      return { valid: false, http: 400, message: 'name 太长了（' + name.length + ' 个字，上限 64）。数据库列宽就是 64。' };
    }
    patch.name = name;
  }

  // type：可以改，但只能是 en / play
  if (keys.indexOf('type') >= 0) {
    const type = (input.type === undefined || input.type === null) ? '' : String(input.type).trim();
    if (type !== 'en' && type !== 'play') {
      return { valid: false, http: 400, message: 'type 的值不对：收到的是 "' + type + '"。只能填 "en"（吃）或 "play"（玩）。' };
    }
    patch.type = type;
  }

  // price：可以改，但必须是非负整数
  if (keys.indexOf('price') >= 0) {
    const n = Number(input.price);
    if (!Number.isInteger(n) || n < 0) {
      return { valid: false, http: 400, message: 'price 必须是 0 或正整数（元）。收到的是 "' + input.price + '"。' };
    }
    patch.price = n;
  }

  // note：可以改，但列宽 255
  if (keys.indexOf('note') >= 0) {
    if (input.note === undefined || input.note === null) {
      patch.note = '';
    } else {
      const note = String(input.note).trim();
      if (note.length > 255) {
        return { valid: false, http: 400, message: 'note 太长了（' + note.length + ' 个字，上限 255）。请缩短后重发。' };
      }
      patch.note = note;
    }
  }

  return { valid: true, patch: patch };
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
   四之二、业务：按 id 找一条（PATCH / DELETE 共用的"第 2 道确认"）
   ============================================================ */

/**
 * 按 id 查一条，拿它的完整快照。
 * @returns {{row:object} | {error:{http:number,body:object}}}
 *   查到了 → { row }
 *   没查到 → { error: {http:404, ...} }
 *   出错   → { error: {http:502, ...} }
 */
async function findPlaceById(id) {
  const qs = 'select=' + PLACE_FIELDS + '&id=eq.' + id + '&limit=1';

  let res;
  try {
    res = await db.select(TABLE_PLACES, qs);
  } catch (e) {
    return { error: { http: 502, body: fail('连不上数据库网关：' + e.message) } };
  }

  if (res.status !== 200) return { error: { http: 502, body: fail(db.upstreamError('地点', res)) } };
  if (!Array.isArray(res.json)) {
    return { error: { http: 502, body: fail('按 id 查时返回的不是数组。原文（截断）：' + String(res.raw || '').slice(0, 300)) } };
  }
  if (res.json.length === 0) {
    return { error: { http: 404, body: fail('没有找到 id=' + id + ' 的地点，什么都没做。可以先用 GET /api/places?city=城市名 看看现有的 id。') } };
  }
  return { row: res.json[0] };
}

/* ============================================================
   四之三、业务：PATCH 的改逻辑（Day 22）
   ============================================================ */

/**
 * 改一条地点。流程就是那"三道确认"：
 *   ① parseId —— 必须带合法 id
 *   ② validatePlacePatch —— 只改允许的四个字段
 *   ③ findPlaceById —— 这条得真的存在（顺带拿到改之前的快照）
 *   ④ 若改名字：查同城里有没有别人叫这个名字（排除自己）→ 409
 *   ⑤ db.update → 返回改完后的那一行
 */
async function updatePlace(idRaw, input) {
  // ① 第 1 道确认：id
  const idCheck = parseId(idRaw);
  if (!idCheck.ok) return { http: 400, body: fail(idCheck.message) };
  const id = idCheck.id;

  // ② 校验要改的内容
  const v = validatePlacePatch(input);
  if (!v.valid) return { http: v.http, body: fail(v.message) };

  if (!db.hasKey()) return { http: 500, body: fail(db.noKeyHint('places')) };

  // ③ 第 2 道确认：先查这条在不在
  const found = await findPlaceById(id);
  if (found.error) return found.error;
  const before = found.row;

  // ④ 改名字时查同城重名（排除自己）—— 数据库的 UNIQUE(city_id,name) 是兜底
  if (v.patch.name && v.patch.name !== before.name) {
    const dupQs =
      'select=' + PLACE_FIELDS +
      '&city_id=eq.' + before.city_id +
      '&name=eq.' + encodeURIComponent(v.patch.name) +
      '&id=neq.' + id +
      '&limit=1';

    let dupRes;
    try {
      dupRes = await db.select(TABLE_PLACES, dupQs);
    } catch (e) {
      return { http: 502, body: fail('查重时连不上数据库网关：' + e.message) };
    }
    if (dupRes.status !== 200) return { http: 502, body: fail(db.upstreamError('重名地点', dupRes)) };
    if (Array.isArray(dupRes.json) && dupRes.json.length > 0) {
      return {
        http: 409,
        body: fail('这座城市里已经有一条叫「' + v.patch.name + '」的了（第 ' + dupRes.json[0].id + ' 条），改名会撞车，没改。'),
      };
    }
  }

  // ⑤ 改
  let res;
  try {
    res = await db.update(TABLE_PLACES, 'id=eq.' + id, v.patch, PLACE_FIELDS);
  } catch (e) {
    return { http: 502, body: fail('修改时连不上数据库网关：' + e.message) };
  }

  if (res.status !== 200 && res.status !== 204) {
    const snippet = String(res.raw || '').slice(0, 300);
    if (res.status === 409 || String(snippet).indexOf('uk_places_city_name') >= 0) {
      return { http: 409, body: fail('改名撞车了：这座城市里已经有同名的地点（数据库唯一约束拦下的）。') };
    }
    return { http: 502, body: fail('修改时数据库网关返回了 ' + res.status + '。原文（截断）：' + snippet) };
  }

  // 第 3 道确认：把"改完之后的那一行"还回去（个别网关回空体时，自己拼一份）
  let after = null;
  if (Array.isArray(res.json) && res.json.length > 0) {
    after = res.json[0];
  } else {
    after = Object.assign({}, before, v.patch);
  }

  return { http: 200, body: ok(after) };
}

/* ============================================================
   四之四、业务：DELETE 的删逻辑（Day 22）
   ============================================================ */

/**
 * 删一条地点。这是全项目最需要小心的一条路，所以三道确认一道不少：
 *   ① parseId —— 必须带合法 id（**这道确认拦住了"删光整张表"**）
 *   ② findPlaceById —— 这条得真的存在；不存在 → 404，且**根本不发删除请求**
 *   ③ db.remove 带 'id=eq.N' → 返回**被删掉的那一行**（你能看到删了什么）
 *
 * 为什么不像 POST 那样"查不到就直接插"？
 *   删和插的心态完全相反：插是"尽量成功"，删是"宁可失败也别删错"。
 *   所以这里 404 就是终点 —— 不会去猜、不会降级、不会"顺便删点别的"。
 */
async function deletePlace(idRaw) {
  // ① 第 1 道确认：id
  const idCheck = parseId(idRaw);
  if (!idCheck.ok) return { http: 400, body: fail(idCheck.message) };
  const id = idCheck.id;

  if (!db.hasKey()) return { http: 500, body: fail(db.noKeyHint('places')) };

  // ② 第 2 道确认：先查这条在不在
  const found = await findPlaceById(id);
  if (found.error) return found.error;

  // ③ 真删。过滤条件写死成这一条的 id —— 绝不存在"删到别人"的可能
  let res;
  try {
    res = await db.remove(TABLE_PLACES, 'id=eq.' + id, PLACE_FIELDS);
  } catch (e) {
    return { http: 502, body: fail('删除时连不上数据库网关：' + e.message) };
  }

  if (res.status !== 200 && res.status !== 204) {
    return {
      http: 502,
      body: fail('删除时数据库网关返回了 ' + res.status + '。原文（截断）：' + String(res.raw || '').slice(0, 300)),
    };
  }

  // 第 3 道确认：把被删掉的那一行原样还回去
  const deleted = (Array.isArray(res.json) && res.json.length > 0) ? res.json[0] : found.row;
  return { http: 200, body: ok(deleted) };
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

  // ---- PATCH：改一条（Day 22）----
  // 要改什么在请求体里，改哪一条在地址的 ?id= 里
  if (isHttpRequest && method === 'PATCH') {
    const input = parseBody(event);
    if (!input) {
      const body = fail('请求体不是能认的 JSON 对象。请用 Content-Type: application/json，' +
        '并按 {"price":25} 这样的格式发（能改的字段：name / type / price / note）。');
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify(body) };
    }
    const query = getQuery(event);
    const result = await updatePlace(query.id, input);
    return {
      statusCode: result.http,
      headers: CORS_HEADERS,
      body: JSON.stringify(result.body),
    };
  }

  // ---- DELETE：删一条（Day 22）----
  // ⚠️ 注意这里**没有请求体**：删哪一条完全靠 ?id= 决定。
  //    正因如此，parseId 那道确认是生死线（见 deletePlace 的注释）
  if (isHttpRequest && method === 'DELETE') {
    const query = getQuery(event);
    const result = await deletePlace(query.id);
    return {
      statusCode: result.http,
      headers: CORS_HEADERS,
      body: JSON.stringify(result.body),
    };
  }

  if (isHttpRequest && method !== 'GET') {
    const body = fail('这个接口支持 GET（读）、POST（新增）、PATCH（改一条）、DELETE（删一条）。收到的是 ' + method);
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
exports._validatePlacePatch = validatePlacePatch;
exports._parseId = parseId;
