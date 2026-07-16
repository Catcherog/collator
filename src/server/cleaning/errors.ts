// Legacy Adapter 错误标准化。
// 所有 Loader / Adapter 异常统一转换为 LegacyAdapterError，避免泄露绝对路径或环境变量。

export type LegacyAdapterErrorCode =
  | 'LEGACY_MODULE_NOT_PROFILED'
  | 'LEGACY_MODULE_UNSAFE'
  | 'LEGACY_EXPORT_NOT_ALLOWED'
  | 'LEGACY_EXPORT_SHAPE_MISMATCH'
  | 'LEGACY_INVOCATION_FAILED'
  | 'LEGACY_INVALID_RETURN'
  | 'LEGACY_SOURCE_HASH_MISMATCH';

const PUBLIC_MESSAGE: Record<LegacyAdapterErrorCode, string> = {
  LEGACY_MODULE_NOT_PROFILED: 'Legacy module is not in the audited profile',
  LEGACY_MODULE_UNSAFE: 'Legacy module is marked unsafe and cannot be loaded',
  LEGACY_EXPORT_NOT_ALLOWED: 'Requested export is not in the allowed allowlist',
  LEGACY_EXPORT_SHAPE_MISMATCH: 'Requested export has an unexpected shape',
  LEGACY_INVOCATION_FAILED: 'Legacy module invocation failed',
  LEGACY_INVALID_RETURN: 'Legacy module returned an invalid value',
  LEGACY_SOURCE_HASH_MISMATCH: 'Legacy module source hash does not match the audited profile',
};

export class LegacyAdapterError extends Error {
  readonly code: LegacyAdapterErrorCode;
  readonly modulePath: string;
  readonly exportName?: string;
  readonly cause?: unknown;

  constructor(
    code: LegacyAdapterErrorCode,
    modulePath: string,
    options: { exportName?: string; cause?: unknown } = {}
  ) {
    super(PUBLIC_MESSAGE[code]);
    this.name = 'LegacyAdapterError';
    this.code = code;
    this.modulePath = modulePath;
    this.exportName = options.exportName;
    this.cause = options.cause;
  }
}

/**
 * 清理可能包含绝对路径或环境变量的错误信息，返回仅含仓库相对路径的安全字符串。
 */
export function sanitizeErrorMessage(message: string, repoRoot: string): string {
  let sanitized = message;
  // 替换 Windows / POSIX 绝对路径为 <REPO_ROOT>/...
  const escapedRoot = repoRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  sanitized = sanitized.replace(new RegExp(escapedRoot, 'g'), '<REPO_ROOT>');
  return sanitized;
}
