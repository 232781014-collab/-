$base = "D:\桌面\hit-engine-backend"
$routes = "$base\server\routes"

# diagnosePrescore.js
$dp = @'
const router = require("express").Router();
const { textClient } = require("../clients");
router.post("/", async (req, res) => {
  const { title, content, tags, category, platform, type } = req.body;
  if (!content) return res.status(400).json({ ok: false, error: "内容不能为空" });
  try {
    const prompt = "你是社交媒体内容评分专家。对以下" + (platform||"小红书") + (type==="video"?"视频脚本":"图文") + "进行快速预评分(0-100)。

标题：" + (title||"未提供") + "
正文：" + content.slice(0,500) + "
标签：" + (tags||"未提供") + "
品类：" + (category||"dress") + "

严格输出JSON：
{
  "total_score": 65,
  "dimensions": { "title_score": 70, "visual_score": 60, "emotion_score": 65, "hashtag_score": 55, "cta_score": 60 },
  "quick_verdict": "核心问题一句话"
}";
    const c = await textClient.chat.completions.create({ model: process.env.TEXT_MODEL, messages: [{role:"user",content:prompt}], max_tokens: 400, temperature: 0.3 });
    const raw = c.choices[0].message.content.trim().replace(/^```jsons*/i,"").replace(/```s*$/i,"").trim();
    res.json({ ok: true, data: JSON.parse(raw) });
  } catch(err) { console.error("[prescore]", err.message); res.status(500).json({ ok: false, error: err.message }); }
});
module.exports = router;
'@
Set-Content "$routes\diagnosePrescore.js" -Encoding UTF8 -Value $dp
Write-Host "diagnosePrescore.js done" -ForegroundColor Green

# diagnose.js (5-agent)
$diag = @'
const router = require("express").Router();
const { textClient } = require("../clients");
router.post("/", async (req, res) => {
  const { title, content, tags, category, platform, type, preScore } = req.body;
  if (!content) return res.status(400).json({ ok: false, error: "内容不能为空" });
  try {
    const brief = "平台：" + (platform||"小红书") + " / 类型：" + (type==="video"?"视频":"图文") + "
标题：" + (title||"未提供") + "
正文：" + content.slice(0,600) + "
标签：" + (tags||"未提供") + "
品类：" + (category||"dress") + "
预分：" + (preScore||"未知");
    const prompt = "你是拥有5个专家角色的爆款诊断系统。

【待诊断内容】
" + brief + "

5位专家角色：
- 内容分析师：标题钩子、正文结构
- 视觉诊断师：封面视觉引导力
- 增长策略师：话题标签、算法逻辑
- 用户模拟器：用户视角共鸣度
- 综合裁判：整合意见，终审

每位专家给分(0-100)+3条意见，裁判给最终分+改写方案。

严格输出JSON：
{
  "agents": [
    { "key": "content", "name": "内容分析师", "round1_score": 65, "round1_points": ["优点","问题","建议"], "round2_challenge": "质疑..."},
    { "key": "visual",  "name": "视觉诊断师", "round1_score": 58, "round1_points": ["优点","问题","建议"], "round2_challenge": "质疑..."},
    { "key": "growth",  "name": "增长策略师", "round1_score": 70, "round1_points": ["优点","问题","建议"], "round2_challenge": "质疑..."},
    { "key": "user",    "name": "用户模拟器",  "round1_score": 62, "round1_points": ["感受1","感受2","感受3"], "round2_challenge": "质疑..."},
    { "key": "judge",   "name": "综合裁判",   "final_score": 64, "predicted_score": 78, "verdict": "综合结论", "priorities": [{"title":"首要改进","desc":"说明"},{"title":"次要改进","desc":"说明"},{"title":"第三改进","desc":"说明"}], "score_dimensions": {"title":65,"visual":58,"emotion":70,"hashtag":55,"cta":60}, "rewrite": {"title":"改写标题","content":"改写正文","tags":"#标签"}}
  ]
}";
    const c = await textClient.chat.completions.create({ model: process.env.TEXT_MODEL, messages: [{role:"user",content:prompt}], max_tokens: 4000, temperature: 0.7 });
    const raw = c.choices[0].message.content.trim().replace(/^```jsons*/i,"").replace(/```s*$/i,"").trim();
    res.json({ ok: true, data: JSON.parse(raw) });
  } catch(err) { console.error("[diagnose]", err.message); res.status(500).json({ ok: false, error: err.message }); }
});
module.exports = router;
'@
Set-Content "$routes\diagnose.js" -Encoding UTF8 -Value $diag
Write-Host "diagnose.js done" -ForegroundColor Green

Write-Host "--- Part 3 DONE ---" -ForegroundColor Cyan