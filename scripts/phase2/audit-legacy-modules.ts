/**
 * audit-legacy-modules.ts — Phase 2A Legacy 模块隔离审计器
 *
 * 对 src/data-cleaning 目录下每个 .js 模块在独立子进程中探测：
 * - CJS module.exports 真实形状
 * - import-time 直接与间接副作用（fs 读写、env 读取、全局变异）
 * - runtime 行为
 *
 * 输出：
 *   reports/phase2/legacy-module-profiles.json
 *   reports/phase2/legacy-module-profiles.md
 *
 * 用法：
 *   npx tsx scripts/phase2/audit-legacy-modules.ts
 *   npm run audit:legacy
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  AuditReportSchema,
  type AuditReport,
  type LegacyModuleProfile,
  type ImportStrategy,
  type FsObservation,
} from '../../src/server/cleaning/contracts/legacy-module-profile.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');
export const REPO_ROOT = resolve(__dirname, '..', '..');
export const LEGACY_ROOT = join(REPO_ROOT, 'src', 'data-cleaning');
export const WORKER_PATH = join(__dirname, 'audit-worker.cjs');
export const OBSERVER_PATH = join(REPO_ROOT, 'tests', 'unit', 'cleaning', 'fixtures', 'fs-observer.cjs');
export const REPORTS_DIR = join(REPO_ROOT, 'reports', 'phase2');
export const AUDIT_TOOL_VERSION = 'phase2a-1.0.0';
const MODULE_TIMEOUT_MS = 15_000;

// ---- 模块发现 ----

export function walkDir(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, acc);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      acc.push(full);
    }
  }
  return acc;
}

export function toRepoRelativePosix(absPath: string): string {
  const rel = relative(REPO_ROOT, absPath).split(sep).join('/');
  return rel;
}

export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

// ---- 子进程探测 ----

export interface WorkerResult {
  exportShape: string[];
  exportEntries: Array<{ name: string; type: string }>;
  importError: { stage: 'resolve' | 'require' | 'evaluate'; name: string; code?: string; message: string } | null;
  filesystemReads: FsObservation[];
  filesystemWrites: FsObservation[];
  environmentReads: string[];
  globalMutations: string[];
  workingDirectoryDependency: boolean;
  envProxyInstalled: boolean;
}

export function probeModule(absPath: string): WorkerResult {
  const tempDir = mkdtempSync(join(tmpdir(), 'phase2a-audit-'));
  try {
    const args = [
      WORKER_PATH,
      `--target=${absPath}`,
      `--observer=${OBSERVER_PATH}`,
      `--repoRoot=${REPO_ROOT}`,
    ];
    const stdout = execFileSync('node', args, {
      cwd: tempDir,
      timeout: MODULE_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return JSON.parse(stdout) as WorkerResult;
  } catch (err) {
    // 子进程失败或超时
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    const partial = e.stdout ? tryParse(e.stdout) : null;
    if (partial) return partial;
    return {
      exportShape: [],
      exportEntries: [],
      importError: {
        stage: 'evaluate',
        name: e.name || 'Error',
        code: e.code,
        message: `子进程失败/超时: ${sanitizeMessage(e.message || String(e))}`,
      },
      filesystemReads: [],
      filesystemWrites: [],
      environmentReads: [],
      globalMutations: [],
      workingDirectoryDependency: false,
      envProxyInstalled: false,
    };
  } finally {
    // 清理临时目录
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // 忽略清理失败
    }
  }
}

function tryParse(s: string): WorkerResult | null {
  try {
    return JSON.parse(s) as WorkerResult;
  } catch {
    return null;
  }
}

function sanitizeMessage(msg: string): string {
  return msg.split(REPO_ROOT).join('<repo>');
}

// ---- Profile 构建 ----

function importTimeReads(r: WorkerResult): FsObservation[] {
  return r.filesystemReads.filter((x) => x.phase === 'import');
}

function importTimeWrites(r: WorkerResult): FsObservation[] {
  return r.filesystemWrites.filter((x) => x.phase === 'import');
}

export function determineImportSafe(r: WorkerResult): boolean {
  if (r.importError) return false;
  if (importTimeReads(r).length > 0) return false;
  if (importTimeWrites(r).length > 0) return false;
  if (r.globalMutations.length > 0) return false;
  return true;
}

export function suggestImportStrategy(importSafe: boolean, r: WorkerResult): ImportStrategy {
  if (r.importError) return 'BLOCKED_UNSAFE_IMPORT';
  if (importSafe) return 'CREATE_REQUIRE';
  const hasWrites = importTimeWrites(r).length > 0;
  const hasFunctionExports = r.exportEntries.some((e) => e.type === 'function');
  if (hasWrites) return 'MIGRATE_INCREMENTALLY';
  if (hasFunctionExports) return 'EXTRACT_PURE_FUNCTION';
  return 'MIGRATE_INCREMENTALLY';
}

function buildTransitiveSideEffects(r: WorkerResult): string[] {
  const effects: string[] = [];
  for (const read of importTimeReads(r)) {
    effects.push(`import-time ${read.fn} -> ${read.path}`);
  }
  for (const write of importTimeWrites(r)) {
    effects.push(`import-time ${write.fn} -> ${write.path}`);
  }
  for (const g of r.globalMutations) {
    effects.push(`import-time global mutation: ${g}`);
  }
  return effects;
}

function buildRuntimeInterop(r: WorkerResult): string[] {
  const risks: string[] = ['CJS module.exports, ESM 需 createRequire 互操作', '无 TypeScript 类型声明'];
  if (r.exportEntries.length === 0 && !r.importError) {
    risks.push('module.exports 为空对象或无导出');
  }
  if (r.exportEntries.some((e) => e.type === 'object')) {
    risks.push('存在对象类型导出, 互操作需注意引用语义');
  }
  return risks;
}

function buildAllowedExports(importSafe: boolean, r: WorkerResult): string[] {
  if (!importSafe) return [];
  return [...r.exportShape];
}

function buildSideEffectTest(importSafe: boolean, r: WorkerResult, modulePath: string): string {
  if (importSafe) {
    return `导入 ${modulePath} 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象`;
  }
  const parts: string[] = [];
  if (importTimeReads(r).length > 0) {
    parts.push(`断言 import-time 读取被识别 (${importTimeReads(r).length} 次)`);
  }
  if (importTimeWrites(r).length > 0) {
    parts.push(`断言 import-time 写入被识别 (${importTimeWrites(r).length} 次)`);
  }
  if (r.globalMutations.length > 0) {
    parts.push(`断言全局变异被识别 (${r.globalMutations.length} 项)`);
  }
  if (r.importError) {
    parts.push(`断言导入失败仍生成合法 Profile (${r.importError.name})`);
  }
  return parts.join('; ');
}

export function buildProfile(absPath: string, r: WorkerResult): LegacyModuleProfile {
  const source = readFileSync(absPath, 'utf8');
  const modulePath = toRepoRelativePosix(absPath);
  const importSafe = determineImportSafe(r);
  return {
    modulePath,
    moduleFormat: 'cjs',
    sourceHash: sha256(source),
    exportShape: r.exportShape,
    importSafe,
    importStrategy: suggestImportStrategy(importSafe, r),
    transitiveSideEffects: buildTransitiveSideEffects(r),
    runtimeInterop: buildRuntimeInterop(r),
    allowedExports: buildAllowedExports(importSafe, r),
    sideEffectTest: buildSideEffectTest(importSafe, r, modulePath),
    importError: r.importError ?? undefined,
    filesystemReads: r.filesystemReads,
    filesystemWrites: r.filesystemWrites,
    environmentReads: r.environmentReads,
    globalMutations: r.globalMutations,
    workingDirectoryDependency: r.workingDirectoryDependency,
  };
}

// ---- 报告生成 ----

export function buildSummary(profiles: LegacyModuleProfile[], excludedCount: number) {
  const discovered = profiles.length + excludedCount;
  const safe = profiles.filter((p) => p.importSafe).length;
  const unsafe = profiles.filter((p) => !p.importSafe).length;
  const failed = profiles.filter((p) => p.importError).length;
  const cjs = profiles.filter((p) => p.moduleFormat === 'cjs').length;
  const esm = profiles.filter((p) => p.moduleFormat === 'esm').length;
  return {
    discovered_module_count: discovered,
    profiled_module_count: profiles.length,
    excluded_module_count: excludedCount,
    safe_module_count: safe,
    unsafe_module_count: unsafe,
    import_failed_count: failed,
    cjs_module_count: cjs,
    esm_module_count: esm,
    unprofiled_modules: [],
  };
}

function renderMarkdown(report: AuditReport): string {
  const lines: string[] = [];
  lines.push('# Phase 2A Legacy Module Profiles');
  lines.push('');
  lines.push(`> 生成时间: ${report.metadata.generated_at}`);
  lines.push(`> 基线 Commit: ${report.metadata.baseline_commit}`);
  lines.push(`> 审计工具版本: ${report.metadata.audit_tool_version}`);
  lines.push(`> 耗时: ${report.metadata.duration_ms} ms`);
  lines.push('');

  lines.push('## 一、汇总');
  lines.push('');
  const s = report.summary;
  lines.push('| 指标 | 值 |');
  lines.push('|------|-----|');
  lines.push(`| discovered_module_count | ${s.discovered_module_count} |`);
  lines.push(`| profiled_module_count | ${s.profiled_module_count} |`);
  lines.push(`| excluded_module_count | ${s.excluded_module_count} |`);
  lines.push(`| safe_module_count | ${s.safe_module_count} |`);
  lines.push(`| unsafe_module_count | ${s.unsafe_module_count} |`);
  lines.push(`| import_failed_count | ${s.import_failed_count} |`);
  lines.push(`| cjs_module_count | ${s.cjs_module_count} |`);
  lines.push(`| esm_module_count | ${s.esm_module_count} |`);
  lines.push(`| unprofiled_modules | ${s.unprofiled_modules.length === 0 ? '[] (空)' : s.unprofiled_modules.join(', ')} |`);
  lines.push('');
  lines.push(`**校验**: profiled + excluded = ${s.profiled_module_count + s.excluded_module_count} = discovered ${s.discovered_module_count}`);
  lines.push('');

  if (report.excluded.length > 0) {
    lines.push('## 二、排除模块');
    lines.push('');
    lines.push('| 模块路径 | 原因 |');
    lines.push('|----------|------|');
    for (const ex of report.excluded) {
      lines.push(`| ${ex.modulePath} | ${ex.reason} |`);
    }
    lines.push('');
  }

  lines.push('## 三、模块 Profile 详情');
  lines.push('');
  for (const p of report.profiles) {
    lines.push(`### ${p.modulePath}`);
    lines.push('');
    lines.push(`- **moduleFormat**: ${p.moduleFormat}`);
    lines.push(`- **sourceHash**: \`${p.sourceHash}\``);
    lines.push(`- **importSafe**: ${p.importSafe}`);
    lines.push(`- **importStrategy**: \`${p.importStrategy}\``);
    lines.push(`- **exportShape**: ${p.exportShape.length > 0 ? p.exportShape.map((e) => `\`${e}\``).join(', ') : '(空)'}`);
    lines.push(`- **allowedExports**: ${p.allowedExports.length > 0 ? p.allowedExports.map((e) => `\`${e}\``).join(', ') : '(空 — 需提取纯函数)'}`);
    lines.push(`- **workingDirectoryDependency**: ${p.workingDirectoryDependency}`);
    if (p.importError) {
      lines.push(`- **importError**: stage=${p.importError.stage}, name=${p.importError.name}${p.importError.code ? `, code=${p.importError.code}` : ''}, message=${p.importError.message}`);
    }
    if (p.filesystemReads.length > 0) {
      lines.push(`- **filesystemReads** (${p.filesystemReads.length}):`);
      for (const r of p.filesystemReads) {
        lines.push(`  - [${r.phase}] ${r.fn} -> ${r.path}`);
      }
    } else {
      lines.push(`- **filesystemReads**: (无)`);
    }
    if (p.filesystemWrites.length > 0) {
      lines.push(`- **filesystemWrites** (${p.filesystemWrites.length}):`);
      for (const w of p.filesystemWrites) {
        lines.push(`  - [${w.phase}] ${w.fn} -> ${w.path}`);
      }
    } else {
      lines.push(`- **filesystemWrites**: (无)`);
    }
    if (p.environmentReads.length > 0) {
      lines.push(`- **environmentReads**: ${p.environmentReads.map((e) => `\`${e}\``).join(', ')}`);
    } else {
      lines.push(`- **environmentReads**: (无)`);
    }
    if (p.globalMutations.length > 0) {
      lines.push(`- **globalMutations**: ${p.globalMutations.map((g) => `\`${g}\``).join(', ')}`);
    } else {
      lines.push(`- **globalMutations**: (无)`);
    }
    if (p.transitiveSideEffects.length > 0) {
      lines.push(`- **transitiveSideEffects**:`);
      for (const t of p.transitiveSideEffects) {
        lines.push(`  - ${t}`);
      }
    } else {
      lines.push(`- **transitiveSideEffects**: (无)`);
    }
    if (p.runtimeInterop.length > 0) {
      lines.push(`- **runtimeInterop**:`);
      for (const ri of p.runtimeInterop) {
        lines.push(`  - ${ri}`);
      }
    }
    lines.push(`- **sideEffectTest**: ${p.sideEffectTest}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ---- 主流程 ----

function main() {
  const startTime = Date.now();

  // 确保报告目录存在
  if (!existsSync(REPORTS_DIR)) {
    mkdirSync(REPORTS_DIR, { recursive: true });
  }

  // 1. 发现模块
  const allFiles = walkDir(LEGACY_ROOT).sort();
  console.log(`[audit] discovered ${allFiles.length} .js files under ${toRepoRelativePosix(LEGACY_ROOT)}`);

  // 2. 逐模块探测
  const profiles: LegacyModuleProfile[] = [];
  for (const absPath of allFiles) {
    const modulePath = toRepoRelativePosix(absPath);
    process.stdout.write(`[audit] profiling ${modulePath} ... `);
    const result = probeModule(absPath);
    const profile = buildProfile(absPath, result);
    profiles.push(profile);
    console.log(`${profile.importSafe ? 'SAFE' : 'UNSAFE'} (${profile.importStrategy}, exports=${profile.exportShape.length}, reads=${profile.filesystemReads.length}, writes=${profile.filesystemWrites.length})`);
  }

  // 3. 排序
  profiles.sort((a, b) => a.modulePath.localeCompare(b.modulePath));

  // 4. 汇总
  const summary = buildSummary(profiles, 0);

  // 5. 构建报告
  const report: AuditReport = {
    metadata: {
      generated_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      baseline_commit: getBaselineCommit(),
      audit_tool_version: AUDIT_TOOL_VERSION,
    },
    summary,
    excluded: [],
    profiles,
  };

  // 6. Zod 校验
  const parsed = AuditReportSchema.safeParse(report);
  if (!parsed.success) {
    console.error('[audit] Zod 校验失败:', JSON.stringify(parsed.error.issues, null, 2));
    process.exit(1);
  }

  // 7. 写文件
  const jsonPath = join(REPORTS_DIR, 'legacy-module-profiles.json');
  const mdPath = join(REPORTS_DIR, 'legacy-module-profiles.md');
  writeFileSync(jsonPath, JSON.stringify(parsed.data, null, 2) + '\n', 'utf8');
  writeFileSync(mdPath, renderMarkdown(parsed.data), 'utf8');

  console.log('');
  console.log(`[audit] DONE in ${report.metadata.duration_ms} ms`);
  console.log(`[audit] JSON: ${toRepoRelativePosix(jsonPath)}`);
  console.log(`[audit] MD:   ${toRepoRelativePosix(mdPath)}`);
  console.log(`[audit] summary: discovered=${summary.discovered_module_count}, profiled=${summary.profiled_module_count}, safe=${summary.safe_module_count}, unsafe=${summary.unsafe_module_count}, failed=${summary.import_failed_count}`);
}

function getBaselineCommit(): string {
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' });
    return out.trim();
  } catch {
    return 'unknown';
  }
}

// 仅在直接执行时运行主流程（测试 import 时不会触发）
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
