// 查詢框的輸入：Threads 帳號個人頁連結、「@帳號」或「帳號」都可以。前端送出前與後端 parseAccount 共用同一套規則。
const HOSTS = new Set(['threads.com', 'www.threads.com', 'threads.net', 'www.threads.net']);
const NAME = /^[a-zA-Z0-9_.]{1,30}$/;
export const ACCOUNT_INPUT_HELP = '請貼上 Threads 帳號連結或輸入 @帳號，例如 @username';

/** 回傳小寫帳號；不是公開 Threads 帳號時丟出可直接顯示的錯誤訊息。 */
export function accountFromInput(input) {
  if (typeof input !== 'string' || input.length > 300) throw new Error(ACCOUNT_INPUT_HELP);
  let text = input.trim();
  // 「@帳號」或只打帳號
  const handle = text.replace(/^@/, '');
  if (!text.includes('/') && NAME.test(handle)) return handle.toLowerCase();
  // 少打 https:// 的連結
  if (/^(www\.)?threads\.(com|net)\//i.test(text)) text = 'https://' + text;
  let u;
  try { u = new URL(text); } catch { throw new Error(ACCOUNT_INPUT_HELP); }
  if (u.protocol !== 'https:' || !HOSTS.has(u.hostname) || u.port || u.username || u.password) throw new Error('只接受公開 Threads 帳號連結或 @帳號');
  const m = u.pathname.match(/^\/@([a-zA-Z0-9_.]{1,30})\/?$/);
  if (!m) throw new Error('請使用帳號個人頁連結或 @帳號，例如 @username');
  return m[1].toLowerCase();
}

export const profileUrl = (username) => `https://www.threads.com/@${username}`;
