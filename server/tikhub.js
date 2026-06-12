// TikHub.io API 客户端（Bearer 鉴权，按次计费）
const TIKHUB_BASE = (process.env.TIKHUB_BASE || 'https://api.tikhub.io').replace(/\/$/, '');

async function tikhub(path, query) {
  if (!process.env.TIKHUB_API_KEY) throw new Error('未配置 TIKHUB_API_KEY');
  let url = TIKHUB_BASE + path;
  if (query) url += '?' + new URLSearchParams(query).toString();
  const r = await fetch(url, {
    headers: { Authorization: 'Bearer ' + process.env.TIKHUB_API_KEY },
    signal: AbortSignal.timeout(60000),
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error('TikHub 返回非 JSON: ' + text.slice(0, 120)); }
  if (r.status === 402) throw new Error('TikHub 余额不足：该接口不接受免费额度，请前往 user.tikhub.io/users/add_credit 充值');
  if (r.status === 403) throw new Error('TikHub 权限不足：' + (json?.detail?.message_zh || 'Key 未勾选该接口范围'));
  if (!r.ok || (json.code && json.code !== 200)) {
    throw new Error(json?.detail?.message_zh || json?.message_zh || json?.message || ('TikHub HTTP ' + r.status));
  }
  return json.data;
}

module.exports = { tikhub };
