// Cloudflare Pages 部署脚本（token/account/domain 全部走环境变量，不落盘）
// 用法: CF_TOKEN=xxx CF_ACCOUNT=xxx CF_DOMAIN=xxx node cf_deploy.js <zip路径>
const fs = require('fs');
const path = require('path');

const CF = 'https://api.cloudflare.com/client/v4';
const TOKEN = process.env.CF_TOKEN;
const ACCT = process.env.CF_ACCOUNT;
const DOMAIN = process.env.CF_DOMAIN || '';
const ZIP = process.argv[2];
const PROJ = 'pufferwork';

if (!TOKEN || !ACCT) { console.error('缺少 CF_TOKEN 或 CF_ACCOUNT'); process.exit(2); }
if (!fs.existsSync(ZIP)) { console.error('zip 不存在:', ZIP); process.exit(2); }

async function api(method, url, body, raw) {
  const headers = { Authorization: 'Bearer ' + TOKEN };
  if (body && !raw) headers['Content-Type'] = 'application/json';
  const res = await fetch(CF + url, { method, headers, body: body ? (raw ? body : JSON.stringify(body)) : undefined });
  const t = await res.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!res.ok && !(j && j.success)) console.error('  [API ' + method + ' ' + url + ']', res.status, JSON.stringify(j && j.errors || t).slice(0, 300));
  return { status: res.status, json: j };
}

(async () => {
  // 1) 创建 Pages 项目（已存在则跳过）
  let proj = await api('POST', `/accounts/${ACCT}/pages/projects`, { name: PROJ, production_branch: 'main' });
  if (!proj.json || !proj.json.success) {
    const g = await api('GET', `/accounts/${ACCT}/pages/projects/${PROJ}`);
    if (!g.json || !g.json.success) { console.error('无法创建/读取 Pages 项目'); process.exit(1); }
    proj = g;
  }
  console.log('PROJECT OK:', PROJ, '|', proj.json.result.subdomain);

  // 2) 上传部署（新版 direct upload：manifest=SHA256 映射 + 每个文件独立 part）
  const AdmZip = require('adm-zip');
  const crypto = require('crypto');
  const zf = new AdmZip(ZIP);
  const fd = new FormData();
  const manifest = {};
  for (const e of zf.getEntries()) {
    if (e.isDirectory) continue;
    const buf = e.getData();
    manifest[e.entryName] = crypto.createHash('sha256').update(buf).digest('hex');
    fd.append(e.entryName, new Blob([buf]));
  }
  fd.append('manifest', JSON.stringify(manifest));
  const dep = await api('POST', `/accounts/${ACCT}/pages/projects/${PROJ}/deployments`, fd, true);
  if (!dep.json || !dep.json.success) { console.error('DEPLOY FAILED', JSON.stringify(dep.json).slice(0, 300)); process.exit(1); }
  const url = dep.json.result.url || '';
  console.log('DEPLOY OK:', url);

  // 3) 创建 Zone（域名接入 Cloudflare）—— 若已存在则读取
  let zone = await api('POST', `/zones`, { name: DOMAIN, account: { id: ACCT }, type: 'full' });
  if (!zone.json || !zone.json.success) {
    const list = await api('GET', `/zones?name=${DOMAIN}`);
    if (list.json && list.json.success && list.json.result.length) zone = { json: { result: list.json.result[0] } };
    else { console.error('无法创建 Zone（域名可能已在其他账户）'); process.exit(1); }
  }
  const z = zone.json.result;
  console.log('ZONE OK:', z.name, '| id:', z.id, '| NS:', (z.name_servers || []).join(', '));

  // 4) 绑定自定义域名到 Pages 项目
  const dom = await api('POST', `/accounts/${ACCT}/pages/projects/${PROJ}/domains`, { name: DOMAIN });
  console.log('DOMAIN BIND:', dom.json && dom.json.success ? 'OK' : 'skip/fail', dom.json && dom.json.errors ? JSON.stringify(dom.json.errors).slice(0, 200) : '');

  // 5) 添加 CNAME DNS：域名 → 项目.pages.dev（橙云代理）
  const cname = await api('POST', `/zones/${z.id}/dns_records`, { type: 'CNAME', name: DOMAIN, content: PROJ + '.pages.dev', proxied: true });
  console.log('DNS CNAME:', cname.json && cname.json.success ? 'OK ' + DOMAIN + ' -> ' + PROJ + '.pages.dev' : 'fail', cname.json && cname.json.errors ? JSON.stringify(cname.json.errors).slice(0, 200) : '');

  console.log('\n===== 下一步（用户操作）=====');
  console.log('NS: ' + (z.name_servers || []).join('  /  '));
  console.log('临时预览(先测国内速度):', url);
})();
