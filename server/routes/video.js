const router = require('express').Router();
const { redfox } = require('../redfox');

// ── RedFoxHub 豆包 Seedance 2.0 视频生成 ───────────
// 提交: POST /story/api/parseWork/videoGen/submit → data.taskId（约 14.3 积分/次）
// 查询: POST /story/api/parseWork/videoGen/result → data.{status, videoUrl, failReason}
//       status: queued / running / succeeded / failed
const VIDEO_MODEL = process.env.REDFOX_VIDEO_MODEL || 'doubao-seedance-2-0-260128';
const VALID_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'];

// 构建视频 prompt：优先使用结构化字段，script 作为补充
function buildVideoPrompt({ productName, productFeature, tone, angle, script, prompt }) {
  const parts = [];
  parts.push(`时尚女装电商短视频：${productName || '女装单品'}`);
  if (productFeature) parts.push(`核心卖点：${productFeature}`);
  parts.push(`风格：${tone || 'Old Money 静奢风'}，自然光线，电影感运镜，女模特优雅展示服装上身效果与面料细节，画面高级干净`);
  if (angle) parts.push(`内容角度：${angle}`);
  const extra = (script || prompt || '').trim();
  if (extra) parts.push(`参考脚本：${extra.slice(0, 400)}`);
  return parts.join('。');
}

function mapStatus(s = '') {
  const v = String(s).toLowerCase();
  if (v === 'succeeded') return 'succeeded';
  if (v === 'failed') return 'failed';
  return 'processing'; // queued / running
}

// POST /api/generate-video —— 创建视频任务
router.post('/', async (req, res) => {
  const { ratio, duration, imageUrl } = req.body;
  const prompt = buildVideoPrompt(req.body);
  try {
    const content = [{ type: 'text', text: prompt }];
    // 可选：传入产品图作为首帧（需是公网 URL）
    if (imageUrl && /^https?:\/\//.test(imageUrl)) {
      content.push({ type: 'image_url', imageUrl, imageRole: 'first_frame' });
    }
    const d = await redfox('/story/api/parseWork/videoGen/submit', {
      model: VIDEO_MODEL,
      content,
      resolution: '720p',
      ratio: VALID_RATIOS.includes(ratio) ? ratio : '9:16',
      duration: parseInt(duration, 10) || 5,
      watermark: false,
      generateAudio: true,
    });
    const taskId = d?.taskId || d?.task_id || (typeof d === 'string' ? d : null);
    if (!taskId) throw new Error('未拿到任务 ID: ' + JSON.stringify(d).slice(0, 150));
    console.log('[video] redfox task created:', taskId);
    res.json({ ok: true, data: { taskId, status: 'processing', prompt } });
  } catch (err) {
    console.error('[video create]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/video/task —— 查询任务状态
router.post('/task', async (req, res) => {
  const { taskId } = req.body;
  if (!taskId) return res.status(400).json({ ok: false, error: '缺少 taskId' });
  try {
    const d = await redfox('/story/api/parseWork/videoGen/result', { taskId });
    const status = mapStatus(d?.status);
    res.json({
      ok: true,
      data: {
        taskId,
        status,
        url: d?.videoUrl || null,
        duration: d?.duration,
        error: status === 'failed' ? (d?.failReason || '生成失败') : undefined,
      },
    });
  } catch (err) {
    console.error('[video query]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
