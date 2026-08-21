/**
 * FreeCoder 生成 - 前端登录 SDK（配合 server.js 使用）。
 * 挂载全局对象 window.FreeCoderAuth：
 * - init()            页面加载时调用：恢复登录态 + 检查 OAuth hash token
 * - requireLogin()    需要登录后使用：未登录时自动弹出登录窗口
 * - login/register/logout
 * - isLoggedIn() / currentUser
 * - data(collection)  业务数据 SDK，支持分页/搜索/排序
 * - oauthLogin(provider) 第三方登录
 *
 * 登录窗口已内置，页面无需自己实现注册/登录表单。
 */
(function () {
  'use strict';

  var API_BASE = '/api';
  var TOKEN_KEY = 'freecoder_token';

  var token = null;
  var currentUser = null;
  var modalEl = null;
  var pendingResolver = null;
  var stateListeners = [];

  function getToken() {
    return token;
  }

  function setToken(value) {
    token = value;
    if (value) {
      localStorage.setItem(TOKEN_KEY, value);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  }

  function notify() {
    stateListeners.forEach(function (fn) {
      try {
        fn({ isLoggedIn: isLoggedIn(), user: currentUser });
      } catch (_e) { /* ignore */ }
    });
  }

  function isLoggedIn() {
    return !!currentUser;
  }

  function request(method, url, body) {
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(API_BASE + url, {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || '请求失败（' + res.status + '）');
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  /** 检查 URL hash 中是否有 OAuth 返回的 token */
  function checkOAuthHash() {
    var hash = window.location.hash.slice(1);
    if (!hash) return null;
    var params = {};
    hash.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      if (kv.length === 2) params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
    });
    if (params.token) {
      // 清除 hash
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      try {
        var user = params.user ? JSON.parse(params.user) : null;
        setToken(params.token);
        currentUser = user;
        notify();
        return user;
      } catch (_e) {
        return null;
      }
    }
    return null;
  }

  /** 恢复登录态 */
  function init() {
    // 先检查 OAuth hash
    var oauthUser = checkOAuthHash();
    if (oauthUser) return Promise.resolve(oauthUser);

    var saved = localStorage.getItem(TOKEN_KEY);
    if (!saved) return Promise.resolve(null);
    setToken(saved);
    return request('GET', '/me')
      .then(function (data) {
        currentUser = data.user;
        notify();
        return currentUser;
      })
      .catch(function () {
        setToken(null);
        currentUser = null;
        return null;
      });
  }

  function onAuthSuccess(data) {
    setToken(data.token);
    currentUser = data.user;
    closeModal();
    notify();
    if (pendingResolver) {
      var resolve = pendingResolver;
      pendingResolver = null;
      resolve(currentUser);
    }
  }

  function login(username, password) {
    return request('POST', '/login', { username: username, password: password }).then(onAuthSuccess);
  }

  function register(username, password) {
    return request('POST', '/register', { username: username, password: password }).then(onAuthSuccess);
  }

  function logout() {
    setToken(null);
    currentUser = null;
    notify();
  }

  function requireLogin() {
    if (isLoggedIn()) return Promise.resolve(currentUser);
    showModal();
    return new Promise(function (resolve) {
      pendingResolver = resolve;
    });
  }

  // ---------- OAuth 第三方登录 ----------
  function oauthLogin(provider) {
    // 打开新窗口进行 OAuth 流程
    var width = 600, height = 700;
    var left = (screen.width - width) / 2;
    var top = (screen.height - height) / 2;
    var win = window.open(
      API_BASE + '/oauth/' + provider + '/auth',
      'oauth_' + provider,
      'width=' + width + ',height=' + height + ',left=' + left + ',top=' + top + ',toolbar=no,menubar=no'
    );

    return new Promise(function (resolve, reject) {
      var timer = setInterval(function () {
        if (!win || win.closed) {
          clearInterval(timer);
          // 检查是否通过 hash 获得了 token
          init().then(function (user) {
            if (user) resolve(user);
            else reject(new Error('登录窗口已关闭'));
          });
        }
      }, 500);

      // 也监听 message 事件
      function onMessage(e) {
        if (e.data && e.data.type === 'oauth_success') {
          clearInterval(timer);
          window.removeEventListener('message', onMessage);
          onAuthSuccess(e.data);
          resolve(e.data.user);
        }
      }
      window.addEventListener('message', onMessage);
    });
  }

  // ---------- 登录弹窗 UI ----------
  function showModal() {
    if (modalEl) return;
    modalEl = document.createElement('div');
    modalEl.innerHTML =
      '<div class="fc-auth-mask">' +
      '  <div class="fc-auth-card" role="dialog" aria-label="登录">' +
      '    <button class="fc-auth-close" type="button" aria-label="关闭登录窗口">✕</button>' +
      '    <h2 class="fc-auth-title">登录 / 注册</h2>' +
      '    <div class="fc-auth-tabs">' +
      '      <button type="button" class="fc-auth-tab fc-auth-tab-active" data-fc-auth-tab="login">登录</button>' +
      '      <button type="button" class="fc-auth-tab" data-fc-auth-tab="register">注册</button>' +
      '    </div>' +
      '    <form class="fc-auth-form" autocomplete="off">' +
      '      <input class="fc-auth-input" name="username" placeholder="用户名（2-32 个字符）" maxlength="32" required>' +
      '      <input class="fc-auth-input" name="password" type="password" placeholder="密码（至少 6 位）" minlength="6" required>' +
      '      <p class="fc-auth-error" role="alert"></p>' +
      '      <button class="fc-auth-submit" type="submit">登 录</button>' +
      '    </form>' +
      '    <div class="fc-auth-divider"><span>或</span></div>' +
      '    <div class="fc-auth-oauth">' +
      '      <button type="button" class="fc-auth-oauth-btn fc-auth-oauth-github" data-provider="github">' +
      '        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.29 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>' +
      '        GitHub' +
      '      </button>' +
      '      <button type="button" class="fc-auth-oauth-btn fc-auth-oauth-google" data-provider="google">' +
      '        <svg viewBox="0 0 24 24" width="18" height="18"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>' +
      '        Google' +
      '      </button>' +
      '      <button type="button" class="fc-auth-oauth-btn fc-auth-oauth-wechat" data-provider="wechat">' +
      '        <svg viewBox="0 0 24 24" width="18" height="18" fill="#07C160"><path d="M8.69 2C4.47 2 1 4.86 1 8.39c0 2.01 1.1 3.82 2.84 5.01l-.71 2.13 2.47-1.24c.78.22 1.6.34 2.45.34.21 0 .42-.01.63-.03a5.92 5.92 0 01-.24-1.67c0-3.37 3.06-6.11 6.83-6.11.24 0 .47.01.7.04C15.28 4.14 12.27 2 8.69 2zm-2.8 3.87c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm5.6 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zM15.27 8c-3.31 0-6 2.24-6 5s2.69 5 6 5c.7 0 1.37-.12 2-.33l1.92.96-.55-1.65c1.35-.93 2.22-2.33 2.22-3.88 0-2.86-2.69-5.1-6-5.1h.41zm-2.2 2.87c.44 0 .8.36.8.8s-.36.8-.8.8-.8-.36-.8-.8.36-.8.8-.8zm4.4 0c.44 0 .8.36.8.8s-.36.8-.8.8-.8-.36-.8-.8.36-.8.8-.8z"/></svg>' +
      '        微信' +
      '      </button>' +
      '    </div>' +
      '    <p class="fc-auth-tip">无需邮箱，直接注册即可使用</p>' +
      '  </div>' +
      '</div>' +
      '<style>' +
      '.fc-auth-mask{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,.45);backdrop-filter:blur(2px)}' +
      '.fc-auth-card{position:relative;width:360px;max-width:90vw;background:#fff;border-radius:16px;padding:24px;box-shadow:0 20px 50px rgba(0,0,0,.2);font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#1a2b3c}' +
      '.fc-auth-close{position:absolute;top:12px;right:12px;border:none;background:none;font-size:14px;color:#94a3b8;cursor:pointer;padding:4px}' +
      '.fc-auth-close:hover{color:#475569}' +
      '.fc-auth-title{margin:0 0 14px;font-size:18px;font-weight:600;text-align:center}' +
      '.fc-auth-tabs{display:flex;margin-bottom:14px;border-bottom:1px solid #e2e8f0}' +
      '.fc-auth-tab{flex:1;padding:8px 0;border:none;background:none;font-size:14px;color:#64748b;cursor:pointer;border-bottom:2px solid transparent}' +
      '.fc-auth-tab-active{color:#4a90d9;border-bottom-color:#4a90d9;font-weight:600}' +
      '.fc-auth-form{display:flex;flex-direction:column;gap:10px}' +
      '.fc-auth-input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;outline:none}' +
      '.fc-auth-input:focus{border-color:#4a90d9}' +
      '.fc-auth-error{min-height:16px;margin:0;font-size:12px;color:#dc2626;display:none}' +
      '.fc-auth-submit{padding:10px 0;border:none;border-radius:8px;background:#4a90d9;color:#fff;font-size:15px;font-weight:600;cursor:pointer}' +
      '.fc-auth-submit:hover{background:#3a7bc8}' +
      '.fc-auth-submit:disabled{opacity:.6;cursor:not-allowed}' +
      '.fc-auth-divider{display:flex;align-items:center;margin:14px 0;gap:10px;color:#94a3b8;font-size:12px}' +
      '.fc-auth-divider::before,.fc-auth-divider::after{content:"";flex:1;height:1px;background:#e2e8f0}' +
      '.fc-auth-oauth{display:flex;gap:8px;justify-content:center}' +
      '.fc-auth-oauth-btn{display:flex;align-items:center;gap:6px;padding:8px 14px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;font-size:13px;color:#334155;cursor:pointer;transition:all .15s}' +
      '.fc-auth-oauth-btn:hover{background:#f8fafc;border-color:#cbd5e1}' +
      '.fc-auth-oauth-github:hover{color:#24292f;border-color:#24292f}' +
      '.fc-auth-oauth-google:hover{border-color:#4285F4}' +
      '.fc-auth-oauth-wechat:hover{color:#07C160;border-color:#07C160}' +
      '.fc-auth-tip{margin:10px 0 0;font-size:12px;color:#94a3b8;text-align:center}' +
      '</style>';

    document.body.appendChild(modalEl);

    var mask = modalEl.querySelector('.fc-auth-mask');
    var closeBtn = modalEl.querySelector('.fc-auth-close');
    var tabs = modalEl.querySelectorAll('.fc-auth-tab');
    var form = modalEl.querySelector('.fc-auth-form');
    var errorEl = modalEl.querySelector('.fc-auth-error');
    var submitBtn = modalEl.querySelector('.fc-auth-submit');
    var oauthBtns = modalEl.querySelectorAll('.fc-auth-oauth-btn');
    var mode = 'login';

    function setMode(next) {
      mode = next;
      tabs.forEach(function (t) {
        t.classList.toggle('fc-auth-tab-active', t.getAttribute('data-fc-auth-tab') === mode);
      });
      submitBtn.textContent = mode === 'login' ? '登 录' : '注 册';
      form.querySelector('input[name="password"]').placeholder =
        mode === 'login' ? '密码' : '密码（至少 6 位）';
    }

    function showError(message) {
      errorEl.textContent = message;
      errorEl.style.display = 'block';
    }

    closeBtn.addEventListener('click', function () {
      closeModal();
      if (pendingResolver) {
        var resolve = pendingResolver;
        pendingResolver = null;
        resolve(null);
      }
    });
    mask.addEventListener('click', function (e) {
      if (e.target === mask) closeBtn.click();
    });
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        errorEl.style.display = 'none';
        setMode(t.getAttribute('data-fc-auth-tab'));
      });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var username = form.querySelector('input[name="username"]').value.trim();
      var password = form.querySelector('input[name="password"]').value;
      if (!username || !password) {
        showError('请填写用户名和密码');
        return;
      }
      errorEl.style.display = 'none';
      submitBtn.disabled = true;
      var action = mode === 'login' ? login : register;
      action(username, password)
        .catch(function (err) {
          showError(err.message || '操作失败，请重试');
          submitBtn.disabled = false;
        });
    });

    // OAuth 按钮事件
    oauthBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var provider = btn.getAttribute('data-provider');
        errorEl.style.display = 'none';
        oauthLogin(provider).catch(function (err) {
          showError(err.message || '第三方登录失败');
        });
      });
    });
  }

  function closeModal() {
    if (modalEl) {
      modalEl.remove();
      modalEl = null;
    }
  }

  function onStateChange(fn) {
    stateListeners.push(fn);
    fn({ isLoggedIn: isLoggedIn(), user: currentUser });
    return function () {
      stateListeners = stateListeners.filter(function (x) { return x !== fn; });
    };
  }

  // ---------- 业务数据 SDK（支持分页/搜索/排序） ----------
  // 用法：
  //   const db = FreeCoderAuth.data('todos');
  //   const result = await db.list({ page: 1, pageSize: 20, sort: 'createdAt', order: 'desc', search: 'keyword' });
  //   // result.items → 数据数组
  //   // result.pagination → { page, pageSize, total, totalPages }
  //   const item = await db.create({ title: '...' });
  //   await db.update(id, { title: '新标题' });
  //   await db.remove(id);
  function data(collection) {
    function ensureLogin() {
      if (isLoggedIn()) return Promise.resolve(currentUser);
      return requireLogin().then(function (user) {
        if (!user) throw new Error('请先登录');
        return user;
      });
    }

    function api(method, url, body) {
      return ensureLogin().then(function () {
        return request(method, url, body);
      });
    }

    return {
      /**
       * 获取集合数据列表
       * @param {Object} [options] 可选参数
       * @param {number} [options.page] 页码（从 1 开始）
       * @param {number} [options.pageSize] 每页条数（默认全部返回，最大 100）
       * @param {string} [options.sort] 排序字段（createdAt / updatedAt / id）
       * @param {string} [options.order] 排序方向（asc / desc，默认 desc）
       * @param {string} [options.search] 搜索关键词（模糊匹配）
       * @returns {Promise<{items: Array, pagination: Object}>}
       */
      list: function (options) {
        var opts = options || {};
        var qs = [];
        if (opts.page) qs.push('page=' + opts.page);
        if (opts.pageSize) qs.push('pageSize=' + opts.pageSize);
        if (opts.sort) qs.push('sort=' + encodeURIComponent(opts.sort));
        if (opts.order) qs.push('order=' + encodeURIComponent(opts.order));
        if (opts.search) qs.push('search=' + encodeURIComponent(opts.search));
        var query = qs.length ? '?' + qs.join('&') : '';
        return api('GET', '/data/' + encodeURIComponent(collection) + query).then(function (res) {
          // 向后兼容：如果没有 pagination，包装一下
          if (res.pagination) return res;
          return { items: res.items || [], pagination: { page: 1, pageSize: (res.items || []).length, total: (res.items || []).length, totalPages: 1 } };
        });
      },
      /** 获取单条记录 */
      get: function (id) {
        return api('GET', '/data/' + encodeURIComponent(collection) + '/' + encodeURIComponent(id)).then(function (res) {
          return res.item;
        });
      },
      /** 新建一条记录 */
      create: function (data) {
        return api('POST', '/data/' + encodeURIComponent(collection), data).then(function (res) {
          return res.item;
        });
      },
      /** 更新一条记录 */
      update: function (id, data) {
        return api('PUT', '/data/' + encodeURIComponent(collection) + '/' + encodeURIComponent(id), data).then(function (res) {
          return res.item;
        });
      },
      /** 删除一条记录 */
      remove: function (id) {
        return api('DELETE', '/data/' + encodeURIComponent(collection) + '/' + encodeURIComponent(id)).then(function (res) {
          return res.ok;
        });
      },
    };
  }

  window.FreeCoderAuth = {
    init: init,
    requireLogin: requireLogin,
    login: login,
    register: register,
    logout: logout,
    isLoggedIn: isLoggedIn,
    getToken: getToken,
    onStateChange: onStateChange,
    data: data,
    oauthLogin: oauthLogin,
  };
})();
