// 本地作品库：把生成结果自动下载保存到素材库目录，永不过期
const fs = require('fs');
const path = require('path');
const router = require('express').Router();

const DIR = process.env.GALLERY_DIR || path.join(__dirname, '..', 'gallery');
const INDEX = path.join(DIR, 'index.json');
fs.mkdirSync(DIR, { recursive: true });

function loadIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX, 'utf8')); } catch { return []; }
}
function writeIndex(list) {
  fs.writeFileSync(INDEX, JSON.stringify(list, null, 1));
}

// 下载 OSS 图片到本地，写入索引。失败不抛错（不阻塞生成主流程的成功返回）
async function saveRecord({ tool, prompt, ratio, engine, urls }) {
  try {
    const ts = Date.now();
    const day = new Date(ts).toISOString().slice(0, 10);
    const dayDir = path.join(DIR, day);
    fs.mkdirSync(dayDir, { recursive: true });
    const files = [];
    for (let i = 0; i < urls.length; i++) {
      try {
        const r = await fetch(urls[i], { signal: AbortSignal.timeout(120000) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const buf = Buffer.from(await r.arrayBuffer());
        const ext = (r.headers.get('content-type') || '').includes('png') ? 'png' : 'jpg';
        const name = `${ts}_${tool}_${i + 1}.${ext}`;
        fs.writeFileSync(path.join(dayDir, name), buf);
        files.push(`${day}/${name}`);
      } catch (e) { console.warn('[gallery] 单图保存失败:', e.message); }
    }
    if (!files.length) return null;
    const rec = {
      id: ts.toString(36) + Math.random().toString(36).slice(2, 6),
      ts, tool, ratio, engine,
      prompt: (prompt || '').slice(0, 600),
      files,
    };
    const list = loadIndex();
    list.unshift(rec);
    writeIndex(list.slice(0, 500));
    console.log('[gallery] 已保存', files.length, '张 →', day);
    return rec;
  } catch (e) {
    console.warn('[gallery] 保存失败:', e.message);
    return null;
  }
}

// GET /api/gallery/list —— 作品库索引（最新在前）
router.get('/list', (req, res) => {
  res.json({ ok: true, data: loadIndex() });
});

// POST /api/gallery/delete { id } —— 删除记录及文件
router.post('/delete', (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: '缺少 id' });
  const list = loadIndex();
  const idx = list.findIndex(r => r.id === id);
  if (idx < 0) return res.status(404).json({ ok: false, error: '记录不存在' });
  const [rec] = list.splice(idx, 1);
  for (const f of rec.files || []) {
    try { fs.unlinkSync(path.join(DIR, f)); } catch {}
  }
  writeIndex(list);
  res.json({ ok: true });
});

module.exports = { saveRecord, router, DIR };
