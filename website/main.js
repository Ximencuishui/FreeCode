/* ============================================================
   FreeCoder 官网宣传页 · 交互脚本（纯原生，无依赖）
   ============================================================ */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 导航：滚动阴影 + 移动端菜单 ---------- */
  var nav = document.querySelector('.nav');
  var navToggle = document.getElementById('navToggle');
  var navLinks = document.querySelector('.nav-links');

  function onScroll() {
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 8);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  if (navToggle && navLinks) {
    navToggle.addEventListener('click', function () {
      var open = navLinks.classList.toggle('open');
      navToggle.classList.toggle('open', open);
      navToggle.setAttribute('aria-expanded', String(open));
      navToggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
    });
    navLinks.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        navLinks.classList.remove('open');
        navToggle.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ---------- 滚动显现动画 ---------- */
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduceMotion) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('visible'); });
  }

  /* ---------- Hero 聊天演示（打字机循环） ---------- */
  var slot = document.getElementById('typingSlot');
  if (slot && !reduceMotion) {
    var demo = [
      { user: '再加一个体重趋势图吧', ai: '好的，已为您加入体重趋势图表 ⚡' },
      { user: '颜色换成清新一点的', ai: '已完成！现在预览里可以看到新的配色方案' },
      { user: '导出部署包，我要上线', ai: '正在打包… 源码 + Docker 配置 + 部署指引 ✅' }
    ];
    var i = 0;

    function renderTypingDots() {
      slot.className = 'msg ai typing-slot';
      slot.innerHTML = '<span class="typing-dots"><i></i><i></i><i></i></span>';
    }

    function typeText(text, done) {
      var idx = 0;
      slot.className = 'msg ai typing-slot';
      slot.textContent = '';
      var timer = setInterval(function () {
        idx += 1;
        slot.textContent = text.slice(0, idx);
        if (idx >= text.length) {
          clearInterval(timer);
          done();
        }
      }, 28);
    }

    function nextTurn() {
      var turn = demo[i % demo.length];
      i += 1;

      /* 用户消息 */
      var userMsg = document.createElement('div');
      userMsg.className = 'msg user';
      userMsg.textContent = turn.user;
      slot.parentNode.insertBefore(userMsg, slot);
      userMsg.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

      setTimeout(function () {
        renderTypingDots();
        setTimeout(function () {
          typeText(turn.ai, function () {
            setTimeout(nextTurn, 3200);
          });
        }, 1100);
      }, 700);
    }

    setTimeout(nextTurn, 2400);
  }
})();
