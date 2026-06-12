const router = require('express').Router();
const { textClient } = require('../clients');

router.post('/', async (req, res) => {
  const { sourceContent, platform, product } = req.body;
  // sourceContent: { title, content, type, insights }
  // product: { name, audience, feature, tone }

  if (!product?.name) return res.status(400).json({ ok: false, error: '缺少产品名称' });

  const src = sourceContent || {};
  const prod = product;

  const comments = Array.isArray(src.comments) ? src.comments.filter(c => c && c.content).slice(0, 8) : [];

  try {
    const prompt = `你是一位专业的爆款内容改写专家。

【灵感原款分析】
标题/钩子：${src.title || '用户手动输入的内容'}
内容摘要：${(src.content || '').slice(0, 400)}
内容类型：${src.type === 'video' ? '短视频' : '图文笔记'}
${comments.length ? `
【原款评论区真实用户声音（按点赞排序）】
${comments.map((c, i) => `${i + 1}. ${String(c.content).slice(0, 80)}${c.likes ? `（赞${c.likes}）` : ''}`).join('\n')}
请从评论中提炼真实痛点、purchase intent 和用户原话用语，自然融入改写文案。` : ''}

【目标产品】
产品名称：${prod.name}
目标人群：${prod.audience || '都市女性'}
核心卖点：${prod.feature || ''}
品牌风格：${prod.tone || ''}

【目标平台】${platform || '小红书'}

任务：
1. 提取原款的创作框架（钩子类型、情绪弧线、CTA策略）
2. 用目标产品重新创作，保留框架但内容完全原创
3. 生成3个不同角度的版本

严格按以下 JSON 格式输出，不要加任何额外说明：
{
  "framework": {
    "hookType": "钩子类型描述",
    "emotionArc": "情绪弧线描述",
    "platformLogic": "平台核心逻辑",
    "ctaStrategy": "CTA策略"
  },
  "versions": [
    {
      "angle": "情感共鸣型",
      "title": "标题",
      "content": "正文（换行用\\n）",
      "tags": "#话题标签",
      "tip": "发布建议",
      "score": 78
    },
    {
      "angle": "干货攻略型",
      "title": "标题",
      "content": "正文",
      "tags": "#话题标签",
      "tip": "发布建议",
      "score": 82
    },
    {
      "angle": "故事叙事型",
      "title": "标题",
      "content": "正文",
      "tags": "#话题标签",
      "tip": "发布建议",
      "score": 75
    }
  ]
}`;

    const completion = await textClient.chat.completions.create({
      model: process.env.TEXT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 3000,
      temperature: 0.9,
    });

    const raw = completion.choices[0].message.content.trim();
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const data = JSON.parse(cleaned);

    res.json({ ok: true, data });
  } catch (err) {
    console.error('[generate-samestyle]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
