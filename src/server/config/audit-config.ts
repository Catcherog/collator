// audit-config.ts
// WORKSTREAM-D: 审计日志持久化配置。
//
// 独立于 src/server/config.ts 加载（本工作流不得修改 config.ts / Composition Root）。
// Workstream E 在 buildApp 中调用 `loadAuditConfig(process.env)` 并据此构造
// AuditLogRepository（默认 FileAuditRepository，指向 AUDIT_FILE_PATH）。
//
// 设计选择（AC-D01 / 持久化策略）：
// - 默认 `store: 'file'`：基于 JSON Lines 的文件存储。无需任何外部凭据即可工作，
//   进程重启后仍可读取（AC-D01），简单且可备份（AC-D09：复制文件即可）。
// - `store: 'feishu'`：预留位（future）。需要独立的审计表 + 飞书凭据，当前未实现，
//   loadAuditConfig 不会因此失败，但 FileAuditRepository 之外的适配器尚不存在。
//   SQLite 需要新增依赖；飞书审计表需要凭据 + 独立建表。文件存储是无需凭据即
//   可通过 AC-D01 的务实选择。

import { z } from 'zod';

/**
 * 将环境变量字符串解析为布尔值。显式处理 "false"/"0"/"no"/"off" 为 `false`，
 * 避免直接使用 `z.coerce.boolean()` 的陷阱（非空字符串 `"false"` 会被 `Boolean()`
 * 判定为真，导致 `AUDIT_FAIL_CLOSED=false` 被误解为 fail-closed，违背 AC-D03 的
 * 降级语义）。
 *
 * 返回 `undefined` 表示「未设置」，交由 schema 的 `.default()` 处理。
 */
function parseEnvBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === '') return undefined;
  if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false;
  return true;
}

const auditConfigSchema = z.object({
  /**
   * 审计存储后端。
   * - `file`（默认）：JSON Lines 文件存储，无外部凭据依赖。
   * - `feishu`：预留。未来需独立审计表 + FEISHU_* 凭据；当前未实现。
   */
  store: z.enum(['file', 'feishu']).default('file'),

  /**
   * 文件存储路径（仅 store='file' 时生效）。
   * 默认 `./data/audit.log.jsonl`。仓库根目录的 `data/` 运行时目录与
   * `uploads/` 同属运行期产物，操作员应自行纳入 .gitignore 或通过该
   * 环境变量指向受管理的持久卷。
   */
  filePath: z.string().min(1, 'AUDIT_FILE_PATH must be a non-empty path').default('./data/audit.log.jsonl'),

  /**
   * 写入失败时的重试次数（不含首次尝试）。默认 2。
   * 重试仅针对瞬时 I/O 错误（append 失败）；持久性错误仍按 failClosed 处理。
   */
  maxRetries: z.coerce.number().int().min(0).default(2),

  /**
   * 审计写入失败时的失效模式（AC-D03）。
   * - `true`（默认，fail-closed）：审计写入失败即抛错，调用方感知审计缺失，
   *   避免在无审计轨迹的情况下静默推进业务。
   * - `false`（degrade）：记录警告日志并继续，返回未持久化的（已脱敏）记录。
   *   仅在操作员显式接受审计降级时使用。
   */
  failClosed: z.boolean().default(true),
});

export type AuditConfig = z.infer<typeof auditConfigSchema>;

/**
 * 从环境变量加载审计配置。默认值见 `auditConfigSchema`。
 *
 * 读取的环境变量：
 * - `AUDIT_STORE`        → store
 * - `AUDIT_FILE_PATH`    → filePath
 * - `AUDIT_MAX_RETRIES`  → maxRetries
 * - `AUDIT_FAIL_CLOSED`  → failClosed
 *
 * 布尔值显式解析：`"false"`/`"0"`/`"no"`/`"off"` → false，其余非空 → true。
 */
export function loadAuditConfig(env: Record<string, string | undefined> = process.env): AuditConfig {
  const raw = {
    store: env.AUDIT_STORE,
    filePath: env.AUDIT_FILE_PATH,
    maxRetries: env.AUDIT_MAX_RETRIES,
    failClosed: parseEnvBool(env.AUDIT_FAIL_CLOSED),
  };
  return auditConfigSchema.parse(raw);
}
