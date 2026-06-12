// RedFoxHub (redfox.hk) API 客户端
// 鉴权：请求头 X-API-Key: ak_xxx；响应格式 { code: 2000, msg, data }
const REDFOX_BASE = (process.env.REDFOX_BASE || 'https://redfox.hk').replace(/\/$/, '');

async function request(path, { method = 'POST', body, query } = {}) {
  if (!process.env.REDFOX_API_KEY) throw new Error('未配置 REDFOX_API_KEY');
  let url = REDFOX_BASE + path;
  if (query) url += '?' + new URLSearchParams(query).toString();
  const r = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': process.env.REDFOX_API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90000), // 单次请求超时保护，避免挂死
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error('RedFox 返回非 JSON: ' + text.slice(0, 150)); }
  if (json.code !== 2000) throw new Error(json.msg || ('RedFox 接口错误 code=' + json.code));
  return json.data;
}

// 兼容旧用法：redfox(path, body) 即 POST
const redfox = (path, body) => request(path, { method: 'POST', body });
const redfoxGet = (path, query) => request(path, { method: 'GET', query });

module.exports = { redfox, redfoxGet };
