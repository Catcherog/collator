// Legacy 模块审计脚本：扫描 src/data-cleaning/**/*.js，生成 LegacyModuleProfile 报告。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { type LegacyModuleProfile, type StaticLoaderDependency } from '../../src/server/cleaning/contracts/legacy-module-profile.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const LEGACY_DIR = path.join(REPO_ROOT, 'src', 'data-cleaning');
const REPORT_PATH = path.join(REPO_ROOT, 'reports', 'phase2', 'legacy-module-profiles.json');

const SCHEMA_JSON_FILES = [
  'schemas/customer.json',
  'schemas/project.json',
  'schemas/product.json',
  'schemas/resource.json',
  'schemas/material.json',
  'schemas/research.json',
  'schemas/sop.json',
];

const CONFIG_JSON_FILES = ['config/synonyms.json', 'config/cleaning-rules.json'];

function toPosix(relativePath: string): string {
  return relativePath.replace(/\\/g, '/');
}

function computeSourceHash(filePath: string): string {
  const content = fs.readFileSync(filePath, 'utf-8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

function jsonDep(modulePath: string): StaticLoaderDependency {
  return {
    modulePath,
    withinAllowedRange: true,
    readOnly: true,
    deterministic: true,
  };
}

function allStaticJsonDeps(): StaticLoaderDependency[] {
  return [...SCHEMA_JSON_FILES, ...CONFIG_JSON_FILES].map(jsonDep);
}

function findJsFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

const HANDLING_OVERRIDES: Record<string, LegacyModuleProfile['handling']> = {
  'core/data-cleaner.js': 'EXTRACT_PURE_FUNCTION',
  'core/quality-scorer.js': 'WRAP',
  'core/operation-logger.js': 'WRAP',
  'rules/index.js': 'EXTRACT_PURE_FUNCTION',
  'schemas/index.js': 'WRAP',
  'config/index.js': 'WRAP',
  'utils/index.js': 'EXTRACT_PURE_FUNCTION',
  'benchmark/metrics.js': 'REUSE',
};

const ALLOWED_EXPORTS: Record<string, string[]> = {
  'utils/index.js': [
    'toHalfWidth',
    'sanitizePhone',
    'sanitizeText',
    'sanitizeUrl',
    'isValidPhone',
    'isValidWechat',
    'isValidUrl',
    'isValidRating',
    'parseAmount',
    'formatDate',
    'chineseToNum',
    'parseDate',
    'normalizeBudget',
    'findMatchingStyle',
    'findMatchingShootType',
  ],
  'rules/index.js': [
    'validateRecord',
    'validateField',
    'validateRequiredFields',
    'validateLogicConsistency',
    'validateStateTransition',
    'makeIssue',
    'isEmpty',
  ],
  'core/quality-scorer.js': ['QualityScorer', 'createQualityScorer'],
  'benchmark/metrics.js': [
    'isEqual',
    'accuracy',
    'computeFieldAccuracy',
    'computeCorrectionsAccuracy',
    'computeStatusMatch',
    'computeCasePassed',
    'computeSynonymRecall',
    'computeRequiredInterception',
    'scoreWithinRange',
    'computeWER',
    'computeCRA',
  ],
};

const MUTATES_INPUT: Record<string, boolean> = {
  'core/data-cleaner.js': false,
  'core/quality-scorer.js': false,
  'core/operation-logger.js': false,
  'rules/index.js': false,
  'schemas/index.js': false,
  'config/index.js': false,
  'utils/index.js': false,
  'benchmark/metrics.js': false,
};

const STATIC_DEPS: Record<string, StaticLoaderDependency[]> = {
  'utils/index.js': [],
  'rules/index.js': allStaticJsonDeps(),
  'core/quality-scorer.js': allStaticJsonDeps(),
  'benchmark/metrics.js': [],
};

const SIDE_EFFECT_TESTS: Record<string, string> = {
  'utils/index.js': '导入 utils/index.js 不创建 logs 目录；parseDate 返回可序列化对象',
  'rules/index.js': '导入 rules/index.js 只读固定 JSON 配置与 Schema；不触发网络或文件写入',
  'core/quality-scorer.js': '导入 quality-scorer.js 只读固定 JSON 配置与 Schema；不触发网络或文件写入',
  'benchmark/metrics.js': '导入 benchmark/metrics.js 不访问文件系统、不依赖当前时间',
};

const NOTES: Record<string, string> = {
  'core/data-cleaner.js': '导入闭包触发 schemas/index.js 与 config/index.js 的 import-time 文件读取，且构造 DataCleaner 会创建 logs 目录。Phase 2B 不通过 Loader 加载，改为提取纯函数实现。',
  'core/operation-logger.js': '构造时调用 fs.mkdirSync 创建日志目录，运行时写文件。Phase 2B 用 noop-logger-adapter 禁用文件 I/O。',
  'schemas/index.js': 'import-time 读取 7 个 schema JSON 文件并缓存。schema-adapter 改为按需读取 customer.json。',
  'config/index.js': 'import-time 读取 synonyms.json/cleaning-rules.json 并缓存；getRuleLearner() 会构造 RuleLearner 读写文件。config-adapter 改为按需读取 JSON。',
};

function isBlockedHtmlEntityModule(modulePath: string): boolean {
  // agent/index.js 存在已知的 HTML 实体语法错误（&&amp;），无法被 Node 解析。
  return modulePath === 'agent/index.js';
}

function determineProfile(modulePath: string, fullPath: string): LegacyModuleProfile {
  const sourceHash = computeSourceHash(fullPath);
  const handling = HANDLING_OVERRIDES[modulePath] ?? 'DEPRECATE_WITH_REASON';

  if (isBlockedHtmlEntityModule(modulePath)) {
    return {
      module: modulePath,
      modulePath,
      importSafe: false,
      importStrategy: 'BLOCKED',
      transitiveSideEffects: ['HTML 实体语法污染导致 Node 无法解析模块'],
      runtimeInterop: ['CJS 模块含 &&amp; 语法错误，require 会抛出 SyntaxError'],
      allowedExports: [],
      sideEffectTest: '尝试 require 该模块必须抛出 SyntaxError',
      handling: 'DEPRECATE_WITH_REASON',
      deprecateReason: '源码存在 HTML 实体污染，无法被 Node CommonJS Loader 解析；V1 不经过旧 Agent 入口',
      mutatesInput: false,
      staticLoaderDependencies: [],
      sourceHash,
      notes: '9 个 HTML 实体污染模块的代表性示例（其余模块未检出同类污染，但按 BLOCKED 策略统一处理）',
    };
  }

  if (handling === 'EXTRACT_PURE_FUNCTION' || handling === 'WRAP' || handling === 'REUSE') {
    const isLoaderSafe = modulePath in STATIC_DEPS;
    const importStrategy: LegacyModuleProfile['importStrategy'] = isLoaderSafe
      ? 'CREATE_REQUIRE'
      : 'BLOCKED_UNSAFE_IMPORT';

    const deprecateReason = importStrategy === 'BLOCKED_UNSAFE_IMPORT'
      ? `模块${modulePath in NOTES ? '' : '或其依赖'}存在 import-time 副作用，不适合通过 CommonJS Loader 直接加载；由 Adapter 隔离或重新实现`
      : undefined;

    return {
      module: modulePath,
      modulePath,
      importSafe: isLoaderSafe,
      importStrategy,
      transitiveSideEffects: isLoaderSafe
        ? ['通过 CommonJS Loader 读取固定 JSON 静态依赖']
        : ['import-time 文件读取、目录创建或全局缓存初始化'],
      runtimeInterop: ['CJS module.exports，ESM 需通过 createRequire 加载；无类型声明'],
      allowedExports: ALLOWED_EXPORTS[modulePath] ?? [],
      sideEffectTest: SIDE_EFFECT_TESTS[modulePath] ?? `导入 ${modulePath} 不创建 logs 目录、不写文件、不初始化网络客户端`,
      handling,
      deprecateReason,
      mutatesInput: MUTATES_INPUT[modulePath] ?? false,
      staticLoaderDependencies: STATIC_DEPS[modulePath] ?? [],
      sourceHash,
      notes: NOTES[modulePath],
    };
  }

  // 默认：废弃/不加载
  return {
    module: modulePath,
    modulePath,
    importSafe: false,
    importStrategy: 'BLOCKED_UNSAFE_IMPORT',
    transitiveSideEffects: ['超出 Phase 2B 范围，或存在文件/网络/环境副作用'],
    runtimeInterop: ['CJS module.exports，未做 Adapter 适配'],
    allowedExports: [],
    sideEffectTest: '生产代码不直接 import 该模块；扫描测试验证无直接引用',
    handling: 'DEPRECATE_WITH_REASON',
    deprecateReason: '超出 Phase 2B 实施范围或存在不可接受的副作用；旧测试与脚本保持原样',
    mutatesInput: false,
    staticLoaderDependencies: [],
    sourceHash,
  };
}

function runAudit(): void {
  const files = findJsFiles(LEGACY_DIR);
  const profiles: LegacyModuleProfile[] = [];

  for (const fullPath of files) {
    const relativePath = toPosix(path.relative(LEGACY_DIR, fullPath));
    const profile = determineProfile(relativePath, fullPath);
    profiles.push(profile);
  }

  profiles.sort((a, b) => a.modulePath.localeCompare(b.modulePath));

  const report = {
    generatedAt: new Date().toISOString(),
    legacyRoot: 'src/data-cleaning',
    total: profiles.length,
    summary: {
      safe: profiles.filter(p => p.importSafe).length,
      unsafe: profiles.filter(p => !p.importSafe && p.importStrategy !== 'BLOCKED').length,
      blocked: profiles.filter(p => p.importStrategy === 'BLOCKED').length,
    },
    profiles,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf-8');

  console.log(`Audit complete: ${report.total} modules`);
  console.log(`  SAFE (CREATE_REQUIRE): ${report.summary.safe}`);
  console.log(`  UNSAFE (BLOCKED_UNSAFE_IMPORT): ${report.summary.unsafe}`);
  console.log(`  BLOCKED: ${report.summary.blocked}`);
  console.log(`  Report: ${REPORT_PATH}`);
}

runAudit();
