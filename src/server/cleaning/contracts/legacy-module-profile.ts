/**
 * LegacyModuleProfile 契约 — Phase 2A 冻结类型
 *
 * 用于描述 src/data-cleaning 目录下每个旧 .js 模块的真实导入形状与副作用。
 * 本文件同时提供 TypeScript 类型与 Zod Runtime Schema，两者必须保持一致。
 *
 * 规则：
 * - modulePath 使用仓库相对 POSIX 路径（如 `core/data-cleaner.js`）
 * - sourceHash 使用 SHA-256
 * - allowedExports 必须来自真实导出形状，不得根据文件名推断
 * - importError 必须结构化，不得保存机器绝对路径
 * - 不得把密钥或环境变量值写入报告
 * - importStrategy 使用稳定枚举
 */

import { z } from 'zod';

/**
 * 导入策略枚举。Phase 2A 审计器输出的策略建议，后续 Adapter Map 据此决定处理方式。
 *
 * - DIRECT_IMPORT: 直接 import 旧模块安全，无 import-time 副作用
 * - CREATE_REQUIRE: 使用 createRequire 惰性加载，可隔离部分副作用
 * - EXTRACT_PURE_FUNCTION: 提取纯函数逻辑重新实现，不 import 旧模块
 * - MIGRATE_INCREMENTALLY: 增量迁移，旧模块保留但不被新服务端代码引用
 * - DEPRECATE_WITH_REASON: 废弃，Phase 2 不使用
 * - BLOCKED_UNSAFE_IMPORT: 审计器无法隔离，阻塞，不得绕过
 */
export const ImportStrategy = z.enum([
  'DIRECT_IMPORT',
  'CREATE_REQUIRE',
  'EXTRACT_PURE_FUNCTION',
  'MIGRATE_INCREMENTALLY',
  'DEPRECATE_WITH_REASON',
  'BLOCKED_UNSAFE_IMPORT',
]);
export type ImportStrategy = z.infer<typeof ImportStrategy>;

/**
 * 模块格式。旧代码全部为 CommonJS，但保留枚举以备 ESM。
 */
export const ModuleFormat = z.enum(['cjs', 'esm']);
export type ModuleFormat = z.infer<typeof ModuleFormat>;

/**
 * 文件系统观测阶段。区分 import-time 与 runtime 行为。
 */
export const FsPhase = z.enum(['import', 'runtime']);
export type FsPhase = z.infer<typeof FsPhase>;

/**
 * 结构化导入错误。不得保存机器绝对路径。
 */
export const ImportErrorSchema = z.object({
  /** 失败阶段 */
  stage: z.enum(['resolve', 'require', 'evaluate']),
  /** 错误名称，如 Error、SyntaxError */
  name: z.string(),
  /** 错误码（如有），如 ENOENT、MODULE_NOT_FOUND */
  code: z.string().optional(),
  /** 已脱敏的错误消息（移除机器绝对路径、环境变量值） */
  message: z.string(),
});
export type ImportError = z.infer<typeof ImportErrorSchema>;

/**
 * 单次文件系统调用观测记录。
 */
export const FsObservationSchema = z.object({
  /** 被拦截的函数名，如 readFileSync、writeFileSync */
  fn: z.string(),
  /** 调用阶段：import-time 或 runtime */
  phase: FsPhase,
  /** 仓库相对 POSIX 路径（已脱敏，移除机器绝对路径前缀） */
  path: z.string(),
});
export type FsObservation = z.infer<typeof FsObservationSchema>;

/**
 * LegacyModuleProfile — 单个旧模块的完整审计画像。
 *
 * 必填字段（Planning 阶段冻结的 6 个）：importSafe、importStrategy、
 * transitiveSideEffects、runtimeInterop、allowedExports、sideEffectTest。
 *
 * 补充字段：modulePath、moduleFormat、exportShape、importError、
 * filesystemReads、filesystemWrites、environmentReads、globalMutations、
 * workingDirectoryDependency、sourceHash。
 */
export const LegacyModuleProfileSchema = z.object({
  /** 模块路径，仓库相对 POSIX 路径，如 `core/data-cleaner.js` */
  modulePath: z.string(),
  /** 模块格式 */
  moduleFormat: ModuleFormat,
  /** 模块源码 SHA-256 哈希 */
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  /** 真实导出键名列表（来自 module.exports 实际形状，非文件名推断） */
  exportShape: z.array(z.string()),
  /** 导入是否安全：不触发 import-time 文件 I/O、目录创建、全局缓存等副作用 */
  importSafe: z.boolean(),
  /** 导入策略建议 */
  importStrategy: ImportStrategy,
  /** 传递性副作用清单：被依赖模块的 import-time 副作用描述 */
  transitiveSideEffects: z.array(z.string()),
  /** 运行时互操作风险：CJS/ESM、默认导出形状、类型缺失等 */
  runtimeInterop: z.array(z.string()),
  /** 允许通过 Adapter 暴露的导出名单（来自真实 exportShape 子集） */
  allowedExports: z.array(z.string()),
  /** 验证副作用隔离的测试断言描述 */
  sideEffectTest: z.string(),
  /** 导入错误（若有），结构化，不含机器绝对路径 */
  importError: ImportErrorSchema.optional(),
  /** import-time 与 runtime 的文件读取观测 */
  filesystemReads: z.array(FsObservationSchema),
  /** import-time 与 runtime 的文件写入观测 */
  filesystemWrites: z.array(FsObservationSchema),
  /** 环境变量读取观测（仅记录变量名，不记录值） */
  environmentReads: z.array(z.string()),
  /** 全局变异观测（如修改 process.env、globalThis 等） */
  globalMutations: z.array(z.string()),
  /** 是否依赖工作目录（process.cwd） */
  workingDirectoryDependency: z.boolean(),
});
export type LegacyModuleProfile = z.infer<typeof LegacyModuleProfileSchema>;

/**
 * 审计汇总信息。
 */
export const AuditSummarySchema = z.object({
  discovered_module_count: z.number().int(),
  profiled_module_count: z.number().int(),
  excluded_module_count: z.number().int(),
  safe_module_count: z.number().int(),
  unsafe_module_count: z.number().int(),
  import_failed_count: z.number().int(),
  cjs_module_count: z.number().int(),
  esm_module_count: z.number().int(),
  /** 必须为空数组，否则验收不通过 */
  unprofiled_modules: z.array(z.string()),
});
export type AuditSummary = z.infer<typeof AuditSummarySchema>;

/**
 * 被排除模块的记录，必须显式列出，不得静默排除。
 */
export const ExcludedModuleSchema = z.object({
  modulePath: z.string(),
  /** 稳定 reason code */
  reason: z.string(),
});
export type ExcludedModule = z.infer<typeof ExcludedModuleSchema>;

/**
 * 完整审计报告。
 */
export const AuditReportSchema = z.object({
  /** 报告元数据（动态部分，可跨运行变化） */
  metadata: z.object({
    generated_at: z.string(),
    duration_ms: z.number(),
    baseline_commit: z.string(),
    audit_tool_version: z.string(),
  }),
  /** 稳定汇总 */
  summary: AuditSummarySchema,
  /** 被排除模块清单 */
  excluded: z.array(ExcludedModuleSchema),
  /** 各模块 Profile，按 modulePath 排序 */
  profiles: z.array(LegacyModuleProfileSchema),
});
export type AuditReport = z.infer<typeof AuditReportSchema>;
