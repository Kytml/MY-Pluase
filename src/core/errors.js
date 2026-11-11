/**
 * 错误归一化：把浏览器五花八门的异常统一成带 code 的 RecorderError，
 * 文案直接面向用户，说明"发生了什么 + 该怎么办"。
 */

export const ERROR_MESSAGES = Object.freeze({
  'not-supported': '当前浏览器不支持录音。请使用最新版 Chrome / Edge / Firefox，并通过 http://127.0.0.1 或 https 打开（可运行 npm start）。',
  'insecure-context': '当前页面不是安全上下文，浏览器已禁用麦克风。请通过 http://127.0.0.1 或 https 访问，不要直接双击 HTML 文件。',
  'permission-denied': '麦克风权限被拒绝。请点击地址栏左侧的锁形图标，把「麦克风」改为允许；若被系统级禁用，请在系统设置 → 隐私 → 麦克风 中开启后重试。',
  'no-device': '没有检测到麦克风设备。请确认麦克风/耳机已插好、驱动正常，并在系统声音设置中启用输入设备后重试。',
  'device-busy': '麦克风无法读取，通常被其他程序（会议软件、另一个录音页面）独占。请关闭占用程序后重试。',
  constraints: '麦克风不支持当前音频参数，请在设置中关闭音频处理选项或更换输入设备后重试。',
  aborted: '麦克风启动被中断，请检查设备连接后重试。',
  'start-failed': '录音器初始化失败。请更换浏览器，或在设置中降低音频码率后重试。',
  'pause-unsupported': '当前浏览器不支持暂停录音，可直接使用「停止并保存」。',
  'resume-failed': '恢复录音失败，请停止后重新开始。',
  'empty-recording': '没有捕获到音频数据，录音未保存。常见原因：麦克风被其他程序占用、系统输入音量为 0、录音时间过短。请检查后重试。',
  'device-lost': '麦克风已断开或权限被撤销，已自动停止并保存已录制的内容。',
  'recorder-error': '录音过程中设备出错，已自动停止并尝试保存已录制的内容。',
  'max-duration': '已达到设置的最长录音时长，已自动停止并保存。',
  'storage-quota': '浏览器存储空间不足。请先下载备份并删除部分旧录音，再继续录制。',
  'storage-unavailable': '浏览器本地数据库不可用（可能是隐私模式）。录音仅保留在当前页面，请及时点击「下载」备份。',
  'play-failed': '播放失败，可尝试下载后用系统播放器打开。',
  'decode-failed': '音频解码失败，文件可能已损坏。可尝试下载后用系统播放器打开。',
});

export class RecorderError extends Error {
  constructor(code, { cause, message } = {}) {
    super(message || ERROR_MESSAGES[code] || '发生未知错误，请重试。');
    this.name = 'RecorderError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

/** getUserMedia 异常 → RecorderError */
export function fromGetUserMediaError(err) {
  const name = (err && err.name) || '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return new RecorderError('permission-denied', { cause: err });
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return new RecorderError('no-device', { cause: err });
    case 'NotReadableError':
    case 'TrackStartError':
      return new RecorderError('device-busy', { cause: err });
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return new RecorderError('constraints', { cause: err });
    case 'AbortError':
      return new RecorderError('aborted', { cause: err });
    default:
      return new RecorderError('start-failed', {
        cause: err,
        message: `无法启动麦克风：${(err && err.message) || '未知错误'}。请检查设备连接与浏览器权限。`,
      });
  }
}

/** 存储异常 → 用户可读文案 */
export function describeStorageError(err) {
  if (err && (err.name === 'QuotaExceededError' || err.code === 22)) {
    return ERROR_MESSAGES['storage-quota'];
  }
  return `写入本地数据库失败（${(err && err.message) || '未知错误'}）。该录音目前只在当前页面有效，请立即点击「下载」备份。`;
}
