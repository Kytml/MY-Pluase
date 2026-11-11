/**
 * 用户输入校验。全部返回结构化结果而不是抛异常，便于 UI 就地展示错误。
 */

export const NAME_MAX_LENGTH = 80;
export const PREFIX_MAX_LENGTH = 20;

// 控制字符（含换行/制表符），在名称中一律剔除
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g');

/** 规范化名称：剔除控制字符、压缩连续空白、去掉首尾空白。 */
export function normalizeName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * 校验录音名称。
 * @returns {{ok:true, value:string} | {ok:false, error:string}}
 */
export function validateRecordingName(raw, { maxLength = NAME_MAX_LENGTH } = {}) {
  if (typeof raw !== 'string') return { ok: false, error: '名称必须是文本' };
  const value = normalizeName(raw);
  if (!value) return { ok: false, error: '名称不能为空' };
  if (value.length > maxLength) {
    return { ok: false, error: `名称过长，最多 ${maxLength} 个字符（当前 ${value.length} 个）` };
  }
  return { ok: true, value };
}

/** 校验录音名前缀：允许为空（回退默认"录音"），但不允许超长。 */
export function validatePrefix(raw, { maxLength = PREFIX_MAX_LENGTH } = {}) {
  if (raw === undefined || raw === null) return { ok: true, value: '录音' };
  if (typeof raw !== 'string') return { ok: false, error: '命名前缀必须是文本' };
  const value = normalizeName(raw);
  if (!value) return { ok: true, value: '录音' };
  if (value.length > maxLength) {
    return { ok: false, error: `命名前缀最多 ${maxLength} 个字符` };
  }
  return { ok: true, value };
}
