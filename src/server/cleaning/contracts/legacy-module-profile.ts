import { z } from 'zod';

// LegacyModuleProfile 运行时 Schema 与 TypeScript 类型。
// 用于描述 src/data-cleaning 下每个旧模块的副作用、互操作风险、
// 允许导出的白名单，以及通过 CommonJS Loader 读取的固定静态依赖。

export const StaticLoaderDependencySchema = z.object({
  // 依赖模块的仓库相对 POSIX 路径，如 'schemas/customer.json'
  modulePath: z.string(),
  // 是否位于允许的 src/data-cleaning 范围内
  withinAllowedRange: z.boolean(),
  // 是否为只读访问
  readOnly: z.boolean(),
  // 是否为确定性内容（固定文件、无环境/时间依赖）
  deterministic: z.boolean(),
});

export type StaticLoaderDependency = z.infer<typeof StaticLoaderDependencySchema>;

export const LegacyModuleProfileSchema = z.object({
  // 模块路径，如 'core/data-cleaner.js'
  module: z.string(),
  // 仓库相对 POSIX modulePath
  modulePath: z.string(),
  // 模块导入是否安全（无不允许的 import-time 副作用）
  importSafe: z.boolean(),
  // 导入策略
  importStrategy: z.enum(['CREATE_REQUIRE', 'BLOCKED_UNSAFE_IMPORT', 'BLOCKED', 'NONE']),
  // 传递性副作用清单
  transitiveSideEffects: z.array(z.string()),
  // 运行时互操作风险
  runtimeInterop: z.array(z.string()),
  // 允许通过 Adapter 暴露的导出名单
  allowedExports: z.array(z.string()),
  // 验证副作用隔离的测试断言描述
  sideEffectTest: z.string(),
  // 处理方式
  handling: z.enum(['REUSE', 'WRAP', 'EXTRACT_PURE_FUNCTION', 'MIGRATE_INCREMENTALLY', 'DEPRECATE_WITH_REASON']),
  // 废弃原因（仅 DEPRECATE_WITH_REASON 时必填）
  deprecateReason: z.string().optional(),
  // 是否修改输入
  mutatesInput: z.boolean().default(false),
  // CommonJS Loader 读取的固定静态依赖
  staticLoaderDependencies: z.array(StaticLoaderDependencySchema).default([]),
  // 模块源码 Hash（运行时可选校验）
  sourceHash: z.string().optional(),
  // 审计备注
  notes: z.string().optional(),
});

export type LegacyModuleProfile = z.infer<typeof LegacyModuleProfileSchema>;

export const LegacyModuleProfileArraySchema = z.array(LegacyModuleProfileSchema);

export function validateLegacyModuleProfile(profile: unknown): LegacyModuleProfile {
  return LegacyModuleProfileSchema.parse(profile);
}

export function validateLegacyModuleProfiles(profiles: unknown[]): LegacyModuleProfile[] {
  return LegacyModuleProfileArraySchema.parse(profiles);
}
