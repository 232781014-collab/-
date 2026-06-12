const router = require('express').Router();
const { textClient } = require('../clients');
const { redfox } = require('../redfox');

// 平台检测
function detectPlatform(url = '') {
  if (/xiaohongshu\.com|xhslink/i.test(url)) return '小红书';
  if (/douyin\.com|iesdouyin/i.test(url)) return '抖音';
  if (/channels\.weixin|weixin\.qq/i.test(url)) return '视频号';
  if (/weibo\.com/i.test(url)) return '微博';
  return null;
}

// RedFox 平台代码 → 中文名
const PLATFORM_NAMES = { xhsw: '小红书', xhs: '小红书', xiaohongshu: '小红书', dy: '抖音', douyin: '抖音', gzh: '公众号', sph: '视频号', wb: '微博', weibo: '微博' };

// 用文本模型提取创作框架（失败不影响主流程）
async function analyzeInsights({ platform, type, title, desc, note }) {
  try {
    const completion = await textClient.chat.completions.create({
      model: process.env.TEXT_MODEL,
      messages: [{ role: 'user', content: `分析这条${platform}${type === 'video' ? '视频' : '图文'}内容的创作手法。
标题：${title || '（无）'}
正文：${(desc || '').slice(0, 800) || '（无）'}
用户补充：${note || '无'}

严格按 JSON 输出：
{"tags":["标签1","标签2"],"hookType":"钩子类型","emotionArc":"情绪弧线描述","coreFramework":"一句话总结创作框架"}` }],
      max_tokens: 350,
      temperature: 0.2,
    });
    const raw = completion.choices[0].message.content.trim();
    return JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim());
  } catch (e) {
    console.warn('[parse-link insights]', e.message);
    return {};
  }
}

router.post('/', async (req, res) => {
  const { url, pastedContent, note, deep } = req.body;

  // 模式1：用户粘贴了内容文本（推荐路径）
  if (pastedContent && pastedContent.trim().length > 10) {
    try {
      const prompt = `请分析以下社交媒体内容，提取结构化信息。

内容：
${pastedContent.slice(0, 1000)}

用户补充说明：${note || '无'}

请严格按以下 JSON 格式输出：
{
  "platform": "推测的平台（小红书/抖音/视频号/微博/其他）",
  "type": "image 或 video",
  "title": "内容标题或前20字",
  "description": "内容摘要（100字以内）",
  "tags": ["标签1", "标签2"],
  "hookType": "钩子类型（情感共鸣/反差冲突/干货攻略/故事叙事等）",
  "emotionArc": "情绪弧线描述",
  "coreFramework": "内容核心框架（一句话总结创作逻辑）",
  "imageCount": 0
}`;

      const completion = await textClient.chat.completions.create({
        model: process.env.TEXT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.2,
      });

      const raw = completion.choices[0].message.content.trim();
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
      const data = JSON.parse(cleaned);

      return res.json({
        ok: true,
        source: 'pasted_content',
        ...data,
        finalUrl: url || '',
      });
    } catch (err) {
      console.error('[parse-link pasted]', err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  // 模式2：仅有 URL —— RedFox 真实解析
  // 基础：parse（图片/视频/封面/标题，0.6积分）
  // 深度（deep=true）：再并行查作品详情拿正文全文+互动数据（再 0.6积分，支持小红书/抖音）
  if (url && process.env.REDFOX_API_KEY) {
    try {
      const isXhs = /xiaohongshu\.com|xhslink/i.test(url);
      const isDy = /douyin\.com|iesdouyin/i.test(url);
      let detailTask = Promise.resolve(null);
      if (deep && isXhs) {
        detailTask = redfox('/story/api/xhsUser/queryWorkDetail', { workLink: url })
          .catch(e => { console.warn('[parse-link xhs detail]', e.message); return null; });
      } else if (deep && isDy) {
        detailTask = redfox('/story/api/dyData/queryWork', { workUrl: url })
          .catch(e => { console.warn('[parse-link dy detail]', e.message); return null; });
      }
      const [d, detail] = await Promise.all([
        redfox('/story/api/parseWork/parse', { url }),
        detailTask,
      ]);

      const platform = PLATFORM_NAMES[String(d.platform || '').toLowerCase()] || detectPlatform(url) || d.platform || '其他';
      const type = d.videoUrl || detail?.workType === 'video' ? 'video' : 'image';
      const imageUrls = Array.isArray(d.imageUrls) ? d.imageUrls : [];
      const title = detail?.workTitle || detail?.title || d.title || note || '已解析内容';
      const desc = detail?.workDesc || detail?.content || '';
      const stats = detail ? {
        likes: detail.workLikedCount ?? detail.likeCount ?? null,
        collects: detail.workCollectedCount ?? detail.collectCount ?? null,
        comments: detail.workCommentsCount ?? detail.commentCount ?? null,
        reads: detail.workReadedCount ?? detail.playCount ?? null,
      } : null;

      const insights = (title || desc) ? await analyzeInsights({ platform, type, title, desc, note }) : {};

      return res.json({
        ok: true,
        source: detail ? 'redfox_deep' : 'redfox_parse',
        platform,
        type,
        title,
        description: desc || title,
        content: desc,
        stats,
        tags: insights.tags || [],
        hookType: insights.hookType || '',
        emotionArc: insights.emotionArc || '',
        coreFramework: insights.coreFramework || '',
        imageCount: imageUrls.length,
        cover: d.cover || null,
        previewImage: d.cover || imageUrls[0] || '',
        images: imageUrls,
        imageUrls,
        videoUrl: d.videoUrl || null,
        finalUrl: url,
      });
    } catch (err) {
      console.warn('[parse-link redfox]', err.message, '→ 回退到提示模式');
    }
  }

  // 模式2b：RedFox 不可用时的兜底（让用户手动粘贴）
  if (url) {
    const platform = detectPlatform(url);
    if (!platform) {
      return res.status(400).json({ ok: false, error: '暂不支持该平台链接，请粘贴内容文本使用' });
    }

    return res.json({
      ok: true,
      source: 'url_only',
      platform,
      type: ['抖音', '视频号'].includes(platform) ? 'video' : 'image',
      title: note || `来自 ${platform} 的内容`,
      description: `已识别 ${platform} 链接。由于平台限制，无法自动抓取内容。建议将帖子文案复制粘贴到「手动输入」模式获得更好的分析效果。`,
      tags: [],
      finalUrl: url,
      imageCount: 0,
      needManualInput: true,
    });
  }

  return res.status(400).json({ ok: false, error: '请提供链接或粘贴内容' });
});

module.exports = router;
