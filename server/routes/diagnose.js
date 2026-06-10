const router = require('express').Router();
const { textClient } = require('../clients');

const AGENTS = [
  { key: 'content', name: '内容分析师', focus: '标题钩子强度、正文结构、信息密度、阅读完成率预测' },
  { key: 'visual',  name: '视觉诊断师', focus: '封面视觉引导力、图文比例、视觉冲击点、封面文案' },
  { key: 'growth',  name: '增长策略师', focus: '传播钩子、话题标签质量、发布时机、算法推流逻辑' },
  { key: 'user',    name: '用户模拟器', focus: '代入目标用户视角，分析是否产生共鸣、评论冲动、购买欲' },
  { key: 'judge',   name: '综合裁判',   focus: '综合以上四位观点，给出最终评分、优先级问题和具体改写建议' },
];

router.post('/', async (req, res) => {
  const { title, content, tags, category, platform, type, preScore } = req.body;
  if (!content) return res.status(400).json({ ok: false, error: '内容不能为空' });

  const contentBrief = `
平台：${platform || '小红书'} / 类型：${type === 'video' ? '视频' : '图文'}
标题：${title || '（未提供）'}
正文：${content.slice(0, 600)}
标签：${tags || '（未提供）'}
品类：${category || 'dress'}
初步预分：${preScore || '未知'}`.trim();

  try {
    const prompt = `你是一个拥有5个专家角色的爆款内容诊断系统，模拟真实的专家辩论过程。

【待诊断内容】
${contentBrief}

请依次以5个专家角色各自发表意见，然后综合裁判给出最终结论。

各角色职责：
${AGENTS.map(a => `- ${a.name}：专注${a.focus}`).join('\n')}

辩论规则：
- 第1轮：每位专家独立诊断，给出分数(0-100)和3条关键意见
- 第2轮：专家间互相质疑最有争议的1个点
- 第3轮：综合裁判整合所有意见，给最终评分和改写方案

严格按以下 JSON 格式输出：
{
  "agents": [
    {
      "key": "content",
      "name": "内容分析师",
      "round1_score": 65,
      "round1_points": ["优点1", "问题1", "建议1"],
      "round2_challenge": "我质疑视觉诊断师的观点：..."
    },
    {
      "key": "visual",
      "name": "视觉诊断师",
      "round1_score": 58,
      "round1_points": ["优点1", "问题1", "建议1"],
      "round2_challenge": "我质疑增长策略师的观点：..."
    },
    {
      "key": "growth",
      "name": "增长策略师",
      "round1_score": 70,
      "round1_points": ["优点1", "问题1", "建议1"],
      "round2_challenge": "我质疑用户模拟器的观点：..."
    },
    {
      "key": "user",
      "name": "用户模拟器",
      "round1_score": 62,
      "round1_points": ["作为目标用户，我会...", "最让我犹豫的是...", "如果改成...我会买"],
      "round2_challenge": "我质疑内容分析师的观点：..."
    },
    {
      "key": "judge",
      "name": "综合裁判",
      "final_score": 64,
      "predicted_score": 78,
      "verdict": "综合4位专家意见，该内容的核心问题是...",
      "priorities": [
        { "title": "首要改进", "desc": "具体说明" },
        { "title": "次要改进", "desc": "具体说明" },
        { "title": "第三改进", "desc": "具体说明" }
      ],
      "score_dimensions": {
        "title": 65,
        "visual": 58,
        "emotion": 70,
        "hashtag": 55,
        "cta": 60
      },
      "rewrite": {
        "title": "改写后的标题",
        "content": "改写后的正文（换行用\\n）",
        "tags": "#改写后的标签"
      }
    }
  ]
}`;

    const completion = await textClient.chat.completions.create({
      model: process.env.TEXT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4000,
      temperature: 0.7,
    });

    const raw = completion.choices[0].message.content.trim();
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const data = JSON.parse(cleaned);

    res.json({ ok: true, data });
  } catch (err) {
    console.error('[diagnose]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
