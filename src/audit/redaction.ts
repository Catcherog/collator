// redaction.ts
// WORKSTREAM-D (Task D5): 审计 details 的 PII 最小化与脱敏。
//
// 复用 src/server/security/redaction.ts 中的 phone 脱敏逻辑（与 write-log 仓库
// 通过 FeishuApiError 落地的脱敏约定一致），并在其上叠加「按 key 整值丢弃」策略。
//
// 不变量（AC-D04）：审计日志绝不可持久化以下内容——
//   - 完整原始图片（base64）
//   - 原始飞书 token / app_secret / 任意密钥
//   - 客户完整聊天内容（details 应由调用方保持 PII 最小化）
//   - 未脱敏手机号
//
// 策略：
//   - key 命中敏感子串（secret/token/password/appSecret/image/base64，大小写不敏感）
//     → 整值替换为 '[REDACTED]'（保留 key 存在性以供审计可见，但不泄露原值）。
//   - 任意字符串值 → 经过 redactPhone，确保嵌入的手机号被掩码（defense-in-depth）。
//   - 嵌套对象/数组递归处理，返回全新拷贝（不修改入参）。

import { redactPhone } from '../server/security/redaction.js';

/**
 * 命中即「整值丢弃」的敏感 key 子串（小写匹配）。
 * `app_secret` 小写后为 `app_secret`，包含 `secret` 与 `appsecret`，故被覆盖。
 * `appSecret` 小写后为 `appsecret`，被 `appsecret` 覆盖。
 */
const STRIP_KEY_PATTERNS = ['secret', 'token', 'password', 'appsecret', 'image', 'base64'];

/**
 * 命中即「手机号掩码」的 key 子串（小写匹配）。仅影响语义标记，
 * 实际上所有字符串值都会经过 redactPhone，此标记保留以备未来按 key 调整策略。
 */
const PHONE_KEY_PATTERNS = ['phone', 'mobile', '联系方式', 'contact'];

function shouldStripKey(key: string): boolean {
  const lower = key.toLowerCase();
  return STRIP_KEY_PATTERNS.some((p) => lower.includes(p));
}

function isPhoneKey(key: string): boolean {
  const lower = key.toLowerCase();
  return PHONE_KEY_PATTERNS.some((p) => lower.includes(p));
}

function redactString(value: string, phoneContext: boolean): string {
  // 无论是否处于 phone 上下文，都先做 redactPhone，确保任何字符串中嵌入的
  // 11 位手机号被掩码（defense-in-depth）。phoneContext 参数保留以便未来
  // 对非 phone 字段放宽策略，当前恒为掩码。
  void phoneContext;
  return redactPhone(value);
}

function redactValue(value: unknown, phoneContext: boolean): unknown {
  if (typeof value === 'string') {
    return redactString(value, phoneContext);
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, phoneContext));
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      if (shouldStripKey(key)) {
        // 整值丢弃：保留 key 存在性以供审计可见，但不持久化原值。
        out[key] = '[REDACTED]';
        continue;
      }
      const childPhone = phoneContext || isPhoneKey(key);
      out[key] = redactValue(source[key], childPhone);
    }
    return out;
  }
  // number / boolean / null / undefined 等原语原样返回。
  return value;
}

/**
 * 对审计 details 执行 PII 最小化与脱敏，返回全新拷贝（不修改入参）。
 *
 * - 命中敏感 key 的值被替换为 '[REDACTED]'。
 * - 所有字符串值经过 redactPhone，嵌入的手机号被掩码。
 * - `undefined` 入参返回 `undefined`（details 为可选字段）。
 *
 * 该函数在 AuditLogRepository.record() 的持久化边界调用，确保任何适配器
 * 落盘的内容都满足 AC-D04。
 */
export function redactDetails(
  details: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (details === undefined) return undefined;
  const redacted = redactValue(details, false);
  if (redacted === null || typeof redacted !== 'object') {
    // redactValue 对非对象根返回原值；details 契约为对象，此处兜底。
    return {};
  }
  return redacted as Record<string, unknown>;
}
