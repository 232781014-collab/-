const router = require('express').Router();
const { textClient } = require('../clients');

const PLATFORM_STYLE = {
  小红书: '闺蜜种草语气，第一人称真实感，结尾用emoji，突出收藏价值，话题标签放末尾',
  抖音:   '前3秒必须有钩子/悬念，快节奏，强视觉感，结尾引导评论区互动',
  视频号: '朋友圈熟人感，触发转发欲，情感共鸣，引导私信或主页',
  公众号: '深度种草，标题决定打开率，结构化正文，文末引导关注',
  微博:   '话题借势，简洁有力，引发转发讨论，配合热搜词',
};

router.post('/', async (req, res) => {
  const { name, price, feature, angle, platforms } = req.body;
  if (!name || !feature) return res.status(400).json({ ok: false, error: '缺少产品名称或卖点' });

  const platList = Array.isArray(platforms) && platforms.length > 0
    ? platforms
    : ['小红书'];

  try {
    const prompt = `你是一位专业的电商内容创作者。请为以下产品生成多平台爆款文案。

产品信息：
- 名称：${name}
- 价格：${price || '未提供'}
- 核心卖点：${feature}
- 营销角度：${angle || '常规种草'}

需要生成的平台：${platList.join('、')}

各平台风格要求：
${platList.map(p => `- ${p}：${PLATFORM_STYLE[p] || '自然真实的种草风格'}`).join('\n')}

请严格按以下 JSON 格式输出，不要加任何额外说明：
{
  "platforms": [
    {
      "platform": "平台名",
      "title": "标题（吸引眼球，含钩子）",
      "content": "正文（符合平台调性，换行用\\n）",
      "tags": "#话题1 #话题2 #话题3",
      "tip": "发布建议（时间/技巧）"
    }
  ]
}`;

    const completion = await textClient.chat.completions.create({
      model: process.env.TEXT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
      temperature: 0.85,
    });

    const raw = completion.choices[0].message.content.trim();
    // 去掉可能的 markdown 代码块包裹
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const data = JSON.parse(cleaned);

    res.json({ ok: true, data });
  } catch (err) {
    console.error('[generate-copy]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
