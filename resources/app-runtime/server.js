/**
 * FreeCoder 生成 - 应用后端运行时（SQLite 存储 + OAuth + 分页搜索排序）。
 *
 * 功能：
 * 1. 用户注册 / 登录 / 当前用户（JWT 认证，HMAC-SHA256 自实现）
 * 2. 用户数据持久化到 SQLite（data/app.db），支持并发安全
 * 3. 通用集合 API：分页 / 搜索 / 排序
 * 4. OAuth 第三方登录（GitHub / Google / 微信）
 * 5. 读取 .env 配置，缺省时使用内置默认值
 * 6. 部署模式：同时托管同目录静态文件，监听 PORT || 80
 * 7. 预览模式：被 FreeCoder 预览服务器 require，仅导出 handleApi
 *
 * 接口约定（预览服务器会调用）：
 *   handleApi(method, urlPath, bodyText, headers) → { status, body, headers? }
 */
'use strict';

const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const querystring = require('node:querystring');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'app.db');

// ---------- 配置（读取 .env） ----------
function loadEnv() {
  const env = {};
  try {
    const text = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].trim();
    }
  } catch (_e) {
    /* .env 不存在时使用默认值 */
  }
  return env;
}
const ENV = loadEnv();
const JWT_SECRET = ENV.JWT_SECRET || 'freecoder-local-secret-keep-safe';
const JWT_EXPIRES_IN = parseInt(ENV.JWT_EXPIRES_IN || '7', 10) * 86400;
const OAUTH_REDIRECT_BASE = (ENV.OAUTH_REDIRECT_BASE || 'http://localhost:3000').replace(/\/+$/, '');

// OAuth 配置
const OAUTH_CONFIG = {
  github: {
    clientId: ENV.GITHUB_CLIENT_ID || '',
    clientSecret: ENV.GITHUB_CLIENT_SECRET || '',
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userUrl: 'https://api.github.com/user',
    scope: 'read:user user:email',
  },
  google: {
    clientId: ENV.GOOGLE_CLIENT_ID || '',
    clientSecret: ENV.GOOGLE_CLIENT_SECRET || '',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
  },
  wechat: {
    appId: ENV.WECHAT_APP_ID || '',
    appSecret: ENV.WECHAT_APP_SECRET || '',
    authUrl: 'https://open.weixin.qq.com/connect/qrconnect',
    tokenUrl: 'https://api.weixin.qq.com/sns/oauth2/access_token',
    userUrl: 'https://api.weixin.qq.com/sns/userinfo',
    scope: 'snsapi_login',
  },
};

// ---------- SQLite 初始化 ----------
let db = null;
let SQL = null;

// sql.js WASM 初始化 Promise（模块加载时立即启动）
// 初始化可能因 WASM 内存分配偶发失败（"out of memory"），这里重试几次后再降级，
// 避免一次性失败导致整个后端实例永久不可用（预览 500）。
const dbReady = (function () {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // sql.js 的初始化 Promise 失败后会被模块级永久缓存，重试前需清掉模块缓存重新加载
  function freshInitSqlJs() {
    try { delete require.cache[require.resolve('sql.js')]; } catch (_e) { /* 首次加载无需清理 */ }
    return require('sql.js');
  }
  function retryLater(attempt) {
    return new Promise(function (resolve) { setTimeout(resolve, 150 * attempt); });
  }
  function initAttempt(attempt) {
    return freshInitSqlJs()()
      .then(function (sqlModule) {
        SQL = sqlModule;
        // 加载或创建数据库
        var fileData = null;
        try { fileData = fs.readFileSync(DB_FILE); } catch (_e) { /* 新库 */ }
        db = fileData ? new SQL.Database(fileData) : new SQL.Database();
        createTables(db);
        saveDatabase();
      })
      .catch(function (err) {
        if (attempt < 3) {
          // 瞬态失败（内存不足等）：短暂等待后重试
          return retryLater(attempt).then(function () { return initAttempt(attempt + 1); });
        }
        // 重试仍失败时静默降级为无数据库模式：
        // 必须吞掉 rejection，否则 require(server.js) 的宿主（PreviewServer）会收到
        // 无法捕获的 unhandledRejection，污染主进程。业务 API 会走内存降级路径。
        SQL = null;
        console.warn('[server.js] sql.js 初始化失败，后端将降级为内存模式:', err && err.message ? err.message : err);
      });
  }
  return initAttempt(1);
})();

function createTables(sqlDb) {
  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE,
      salt TEXT,
      password_hash TEXT,
      github_id TEXT UNIQUE,
      google_id TEXT UNIQUE,
      wechat_openid TEXT UNIQUE,
      avatar_url TEXT,
      display_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS collection_items (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      collection TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  sqlDb.run(`
    CREATE INDEX IF NOT EXISTS idx_collection_user
    ON collection_items(user_id, collection)
  `);

  sqlDb.run(`
    CREATE INDEX IF NOT EXISTS idx_collection_updated
    ON collection_items(user_id, collection, updated_at DESC)
  `);

  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);
}

function saveDatabase() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_FILE, buffer);
  } catch (_e) {
    /* 保存失败不中断服务 */
  }
}

// ---------- JWT（HMAC-SHA256） ----------
function b64url(data) {
  return Buffer.from(data).toString('base64url');
}

function signJwt(payload, expiresInSec) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = Object.assign({}, payload, { iat: now, exp: now + expiresInSec });
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(h + '.' + p).digest('base64url');
  return h + '.' + p + '.' + sig;
}

function verifyJwt(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const [h, p, sig] = parts;
    const expect = crypto.createHmac('sha256', JWT_SECRET).update(h + '.' + p).digest('base64url');
    const a = Buffer.from(expect);
    const b = Buffer.from(sig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (_e) {
    return null;
  }
}

// ---------- 用户操作（SQLite） ----------
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 32).toString('hex');
}

function findUserByUsername(username) {
  const row = db.exec('SELECT * FROM users WHERE username = ?', [String(username)]);
  if (!row.length || !row[0].values.length) return null;
  return rowToUser(row[0]);
}

function findUserById(id) {
  const row = db.exec('SELECT * FROM users WHERE id = ?', [id]);
  if (!row.length || !row[0].values.length) return null;
  return rowToUser(row[0]);
}

function findUserByOAuth(provider, oauthId) {
  const colMap = { github: 'github_id', google: 'google_id', wechat: 'wechat_openid' };
  const col = colMap[provider];
  if (!col) return null;
  const row = db.exec('SELECT * FROM users WHERE ' + col + ' = ?', [oauthId]);
  if (!row.length || !row[0].values.length) return null;
  return rowToUser(row[0]);
}

function rowToUser(result) {
  const cols = result.columns;
  const vals = result.values[0];
  const obj = {};
  cols.forEach(function (c, i) { obj[c] = vals[i]; });
  return obj;
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name || user.username,
    avatarUrl: user.avatar_url || null,
    createdAt: user.created_at,
  };
}

function createUser(username, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.run(
    'INSERT INTO users (id, username, salt, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, String(username), salt, hashPassword(password, salt), now, now]
  );
  saveDatabase();
  return findUserById(id);
}

function createOrUpdateOAuthUser(provider, profile) {
  const colMap = { github: 'github_id', google: 'google_id', wechat: 'wechat_openid' };
  const col = colMap[provider];
  const oauthId = String(profile.id);
  const now = new Date().toISOString();

  // 查找已有用户
  const existing = findUserByOAuth(provider, oauthId);
  if (existing) {
    db.run(
      'UPDATE users SET avatar_url = ?, display_name = ?, updated_at = ? WHERE id = ?',
      [profile.avatarUrl || existing.avatar_url, profile.displayName || existing.display_name, now, existing.id]
    );
    saveDatabase();
    return findUserById(existing.id);
  }

  // 创建新用户
  const id = crypto.randomUUID();
  const username = profile.username || (provider + '_' + oauthId.slice(0, 8));
  // 确保用户名唯一
  let finalUsername = username;
  let suffix = 1;
  while (findUserByUsername(finalUsername)) {
    finalUsername = username + '_' + suffix++;
  }

  db.run(
    'INSERT INTO users (id, username, ' + col + ', avatar_url, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, finalUsername, oauthId, profile.avatarUrl || null, profile.displayName || finalUsername, now, now]
  );
  saveDatabase();
  return findUserById(id);
}

function currentUserFromHeaders(headers) {
  const rawHeaders = headers || {};
  const authHeader = String(rawHeaders.authorization || rawHeaders.Authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const payload = verifyJwt(token);
  if (!payload || !payload.sub) return null;
  return findUserById(payload.sub);
}

// ---------- 集合数据操作（SQLite） ----------
function validateCollectionName(name) {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(String(name || ''));
}

function listCollectionItems(userId, collection, options) {
  const opts = options || {};
  const page = Math.max(1, parseInt(opts.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(opts.pageSize, 10) || 0));
  const sortField = opts.sort || 'created_at';
  const sortOrder = (opts.order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const search = opts.search || '';

  // 白名单排序字段
  const allowedSortFields = ['created_at', 'updated_at', 'id'];
  const safeSort = allowedSortFields.includes(sortField) ? sortField : 'created_at';

  let countSql = 'SELECT COUNT(*) as cnt FROM collection_items WHERE user_id = ? AND collection = ?';
  let querySql = 'SELECT * FROM collection_items WHERE user_id = ? AND collection = ?';
  const params = [userId, collection];

  // 搜索：对 data JSON 做模糊匹配
  if (search) {
    countSql += ' AND data LIKE ?';
    querySql += ' AND data LIKE ?';
    params.push('%' + search.replace(/%/g, '\\%') + '%');
  }

  // 获取总数
  const countResult = db.exec(countSql, params);
  const total = countResult.length && countResult[0].values.length ? countResult[0].values[0][0] : 0;

  // 如果不传 pageSize，返回全部（向后兼容）
  if (!pageSize) {
    querySql += ' ORDER BY ' + safeSort + ' ' + sortOrder;
    const rows = db.exec(querySql, params);
    const items = rows.length ? rows[0].values.map(function (v) {
      return parseCollectionRow(v, rows[0].columns);
    }) : [];
    return { items: items, pagination: { page: 1, pageSize: items.length, total: total, totalPages: 1 } };
  }

  // 分页查询
  const offset = (page - 1) * pageSize;
  querySql += ' ORDER BY ' + safeSort + ' ' + sortOrder + ' LIMIT ? OFFSET ?';
  const queryParams = params.concat([pageSize, offset]);
  const rows = db.exec(querySql, queryParams);
  const items = rows.length ? rows[0].values.map(function (v) {
    return parseCollectionRow(v, rows[0].columns);
  }) : [];

  return {
    items: items,
    pagination: {
      page: page,
      pageSize: pageSize,
      total: total,
      totalPages: Math.ceil(total / pageSize) || 1,
    },
  };
}

function parseCollectionRow(values, columns) {
  const obj = {};
  columns.forEach(function (c, i) { obj[c] = values[i]; });
  // 解析 data JSON 并合并顶层字段
  let data = {};
  try { data = JSON.parse(obj.data); } catch (_e) { /* ignore */ }
  return Object.assign(data, {
    id: obj.id,
    createdAt: obj.created_at,
    updatedAt: obj.updated_at,
  });
}

function getCollectionItem(userId, collection, itemId) {
  const rows = db.exec(
    'SELECT * FROM collection_items WHERE id = ? AND user_id = ? AND collection = ?',
    [itemId, userId, collection]
  );
  if (!rows.length || !rows[0].values.length) return null;
  return parseCollectionRow(rows[0].values[0], rows[0].columns);
}

function createCollectionItem(userId, collection, body) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const data = JSON.stringify(body);
  db.run(
    'INSERT INTO collection_items (id, user_id, collection, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, userId, collection, data, now, now]
  );
  saveDatabase();
  return getCollectionItem(userId, collection, id);
}

function updateCollectionItem(userId, collection, itemId, body) {
  const existing = getCollectionItem(userId, collection, itemId);
  if (!existing) return null;
  const now = new Date().toISOString();
  // 保留 id 与 createdAt
  const merged = Object.assign({}, body, { id: existing.id, createdAt: existing.createdAt });
  const data = JSON.stringify(merged);
  db.run(
    'UPDATE collection_items SET data = ?, updated_at = ? WHERE id = ? AND user_id = ? AND collection = ?',
    [data, now, itemId, userId, collection]
  );
  saveDatabase();
  return getCollectionItem(userId, collection, itemId);
}

function deleteCollectionItem(userId, collection, itemId) {
  const before = db.exec(
    'SELECT COUNT(*) FROM collection_items WHERE id = ? AND user_id = ? AND collection = ?',
    [itemId, userId, collection]
  );
  const count = before.length && before[0].values.length ? before[0].values[0][0] : 0;
  if (!count) return false;
  db.run(
    'DELETE FROM collection_items WHERE id = ? AND user_id = ? AND collection = ?',
    [itemId, userId, collection]
  );
  saveDatabase();
  return true;
}

// ---------- OAuth 工具 ----------
function generateState(provider, redirectUri) {
  const state = crypto.randomBytes(16).toString('hex');
  const expiresAt = Math.floor(Date.now() / 1000) + 300; // 5 分钟
  db.run(
    'INSERT INTO oauth_states (state, provider, redirect_uri, expires_at) VALUES (?, ?, ?, ?)',
    [state, provider, redirectUri, expiresAt]
  );
  saveDatabase();
  return state;
}

function consumeState(state) {
  const rows = db.exec('SELECT * FROM oauth_states WHERE state = ?', [state]);
  if (!rows.length || !rows[0].values.length) return null;
  const cols = rows[0].columns;
  const vals = rows[0].values[0];
  const obj = {};
  cols.forEach(function (c, i) { obj[c] = vals[i]; });
  // 检查过期
  if (obj.expires_at < Math.floor(Date.now() / 1000)) {
    db.run('DELETE FROM oauth_states WHERE state = ?', [state]);
    saveDatabase();
    return null;
  }
  // 使用后删除
  db.run('DELETE FROM oauth_states WHERE state = ?', [state]);
  saveDatabase();
  return obj;
}

function cleanExpiredStates() {
  db.run('DELETE FROM oauth_states WHERE expires_at < ?', [Math.floor(Date.now() / 1000)]);
  saveDatabase();
}

// HTTPS GET 请求工具
function httpsGet(url, headers) {
  return new Promise(function (resolve, reject) {
    const parsed = new URL(url);
    const opts = { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'GET', headers: headers || {} };
    const req = https.request(opts, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// HTTPS POST 请求工具
function httpsPost(url, body, headers) {
  return new Promise(function (resolve, reject) {
    const parsed = new URL(url);
    const postData = typeof body === 'string' ? body : querystring.stringify(body);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      }, headers || {}),
    };
    const req = https.request(opts, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ---------- 请求工具 ----------
function readBodyText(bodyText) {
  if (!bodyText) return {};
  try { return JSON.parse(bodyText); } catch (_e) { return {}; }
}

function json(status, body, extraHeaders) {
  return { status: status, body: body, headers: extraHeaders || {} };
}

function fail(status, message) {
  return json(status, { error: message });
}

function redirect(url) {
  return { status: 302, body: {}, headers: { Location: url } };
}

// ---------- API 处理 ----------
async function handleApi(method, urlPath, bodyText, headers) {
  // 等待数据库初始化完成
  await dbReady;

  const url = new URL(urlPath, 'http://localhost');
  const route = url.pathname;
  const params = url.searchParams;
  const body = readBodyText(bodyText);

  // 定期清理过期的 OAuth state
  if (Math.random() < 0.01) cleanExpiredStates();

  if (method === 'GET' && route === '/api/health') {
    return json(200, { ok: true });
  }

  // ========== 注册 ==========
  if (method === 'POST' && route === '/api/register') {
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (username.length < 2 || username.length > 32) {
      return fail(400, '用户名需为 2-32 个字符');
    }
    if (password.length < 6) {
      return fail(400, '密码至少 6 位');
    }
    if (findUserByUsername(username)) {
      return fail(409, '该用户名已被注册');
    }
    const user = createUser(username, password);
    return json(200, {
      token: signJwt({ sub: user.id, username: user.username }, JWT_EXPIRES_IN),
      user: publicUser(user),
    });
  }

  // ========== 登录 ==========
  if (method === 'POST' && route === '/api/login') {
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const user = findUserByUsername(username);
    if (!user || !user.salt || hashPassword(password, user.salt) !== user.password_hash) {
      return fail(401, '用户名或密码错误');
    }
    return json(200, {
      token: signJwt({ sub: user.id, username: user.username }, JWT_EXPIRES_IN),
      user: publicUser(user),
    });
  }

  // ========== 当前用户 ==========
  if (method === 'GET' && route === '/api/me') {
    const user = currentUserFromHeaders(headers);
    if (!user) return fail(401, '登录已失效，请重新登录');
    return json(200, { user: publicUser(user) });
  }

  // ========== OAuth ==========
  // GET /api/oauth/:provider/auth → 重定向到授权页
  const oauthAuthMatch = route.match(/^\/api\/oauth\/([^/]+)\/auth$/);
  if (method === 'GET' && oauthAuthMatch) {
    const provider = oauthAuthMatch[1];
    const config = OAUTH_CONFIG[provider];
    if (!config) return fail(400, '不支持的登录方式');
    if (provider === 'github' && !config.clientId) return fail(500, 'GitHub OAuth 未配置');
    if (provider === 'google' && !config.clientId) return fail(500, 'Google OAuth 未配置');
    if (provider === 'wechat' && !config.appId) return fail(500, '微信 OAuth 未配置');

    const callbackUrl = OAUTH_REDIRECT_BASE + '/api/oauth/' + provider + '/callback';
    const state = generateState(provider, callbackUrl);

    let authUrl;
    if (provider === 'wechat') {
      authUrl = config.authUrl + '?appid=' + encodeURIComponent(config.appId)
        + '&redirect_uri=' + encodeURIComponent(callbackUrl)
        + '&response_type=code&scope=' + encodeURIComponent(config.scope)
        + '&state=' + state + '#wechat_redirect';
    } else if (provider === 'google') {
      authUrl = config.authUrl + '?client_id=' + encodeURIComponent(config.clientId)
        + '&redirect_uri=' + encodeURIComponent(callbackUrl)
        + '&response_type=code&scope=' + encodeURIComponent(config.scope)
        + '&state=' + state + '&access_type=offline';
    } else {
      // GitHub
      authUrl = config.authUrl + '?client_id=' + encodeURIComponent(config.clientId)
        + '&redirect_uri=' + encodeURIComponent(callbackUrl)
        + '&scope=' + encodeURIComponent(config.scope)
        + '&state=' + state;
    }
    return redirect(authUrl);
  }

  // GET /api/oauth/:provider/callback → 处理回调
  const oauthCbMatch = route.match(/^\/api\/oauth\/([^/]+)\/callback$/);
  if (method === 'GET' && oauthCbMatch) {
    const provider = oauthCbMatch[1];
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');

    if (error) {
      return redirect(OAUTH_REDIRECT_BASE + '/?oauth_error=' + encodeURIComponent(error));
    }
    if (!code || !state) {
      return redirect(OAUTH_REDIRECT_BASE + '/?oauth_error=missing_params');
    }

    const stateData = consumeState(state);
    if (!stateData || stateData.provider !== provider) {
      return redirect(OAUTH_REDIRECT_BASE + '/?oauth_error=invalid_state');
    }

    const config = OAUTH_CONFIG[provider];
    if (!config) return redirect(OAUTH_REDIRECT_BASE + '/?oauth_error=unknown_provider');

    // 用 code 换 token（异步）→ 这里返回一个中间页面来处理
    // 由于 handleApi 是同步的，我们返回一个 HTML 页面来做异步 token 交换
    const htmlPage = buildOAuthCallbackPage(provider, code, config, OAUTH_REDIRECT_BASE, JWT_SECRET, JWT_EXPIRES_IN);
    return { status: 200, body: htmlPage, headers: { 'Content-Type': 'text/html; charset=utf-8' }, _isHtml: true };
  }

  // POST /api/oauth/token-exchange → 前端调用来完成 OAuth token 交换
  if (method === 'POST' && route === '/api/oauth/token-exchange') {
    const provider = body.provider;
    const code = body.code;
    const config = OAUTH_CONFIG[provider];
    if (!config) return fail(400, '不支持的登录方式');
    if (!code) return fail(400, '缺少 authorization code');

    // 这个端点是异步的，但在 handleApi 同步模型下无法直接 await
    // 返回特殊标记让 HTTP 层处理
    return { status: 202, body: { _asyncOAuth: true, provider: provider, code: code }, _asyncOAuth: true };
  }

  // ========== 通用数据集合 API（按用户隔离，支持分页/搜索/排序） ==========
  const dataMatch = route.match(/^\/api\/data\/([^/]+)(?:\/([^/]+))?$/);
  if (dataMatch) {
    const collection = decodeURIComponent(dataMatch[1]);
    const itemId = dataMatch[2] ? decodeURIComponent(dataMatch[2]) : null;
    if (!validateCollectionName(collection)) {
      return fail(400, '集合名称不合法（仅允许字母、数字、下划线、短横线，1-64 位）');
    }
    const user = currentUserFromHeaders(headers);
    if (!user) return fail(401, '请先登录');

    // GET /api/data/:collection → 列表（支持分页/搜索/排序）
    if (method === 'GET' && !itemId) {
      const result = listCollectionItems(user.id, collection, {
        page: params.get('page'),
        pageSize: params.get('pageSize'),
        sort: params.get('sort'),
        order: params.get('order'),
        search: params.get('search'),
      });
      return json(200, result);
    }
    // GET /api/data/:collection/:id → 单条
    if (method === 'GET' && itemId) {
      const item = getCollectionItem(user.id, collection, itemId);
      if (!item) return fail(404, '记录不存在');
      return json(200, { item: item });
    }
    // POST /api/data/:collection → 新建
    if (method === 'POST' && !itemId) {
      if (!body || typeof body !== 'object') return fail(400, '请求体必须是 JSON 对象');
      const item = createCollectionItem(user.id, collection, body);
      return json(200, { item: item });
    }
    // PUT /api/data/:collection/:id → 更新
    if (method === 'PUT' && itemId) {
      if (!body || typeof body !== 'object') return fail(400, '请求体必须是 JSON 对象');
      const item = updateCollectionItem(user.id, collection, itemId, body);
      if (!item) return fail(404, '记录不存在');
      return json(200, { item: item });
    }
    // DELETE /api/data/:collection/:id → 删除
    if (method === 'DELETE' && itemId) {
      const ok = deleteCollectionItem(user.id, collection, itemId);
      if (!ok) return fail(404, '记录不存在');
      return json(200, { ok: true });
    }
    return fail(405, '不支持的请求方法');
  }

  if (route.startsWith('/api/')) {
    return fail(404, '接口不存在');
  }

  return fail(404, 'Not Found');
}

// ---------- OAuth 回调页面（处理异步 token 交换） ----------
function buildOAuthCallbackPage(provider, code, config, redirectBase, jwtSecret, jwtExpiresIn) {
  // 返回一个自包含的 HTML 页面，在浏览器端完成 token 交换
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>登录中...</title>'
    + '<style>body{display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:-apple-system,sans-serif;color:#334155}'
    + '.loading{text-align:center}.spinner{width:32px;height:32px;border:3px solid #e2e8f0;border-top-color:#4a90d9;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 12px}'
    + '@keyframes spin{to{transform:rotate(360deg)}}.error{color:#dc2626;display:none}</style></head><body>'
    + '<div class="loading"><div class="spinner"></div><p id="msg">正在完成登录...</p><p class="error" id="err"></p></div>'
    + '<script>'
    + '(function(){'
    + 'var provider=' + JSON.stringify(provider) + ';'
    + 'var code=' + JSON.stringify(code) + ';'
    + 'fetch("/api/oauth/token-exchange",{method:"POST",headers:{"Content-Type":"application/json"},'
    + 'body:JSON.stringify({provider:provider,code:code})})'
    + '.then(function(r){return r.json()})'
    + '.then(function(data){'
    + 'if(data.error){document.getElementById("msg").style.display="none";'
    + 'var e=document.getElementById("err");e.textContent=data.error;e.style.display="block";return}'
    + 'if(data.token){window.location.hash="token="+encodeURIComponent(data.token)'
    + '+ "&user="+encodeURIComponent(JSON.stringify(data.user));'
    + 'window.close();return}'
    + 'document.getElementById("msg").textContent="登录失败，请重试";'
    + '}).catch(function(e){'
    + 'document.getElementById("msg").style.display="none";'
    + 'var el=document.getElementById("err");el.textContent="网络错误："+e.message;el.style.display="block"'
    + '})})();'
    + '</script></body></html>';
}

// ---------- 异步 OAuth token 交换（HTTP 层调用） ----------
async function exchangeOAuthToken(provider, code) {
  const config = OAUTH_CONFIG[provider];
  if (!config) return { error: '不支持的登录方式' };

  try {
    let tokenData, userData;

    if (provider === 'github') {
      // GitHub: POST token exchange
      tokenData = await httpsPost(config.tokenUrl, {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code: code,
      }, { Accept: 'application/json' });

      if (!tokenData.access_token) {
        return { error: 'GitHub 授权失败' };
      }

      // 获取用户信息
      userData = await httpsGet(config.userUrl, {
        Authorization: 'Bearer ' + tokenData.access_token,
        'User-Agent': 'FreeCoder',
      });

      const user = createOrUpdateOAuthUser('github', {
        id: String(userData.id),
        username: userData.login,
        displayName: userData.name || userData.login,
        avatarUrl: userData.avatar_url,
      });

      return {
        token: signJwt({ sub: user.id, username: user.username }, JWT_EXPIRES_IN),
        user: publicUser(user),
      };
    }

    if (provider === 'google') {
      tokenData = await httpsPost(config.tokenUrl, {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code: code,
        redirect_uri: OAUTH_REDIRECT_BASE + '/api/oauth/google/callback',
        grant_type: 'authorization_code',
      });

      if (!tokenData.access_token) {
        return { error: 'Google 授权失败' };
      }

      userData = await httpsGet(config.userUrl, {
        Authorization: 'Bearer ' + tokenData.access_token,
      });

      const user = createOrUpdateOAuthUser('google', {
        id: userData.sub,
        username: userData.email ? userData.email.split('@')[0] : 'google_' + userData.sub.slice(0, 8),
        displayName: userData.name || userData.email,
        avatarUrl: userData.picture,
      });

      return {
        token: signJwt({ sub: user.id, username: user.username }, JWT_EXPIRES_IN),
        user: publicUser(user),
      };
    }

    if (provider === 'wechat') {
      // 微信：GET token
      const tokenUrl = config.tokenUrl + '?appid=' + config.appId
        + '&secret=' + config.appSecret
        + '&code=' + code
        + '&grant_type=authorization_code';

      tokenData = await httpsGet(tokenUrl);

      if (tokenData.errcode) {
        return { error: '微信授权失败：' + (tokenData.errmsg || '未知错误') };
      }

      // 获取用户信息
      const userInfoUrl = config.userUrl + '?access_token=' + tokenData.access_token
        + '&openid=' + tokenData.openid;
      userData = await httpsGet(userInfoUrl);

      if (userData.errcode) {
        return { error: '获取微信用户信息失败' };
      }

      const user = createOrUpdateOAuthUser('wechat', {
        id: userData.unionid || userData.openid,
        username: 'wx_' + (userData.unionid || userData.openid).slice(0, 8),
        displayName: userData.nickname || '微信用户',
        avatarUrl: userData.headimgurl,
      });

      return {
        token: signJwt({ sub: user.id, username: user.username }, JWT_EXPIRES_IN),
        user: publicUser(user),
      };
    }

    return { error: '不支持的登录方式' };
  } catch (e) {
    return { error: 'OAuth 请求失败：' + e.message };
  }
}

// ---------- 部署模式：静态托管 + API ----------
function startServer() {
  const port = parseInt(process.env.PORT || '80', 10);

  const server = http.createServer(async function (req, res) {
    const url = new URL(req.url || '/', 'http://localhost');

    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      req.on('data', function (c) {
        if (chunks.length < 1024 * 1024) chunks.push(c);
      });
      req.on('end', async function () {
        const bodyText = Buffer.concat(chunks).toString('utf8');
        const result = handleApi(req.method, url.pathname, bodyText, req.headers);

        // 处理异步 OAuth token 交换
        if (result._asyncOAuth) {
          try {
            const oauthResult = await exchangeOAuthToken(result.body.provider, result.body.code);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(oauthResult));
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '服务器内部错误' }));
          }
          return;
        }

        // HTML 响应（OAuth 回调页面）
        if (result._isHtml) {
          res.writeHead(result.status, { 'Content-Type': result.headers['Content-Type'] || 'text/html; charset=utf-8' });
          res.end(result.body);
          return;
        }

        // 重定向
        if (result.status === 302 && result.headers.Location) {
          res.writeHead(302, { Location: result.headers.Location });
          res.end();
          return;
        }

        // 普通 JSON 响应
        const respHeaders = Object.assign(
          { 'Content-Type': 'application/json; charset=utf-8' },
          result.headers || {}
        );
        res.writeHead(result.status, respHeaders);
        res.end(JSON.stringify(result.body));
      });
      return;
    }

    // 静态托管
    let filePath = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    let stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
    if (stat && stat.isDirectory()) filePath = path.join(filePath, 'index.html');
    if (!filePath || !fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
    };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });

  server.listen(port, function () {
    console.log('FreeCoder 应用已启动：http://localhost:' + port);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { handleApi, exchangeOAuthToken };
