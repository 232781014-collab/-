const router = require('express').Router();
const { textClient } = require('../clients');

// 品类权重
const CATEGORY_WEIGHTS = {
  dress:  { visual:35, title:25, emotion:25, hashtag:15 },
  top:    { title:30, visual:30, hashtag:20, emotion:20 },
  bottom: { pain:30, visual:25, title:20, hashtag:15, cta:10 },
  outer:  { season:30, visual:25, title:20, scene:25 },
  inner:  { visual:40, creative:25, title:15, hashtag:20 },
  set:    { visual:30, title:25, scene:25, emotion:20 },
};

const CATEGORY_NAMES = {
  dress:'连衣裙', top:'上衣/T恤', bottom:'裤装',
  outer:'外套', inner:'内搭', set:'套装',
};

router.post('/', async (req, res) => {
  const { title, content, tags, category, platform, type } = req.body;
  if (!content) return res.status(400).json({ ok: false, error: '内容不能为空' });

  const weights = CATEGORY_WEIGHTS[category] || CATEGORY_WEIGHTS.dress;
  const catName = CATEGORY_NAMES[category] || '连衣裙';

  try {
    const prompt = `你是一位专业的社交媒体内容评分专家，擅长分析电商种草内容的爆款潜力。

请对以下${platform || '小红书'}${type === 'video' ? '视频脚本' : '图文内容'}进行快速预评分。

【评分标准 - ${catName}品类权重】
${Object.entries(weights).map(([k,v]) => `${k}: ${v}%`).join('，')}

【待评内容】
标题：${title || '（未提供）'}
正文：${content.slice(0, 500)}
标签：${tags || '（未提供）'}

请从以下维度评分（0-100），综合加权后给出总分：
1. 标题吸引力（钩子强度、情绪触发）
2. 视觉引导力（是否能激发想象配套视觉）
3. 情绪共鸣度（痛点、渴望、代入感）
4. 话题标签质量（相关性、搜索量）
5. 行动引导力（CTA明确度）

严格按以下 JSON 格式输出：
{
  "total_score": 65,
  "category_cn": "${catName}",
  "dimensions": {
    "title_score": 70,
    "visual_score": 60,
    "emotion_score": 65,
    "hashtag_score": 55,
    "cta_score": 60
  },
  "quick_verdict": "一句话核心问题",
  "baseline": {
    "sample_size": 874
  }
}`;

    const completion = await textClient.chat.completions.create({
      model: process.env.TEXT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 600,
      temperature: 0.3,
    });

    const raw = completion.choices[0].message.content.trim();
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const data = JSON.parse(cleaned);

    res.json({ ok: true, data });
  } catch (err) {
    console.error('[diagnose-prescore]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
