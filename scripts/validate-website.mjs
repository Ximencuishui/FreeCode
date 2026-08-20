/**
 * 宣传页校验脚本：HTML 标签平衡 + JSON-LD 可解析 + 关键资源存在
 * 用法: node scripts/validate-website.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'website');
const read = (f) => readFileSync(join(root, f), 'utf8');

let fail = 0;
const ok = (msg) => console.log('  ✅ ' + msg);
const bad = (msg) => { console.log('  ❌ ' + msg); fail++; };

/* 1. HTML 标签平衡 */
const html = read('index.html');
const clean = html.replace(/<!--[\s\S]*?-->/g, '');
const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
const voidOk = new Set(['br','img','input','hr','meta','link','path','rect','circle','line','polyline','use','stop','source','area','base','col','embed','param','track','wbr']);
const st = [];
let m;
let badTags = [];
while ((m = re.exec(clean))) {
  const t = m[1].toLowerCase();
  if (m[0][1] === '/') {
    if (st.length && st[st.length - 1] === t) st.pop();
    else badTags.push(t);
  } else if (!voidOk.has(t) && !m[0].endsWith('/>')) {
    st.push(t);
  }
}
if (badTags.length === 0 && st.length === 0) ok('HTML 标签全部平衡');
else { bad(`HTML 不平衡: 多余闭合=${badTags.join(',')} 未闭合=${st.join(',')}`); }

/* 2. JSON-LD 解析 */
const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
if (ld.length === 0) bad('未找到 JSON-LD');
ld.forEach((x, i) => {
  try {
    const j = JSON.parse(x[1]);
    ok(`JSON-LD #${i + 1} @type=${[].concat(j['@type']).join(',')}`);
    if (j['@type'] === 'FAQPage' && (!j.mainEntity || j.mainEntity.length < 2)) bad('FAQPage 问题数过少');
  } catch (e) { bad(`JSON-LD #${i + 1} 解析失败: ${e.message}`); }
});

/* 3. 关键资源存在 */
['styles.css', 'main.js', 'robots.txt', 'sitemap.xml', 'llms.txt', 'og-image.png', 'vercel.json'].forEach((f) => {
  if (existsSync(join(root, f))) ok(`资源存在: ${f}`);
  else bad(`资源缺失: ${f}`);
});

/* 4. robots.txt 指向 sitemap */
const robots = read('robots.txt');
if (/Sitemap:\s*\S+sitemap\.xml/.test(robots)) ok('robots.txt 包含 Sitemap 声明');
else bad('robots.txt 缺少 Sitemap 声明');

/* 5. sitemap 中的 URL 与 canonical 一致 */
const sitemap = read('sitemap.xml');
const canonical = (html.match(/rel="canonical" href="([^"]+)"/) || [])[1];
if (canonical && sitemap.includes(canonical)) ok(`sitemap 与 canonical 一致 (${canonical})`);
else bad(`sitemap 与 canonical 不一致: canonical=${canonical}`);

/* 6. 页面可见 FAQ 与 FAQPage JSON-LD 数量一致 */
const visibleFaq = (html.match(/<details class="faq-item/g) || []).length;
const faqLd = ld.map((x) => JSON.parse(x[1])).find((j) => j['@type'] === 'FAQPage');
if (faqLd) {
  if (visibleFaq === faqLd.mainEntity.length) ok(`可见 FAQ(${visibleFaq}) 与 FAQPage schema(${faqLd.mainEntity.length}) 数量一致`);
  else bad(`FAQ 数量不一致: 页面=${visibleFaq} schema=${faqLd.mainEntity.length}`);
}

console.log(fail ? `\n✗ ${fail} 项未通过` : '\n✓ 全部通过');
process.exit(fail ? 1 : 0);
