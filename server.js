const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPO; // owner/repo
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;

app.use(cors({ origin: ALLOWED_ORIGIN ? ALLOWED_ORIGIN.split(',').map(x => x.trim()) : true }));
app.use(express.json({ limit: '3mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const iconCache = new Map();
setInterval(() => { for (const [id, item] of iconCache) if (Date.now() - item.created > 30 * 60 * 1000) iconCache.delete(id); }, 10 * 60 * 1000);

function ghHeaders() {
  return { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'WebToAPK-Builder' };
}
function cleanConfig(b = {}) {
  const s = (v, fallback = '') => typeof v === 'string' ? v : v == null ? fallback : String(v);
  const c = {};
  c.name = s(b.name, 'My App').replace(/[\x00-\x1f<>&"'\\%@?]/g, '').trim().slice(0, 30) || 'My App';
  c.pkg = s(b.pkg).trim();
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,4}$/.test(c.pkg)) throw new Error('Invalid package name (e.g. com.example.app)');
  c.url = s(b.url).trim();
  if (!/^https?:\/\/[^\s"'<>\\]+$/.test(c.url) || c.url.length > 2000) throw new Error('Invalid website URL');
  c.ver = s(b.ver, '1.0.0'); if (!/^[0-9A-Za-z.\-]{1,20}$/.test(c.ver)) throw new Error('Invalid version');
  c.vc = s(b.vc, '1'); if (!/^\d{1,10}$/.test(c.vc) || +c.vc < 1 || +c.vc > 2100000000) throw new Error('Invalid version code');
  c.color = s(b.color, '#7c5cff'); if (!/^#[0-9a-fA-F]{6}$/.test(c.color)) throw new Error('Invalid color');
  const enums = { ori: ['auto','portrait','landscape'], splash: ['fade','zoom','slide-up','pulse'], ua: ['default','desktop'], sdk: ['21','24','26','29'] };
  for (const k in enums) { c[k] = s(b[k], k === 'sdk' ? '26' : enums[k][0]); if (!enums[k].includes(c[k])) throw new Error(`Invalid ${k}`); }
  c.feed = s(b.feed).trim(); if (c.feed && (!/^https?:\/\/[^\s"'<>\\]+$/.test(c.feed) || c.feed.length > 2000)) throw new Error('Invalid feed URL');
  for (const f of ['fs','ptr','off','js','dl','cam','push','ext','ss','aab']) c[f] = b[f] === true;
  return c;
}
function storeIcon(dataUri, id) {
  if (!dataUri) return '';
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUri);
  if (!m) throw new Error('Icon must be PNG, JPEG or WebP');
  const buf = Buffer.from(m[2], 'base64'); if (buf.length > 1.5 * 1024 * 1024) throw new Error('Icon is too large (max 1.5MB)');
  const valid = buf.slice(0,4).equals(Buffer.from([0x89,0x50,0x4e,0x47])) || buf.slice(0,3).equals(Buffer.from([0xff,0xd8,0xff])) || (buf.slice(0,4).toString()==='RIFF' && buf.slice(8,12).toString()==='WEBP');
  if (!valid) throw new Error('Invalid image data');
  if (!PUBLIC_URL) return '';
  iconCache.set(id, { buf, mime: m[1] === 'jpeg' ? 'image/jpeg' : `image/${m[1]}`, created: Date.now() });
  return `${PUBLIC_URL}/icons/${id}`;
}
app.get('/health', (_req,res) => res.status(200).send('ok'));
app.get('/icons/:id', (req,res) => { const item = iconCache.get(req.params.id); if (!item) return res.sendStatus(404); res.type(item.mime).send(item.buf); });
app.post('/api/build', rateLimit({ windowMs: 60*60*1000, limit: 10, standardHeaders: true, legacyHeaders: false }), async (req,res) => {
  if (!TOKEN || !REPO) return res.status(503).json({ error: 'Server is not configured: set GITHUB_TOKEN and GITHUB_REPO.' });
  try {
    const config = cleanConfig(req.body || {}); const id = crypto.randomBytes(6).toString('hex'); const iconUrl = storeIcon(req.body?.icon, id);
    const response = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/build.yml/dispatches`, { method:'POST', headers:{ ...ghHeaders(), 'Content-Type':'application/json' }, body:JSON.stringify({ ref:BRANCH, inputs:{ id, config:JSON.stringify(config), icon_url:iconUrl } }) });
    if (response.status !== 204) { const details = await response.text(); console.error('GitHub dispatch:', response.status, details); return res.status(502).json({ error:'GitHub could not start the build. Check token permissions and workflow file.', details }); }
    res.json({ id });
  } catch (e) { res.status(400).json({ error:e.message }); }
});
app.get('/api/status/:id', rateLimit({ windowMs:60*1000, limit:60, standardHeaders:true, legacyHeaders:false }), async (req,res) => {
  if (!TOKEN || !REPO) return res.status(503).json({ error:'Server not configured' });
  const id = req.params.id; if (!/^[a-f0-9]{12}$/.test(id)) return res.status(400).json({ error:'Invalid build ID' });
  try {
    const release = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/build-${id}`, { headers:ghHeaders() });
    if (release.ok) { const data = await release.json(); const asset = (data.assets || []).find(a => a.name.endsWith('.apk')); if (asset) return res.json({ status:'done', downloadUrl:asset.browser_download_url, fileName:asset.name }); }
    const runsResponse = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/build.yml/runs?event=workflow_dispatch&per_page=30`, { headers:ghHeaders() });
    if (!runsResponse.ok) return res.json({ status:'queued' });
    const runs = await runsResponse.json(); const run = (runs.workflow_runs || []).find(r => r.display_title === `build ${id}` || r.name === `build ${id}`);
    if (!run) return res.json({ status:'queued' });
    if (run.status === 'completed') return res.json({ status:run.conclusion === 'success' ? 'building' : 'failed' });
    res.json({ status:run.status === 'in_progress' ? 'building' : 'queued' });
  } catch (e) { console.error(e); res.status(500).json({ error:'Status check failed' }); }
});
app.listen(PORT, () => console.log(`WebToAPK server listening on ${PORT}`));
