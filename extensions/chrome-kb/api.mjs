export class ApiError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}
export function normalizeServer(input) {
  let url;
  try { url = new URL(String(input).trim()); } catch { throw new ApiError('SERVER_INVALID', '请输入完整的 NAS 地址，例如 http://你的NAS:8765'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new ApiError('SERVER_INVALID', '使用不含账号、查询参数或片段的 HTTP / HTTPS 地址');
  return url.href.replace(/\/+$/, '');
}
export function permissionOrigin(input) { const u = new URL(normalizeServer(input)); return `${u.protocol}//${u.hostname}/*`; }
export function validateTask(input) {
  const title = String(input.title ?? '').trim();
  if (!title || title.length > 300) throw new ApiError('TITLE_INVALID', '待办标题须为 1–300 个字符');
  const due = String(input.due ?? '').trim();
  if (due) {
    const date = new Date(`${due}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(+date) || date.toISOString().slice(0, 10) !== due)
      throw new ApiError('DATE_INVALID', '请选择有效的截止日期');
  }
  const tags = [...new Set((Array.isArray(input.tags) ? input.tags : String(input.tags ?? '').split(/[,，]/)).map(x => String(x).trim()).filter(Boolean))];
  if (tags.length > 32 || tags.some(x => x.length > 64)) throw new ApiError('TAGS_INVALID', '最多 32 个标签，每个不超过 64 个字符');
  const status = input.status ?? 'todo';
  if (!['todo', 'doing', 'done', 'cancelled'].includes(status)) throw new ApiError('STATUS_INVALID', '待办状态无效');
  return {title, due: due || null, tags, status};
}
export function taskChanges(original, input) {
  const next = validateTask(input), changes = {};
  for (const key of ['title', 'due', 'tags', 'status']) {
    const old = key === 'due' ? original.due || null : key === 'tags' ? original.tags || [] : original[key];
    if (JSON.stringify(old) !== JSON.stringify(next[key])) changes[key] = next[key];
  }
  // Completion has its own explicit user action. Editing other fields must not complete a task.
  if (changes.status === 'done') throw new ApiError('COMPLETION_REQUIRED', '请通过列表中的完成按钮完成待办');
  return changes;
}
export function createClient(config, fetcher = fetch) {
  const base = normalizeServer(config.server);
  return async (path, {method = 'GET', body} = {}) => {
    const write = method !== 'GET';
    try {
      const response = await fetcher(base + path, {
        method, headers: {'Authorization': `Bearer ${config.token}`, ...(body ? {'Content-Type': 'application/json'} : {})},
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
        credentials: 'omit', cache: 'no-store', redirect: 'error',
      });
      let value;
      try { value = await response.json(); } catch { throw new ApiError('RESPONSE_INVALID', '服务返回了无法识别的数据', {writeUncertain: write}); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('RESPONSE_INVALID', '服务返回了无法识别的数据', {writeUncertain: write});
      if (!response.ok || value.ok === false) {
        const code = value.error?.code || `HTTP_${response.status}`;
        const messages = {UNAUTHORIZED: '令牌无效，请在连接设置中重新填写用户令牌', USER_ACTION_REQUIRED: '需要用户令牌才能执行此操作', FILE_CHANGED: '待办已在别处更新，请核对最新内容', SCHEMA_INVALID: '待办字段未通过服务端校验', LOCK_TIMEOUT: '服务正忙，请刷新核对后再操作'};
        throw new ApiError(code, write && response.status >= 500 ? '服务未确认保存结果。请刷新核对，不要重复提交。' : messages[code] || `服务请求失败（${response.status}），请检查连接或 NAS 日志`, {httpStatus: response.status, writeUncertain: write && response.status >= 500});
      }
      if (value.ok !== true) throw new ApiError('RESPONSE_INVALID', '服务返回了无法识别的数据', {writeUncertain: write});
      return value;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('NETWORK_ERROR', write ? '无法确认是否已保存。请恢复连接并刷新核对，不要重复提交。' : '暂时无法连接 NAS，请检查网络、服务地址和浏览器访问权限', {writeUncertain: write});
    }
  };
}
export const errorValue = error => ({code: error.code || 'UNEXPECTED_ERROR', message: error.message || '操作未完成', writeUncertain: Boolean(error.writeUncertain), ...(Number.isInteger(error.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599 ? {httpStatus:error.httpStatus} : {}), ...(['title','url','groupId','name','server','token','due','tags','status'].includes(error.field) ? {field:error.field} : {})});
