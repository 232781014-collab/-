$base = "D:\桌面\hit-engine-backend"
$routes = "$base\server\routes"

# generateCopy.js
$generateCopy = @'
const router = require("express").Router();
const { textClient } = require("../clients");
const STYLE = {
  "小红书": "闺蜜种草语气，第一人称，结尾用emoji，突出收藏价值，话题标签放末尾",
  "抖音":   "前3秒强钩子，快节奏，强视觉感，结尾引导评论",
  "视频号": "朋友圈熟人感，情感共鸣，引导私信",
  "公众号": "深度种草，标题决定打开率，引导关注",
  "微博":   "简洁有力，话题借势，引发转发"
};
router.post("/", async (req, res) => {
  const { name, price, feature, angle, platforms } = req.body;
  if (!name || !feature) return res.status(400).json({ ok: false, error: "缺少产品名称或卖点" });
  const platList = Array.isArray(platforms) && platforms.length > 0 ? platforms : ["小红书"];
  try {
    const prompt = "你是专业电商内容创作者。为以下产品生成多平台爆款文案。

产品：" + name + "
价格：" + (price||"未提供") + "
卖点：" + feature + "
角度：" + (angle||"常规种草") + "
平台：" + platList.join("、") + "

各平台风格：
" + platList.map(p=>"- "+p+"："+(STYLE[p]||"自然种草")).join("
") + "

请严格输出JSON，不加任何说明：
{
  "platforms": [
    {
      "platform": "平台名",
      "title": "标题",
      "content": "正文",
      "tags": "#话题1 #话题2",
      "tip": "发布建议"
    }
  ]
}";
    const c = await textClient.chat.completions.create({ model: process.env.TEXT_MODEL, messages: [{role:"user",content:prompt}], max_tokens: 2000, temperature: 0.85 });
    const raw = c.choices[0].message.content.trim().replace(/^```jsons*/i,"").replace(/```s*$/i,"").trim();
    res.json({ ok: true, data: JSON.parse(raw) });
  } catch(err) { console.error("[generate-copy]", err.message); res.status(500).json({ ok: false, error: err.message }); }
});
module.exports = router;
'@
Set-Content "$routes\generateCopy.js" -Encoding UTF8 -Value $generateCopy
Write-Host "generateCopy.js done" -ForegroundColor Green

# generateSameStyle.js
$generateSameStyle = @'
const router = require("express").Router();
const { textClient } = require("../clients");
router.post("/", async (req, res) => {
  const { sourceContent, platform, product } = req.body;
  if (!product?.name) return res.status(400).json({ ok: false, error: "缺少产品名称" });
  const src = sourceContent || {};
  try {
    const prompt = "你是爆款内容改写专家。

【原款】
标题：" + (src.title||"用户输入") + "
内容：" + (src.content||"").slice(0,400) + "
类型：" + (src.type==="video"?"短视频":"图文") + "

【目标产品】
名称：" + product.name + "
人群：" + (product.audience||"都市女性") + "
卖点：" + (product.feature||"") + "
风格：" + (product.tone||"") + "

目标平台：" + (platform||"小红书") + "

请提取原款框架，用目标产品重新创作3个版本。
严格输出JSON：
{
  "framework": { "hookType": "", "emotionArc": "", "platformLogic": "", "ctaStrategy": "" },
  "versions": [
    { "angle": "情感共鸣型", "title": "", "content": "", "tags": "", "tip": "", "score": 78 },
    { "angle": "干货攻略型", "title": "", "content": "", "tags": "", "tip": "", "score": 82 },
    { "angle": "故事叙事型", "title": "", "content": "", "tags": "", "tip": "", "score": 75 }
  ]
}";
    const c = await textClient.chat.completions.create({ model: process.env.TEXT_MODEL, messages: [{role:"user",content:prompt}], max_tokens: 3000, temperature: 0.9 });
    const raw = c.choices[0].message.content.trim().replace(/^```jsons*/i,"").replace(/```s*$/i,"").trim();
    res.json({ ok: true, data: JSON.parse(raw) });
  } catch(err) { console.error("[generate-samestyle]", err.message); res.status(500).json({ ok: false, error: err.message }); }
});
module.exports = router;
'@
Set-Content "$routes\generateSameStyle.js" -Encoding UTF8 -Value $generateSameStyle
Write-Host "generateSameStyle.js done" -ForegroundColor Green

Write-Host "--- Part 2 DONE ---" -ForegroundColor Cyan