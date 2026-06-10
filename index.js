require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── 路由 ──────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ ok: true, mode: 'real', ts: Date.now() });
});

app.use('/api/generate-copy',    require('./routes/generateCopy'));
app.use('/api/generate-samestyle', require('./routes/generateSameStyle'));
app.use('/api/diagnose-prescore',  require('./routes/diagnosePrescore'));
app.use('/api/diagnose',           require('./routes/diagnose'));
app.use('/api/image',              require('./routes/image'));
app.use('/api/parse-link',         require('./routes/parseLink'));

// 统一错误处理
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ ok: false, error: err.message });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Hit Engine 后端运行在 http://localhost:${PORT}`);
  console.log(`   文案模型: ${process.env.TEXT_MODEL}`);
  console.log(`   图片模型: ${process.env.IMAGE_MODEL}`);
  console.log(`   视觉模型: ${process.env.VISION_MODEL}`);
});
