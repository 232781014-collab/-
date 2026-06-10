const router = require('express').Router();
const { redfox, redfoxGet } = require('../redfox');

// ── 爆款雷达：RedFox 数据接口 ──────────────────────
// 1) 小红书七日爆款榜  GET /story/api/cozeSkill/getXhsCozeSkillDataSeven
// 2) 小红书关键词搜索  POST /story/api/xhsUser/searchArticle（0.6 积分/次）
// 3) 全网热点榜单      POST /story/api/hotKeyword/list

const XHS_CATEGORIES = [
  '综合全部', '时尚穿搭', '潮流鞋包', '化妆美容', '个人护理', '居家装修',
  '美味佳肴', '旅行度假', '休闲爱好', '影视娱乐', '数码科技', '医疗保健',
  '星座情感', '婚庆婚礼', '拍摄记录', '学习教育', '亲子育儿', '职业发展',
  '宠物天地', '日常生活', '科学探索', '新闻资讯', '体育锻炼', '出行代步', '综合杂项',
];

const fmtDate = (d) => d.toISOString().slice(0, 10);

// GET /api/radar/categories —— 可用分类（免费，前端初始化用）
router.get('/categories', (req, res) => {
  res.json({ ok: true, data: XHS_CATEGORIES });
});

// POST /api/radar/hot —— 小红书七日爆款榜
router.post('/hot', async (req, res) => {
  const { category, rankDate } = req.body || {};
  const cat = XHS_CATEGORIES.includes(category) ? category : '时尚穿搭';
  // 榜单按天出，默认取昨天；当天数据可能未生成，逐日往前最多回退 3 天
  const dates = [];
  if (rankDate) dates.push(rankDate);
  else for (let i = 1; i <= 3; i++) { const d = new Date(); d.setDate(d.getDate() - i); dates.push(fmtDate(d)); }

  let lastErr = null;
  for (const date of dates) {
    try {
      const data = await redfoxGet('/story/api/cozeSkill/getXhsCozeSkillDataSeven', {
        rankDate: date,
        source: '小红书七日数据爆款文章-HitEngine',
        category: cat,
      });
      const list = Array.isArray(data) ? data : (data?.list || data?.articles || data?.records || []);
      if (list.length > 0) {
        return res.json({ ok: true, data: { category: cat, rankDate: date, list } });
      }
      lastErr = new Error(`${date} 无数据`);
    } catch (err) { lastErr = err; }
  }
  res.status(500).json({ ok: false, error: lastErr?.message || '未获取到榜单数据' });
});

// POST /api/radar/search —— 小红书关键词搜索热门作品
router.post('/search', async (req, res) => {
  const { keyword, offset, sortType } = req.body || {};
  if (!keyword || !keyword.trim()) return res.status(400).json({ ok: false, error: '缺少关键词' });
  try {
    const data = await redfox('/story/api/xhsUser/searchArticle', {
      keyword: keyword.trim(),
      offset: parseInt(offset, 10) || 0,
      sortType: sortType || 'default',
    });
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[radar search]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/radar/trending —— 全网聚合热点（默认最近 1 小时实时榜）
router.post('/trending', async (req, res) => {
  const { startDate, endDate } = req.body || {};
  const pad = (s) => (s && s.length === 10 ? s + ' 00:00:00' : s);
  const body = { source: '全平台热搜推荐-HitEngine' };
  if (startDate) body.startDate = pad(startDate);
  if (endDate) body.endDate = pad(endDate);
  if (!body.startDate && !body.endDate) {
    const now = new Date(), ago = new Date(now - 3600e3);
    const fmt = (d) => `${fmtDate(d)} ${String(d.getHours()).padStart(2, '0')}:00:00`;
    body.startDate = fmt(ago);
    body.endDate = fmt(now);
  }
  try {
    const data = await redfox('/story/api/hotKeyword/list', body);
    res.json({ ok: true, data });
  } catch (err) {
    console.error('[radar trending]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
