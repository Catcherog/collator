import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  getLegacyModuleProfile,
  type LegacyModuleProfile,
} from './legacy-audit.js';
import { LegacyAdapterError, sanitizeErrorMessage } from './errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const LEGACY_ROOT = path.join(REPO_ROOT, 'src', 'data-cleaning');

type ExportShape = 'function' | 'class' | 'object' | 'unknown';

type LegacyModuleWrapper = (
  exports: Record<string, unknown>,
  require: (specifier: string) => unknown,
  module: { exports: Record<string, unknown> },
  __filename: string,
  __dirname: string
) => void;

interface CachedExport {
  modulePath: string;
  exportName: string;
  value: unknown;
  shape: ExportShape;
}

interface HashCacheEntry {
  modulePath: string;
  sourceHash: string;
  verifiedAt: number;
}

const exportCache = new Map<string, CachedExport>();
const hashCache = new Map<string, HashCacheEntry>();
const moduleCache = new Map<string, Record<string, unknown>>();

const NODE_BUILTINS = new Set(builtinModules);

function isNodeBuiltin(specifier: string): boolean {
  const bare = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
  return NODE_BUILTINS.has(bare);
}

function loadNodeBuiltin(specifier: string): unknown {
  const bare = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
  const mod = process.getBuiltinModule?.(bare);
  if (mod === undefined) {
    throw new Error(`无法加载 Node 内置模块：${specifier}`);
  }
  return mod;
}

function resolveLegacyRequirePath(fromDir: string, specifier: string): string {
  if (isNodeBuiltin(specifier)) {
    return specifier;
  }

  if (path.isAbsolute(specifier)) {
    if (!isWithinLegacyRoot(specifier)) {
      throw new Error(`不允许的绝对路径依赖：${specifier}`);
    }
    return specifier;
  }

  if (!specifier.startsWith('.')) {
    throw new Error(`只允许相对路径或 Node 内置模块依赖：${specifier}`);
  }

  const base = path.resolve(fromDir, specifier);
  const candidates = [base, `${base}.js`, `${base}.json`];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  // CommonJS 目录索引：config → config/index.js
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    const indexCandidates = [path.join(base, 'index.js'), path.join(base, 'index.json')];
    for (const candidate of indexCandidates) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    }
  }

  throw new Error(`无法解析 Legacy 依赖：${specifier}`);
}

function isWithinLegacyRoot(absolutePath: string): boolean {
  const relative = path.relative(LEGACY_ROOT, absolutePath);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function wrapLegacySource(absolutePath: string): LegacyModuleWrapper {
  const source = fs.readFileSync(absolutePath, 'utf-8');
  const wrapped = `(function(exports, require, module, __filename, __dirname) {\n${source}\n});`;
  return vm.runInThisContext(wrapped, { filename: absolutePath }) as LegacyModuleWrapper;
}

function createLegacyRequire(fromDir: string) {
  return function legacyRequire(specifier: string): unknown {
    const resolved = resolveLegacyRequirePath(fromDir, specifier);

    if (isNodeBuiltin(resolved)) {
      return loadNodeBuiltin(resolved);
    }

    if (resolved.endsWith('.json')) {
      const content = fs.readFileSync(resolved, 'utf-8');
      return JSON.parse(content);
    }

    return evaluateLegacyModule(resolved);
  };
}

function evaluateLegacyModule(absolutePath: string): Record<string, unknown> {
  const cached = moduleCache.get(absolutePath);
  if (cached) {
    return cached;
  }

  const dirname = path.dirname(absolutePath);
  const moduleObj: { exports: Record<string, unknown> } = { exports: {} };
  const exports = moduleObj.exports;
  const wrapper = wrapLegacySource(absolutePath);

  wrapper(exports, createLegacyRequire(dirname), moduleObj, absolutePath, dirname);

  moduleCache.set(absolutePath, moduleObj.exports);
  return moduleObj.exports;
}

function computeSourceHash(filePath: string): string {
  const content = fs.readFileSync(filePath, 'utf-8');
  return crypto.createHash('sha256').update(content).digest('hex');
}

function isPathTraversal(modulePath: string): boolean {
  const parts = modulePath.split('/');
  if (parts.some(p => p === '..' || p === '.')) return true;
  if (path.isAbsolute(modulePath)) return true;
  if (modulePath.startsWith('..')) return true;
  return false;
}

function resolveLegacyModulePath(modulePath: string): string {
  if (isPathTraversal(modulePath)) {
    throw new LegacyAdapterError('LEGACY_MODULE_NOT_PROFILED', modulePath);
  }
  const absolute = path.resolve(LEGACY_ROOT, modulePath);
  const relative = path.relative(LEGACY_ROOT, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new LegacyAdapterError('LEGACY_MODULE_NOT_PROFILED', modulePath);
  }
  return absolute;
}

function detectShape(value: unknown): ExportShape {
  if (typeof value === 'function') {
    // Legacy 类通常以大写字母开头且 prototype 非空
    if (/^[A-Z]/.test(value.name) && Object.keys(value.prototype ?? {}).length >= 0) {
      return 'class';
    }
    return 'function';
  }
  if (typeof value === 'object' && value !== null) {
    return 'object';
  }
  return 'unknown';
}

function validateExportShape(value: unknown, expectedShape?: ExportShape): void {
  const actualShape = detectShape(value);
  if (expectedShape && actualShape !== expectedShape && actualShape !== 'unknown') {
    // 允许 function/class 互相兼容（Legacy 中 class 通过函数构造）
    if (
      !(
        (expectedShape === 'function' && actualShape === 'class') ||
        (expectedShape === 'class' && actualShape === 'function')
      )
    ) {
      throw new LegacyAdapterError('LEGACY_EXPORT_SHAPE_MISMATCH', '', {
        exportName: '<unknown>',
      });
    }
  }
}

function verifySourceHash(profile: LegacyModuleProfile): void {
  if (!profile.sourceHash) return;

  const cached = hashCache.get(profile.modulePath);
  if (cached && cached.sourceHash === profile.sourceHash) {
    return;
  }

  const absolutePath = resolveLegacyModulePath(profile.modulePath);
  const currentHash = computeSourceHash(absolutePath);
  if (currentHash !== profile.sourceHash) {
    throw new LegacyAdapterError('LEGACY_SOURCE_HASH_MISMATCH', profile.modulePath);
  }

  hashCache.set(profile.modulePath, {
    modulePath: profile.modulePath,
    sourceHash: currentHash,
    verifiedAt: Date.now(),
  });
}

function loadLegacyModule(profile: LegacyModuleProfile): Record<string, unknown> {
  verifySourceHash(profile);

  const absolutePath = resolveLegacyModulePath(profile.modulePath);
  try {
    return evaluateLegacyModule(absolutePath);
  } catch (cause) {
    const modulePath = profile.modulePath;
    if (cause instanceof SyntaxError) {
      // HTML 实体污染等语法错误按不安全处理
      throw new LegacyAdapterError('LEGACY_MODULE_UNSAFE', modulePath, { cause });
    }
    const message = cause instanceof Error ? sanitizeErrorMessage(cause.message, REPO_ROOT) : String(cause);
    throw new LegacyAdapterError('LEGACY_INVOCATION_FAILED', modulePath, {
      cause: new Error(message),
    });
  }
}

function cacheKey(modulePath: string, exportName: string): string {
  return `${modulePath}#${exportName}`;
}

export function loadLegacyExport<
  T extends (...args: never[]) => unknown = (...args: never[]) => unknown,
>(modulePath: string, exportName: string): T {
  if (isPathTraversal(modulePath)) {
    throw new LegacyAdapterError('LEGACY_MODULE_NOT_PROFILED', modulePath, { exportName });
  }

  const profile = getLegacyModuleProfile(modulePath);
  if (!profile) {
    throw new LegacyAdapterError('LEGACY_MODULE_NOT_PROFILED', modulePath, { exportName });
  }

  if (!profile.importSafe) {
    throw new LegacyAdapterError('LEGACY_MODULE_UNSAFE', modulePath, { exportName });
  }
  if (profile.importStrategy !== 'CREATE_REQUIRE') {
    throw new LegacyAdapterError('LEGACY_MODULE_UNSAFE', modulePath, { exportName });
  }

  if (!profile.allowedExports.includes(exportName)) {
    throw new LegacyAdapterError('LEGACY_EXPORT_NOT_ALLOWED', modulePath, { exportName });
  }

  const key = cacheKey(modulePath, exportName);
  const cached = exportCache.get(key);
  if (cached) {
    return cached.value as T;
  }

  const mod = loadLegacyModule(profile);
  const value = mod[exportName];
  if (value === undefined) {
    throw new LegacyAdapterError('LEGACY_EXPORT_SHAPE_MISMATCH', modulePath, { exportName });
  }

  validateExportShape(value);

  const entry: CachedExport = {
    modulePath,
    exportName,
    value,
    shape: detectShape(value),
  };
  exportCache.set(key, entry);
  return value as T;
}

export function loadLegacyClass<
  T extends new (...args: never[]) => Record<string, unknown> = new (...args: never[]) => Record<string, unknown>,
>(modulePath: string, exportName: string): T {
  const ctor = loadLegacyExport(modulePath, exportName);
  if (typeof ctor !== 'function') {
    throw new LegacyAdapterError('LEGACY_EXPORT_SHAPE_MISMATCH', modulePath, { exportName });
  }
  return ctor as unknown as T;
}

export function clearLegacyExportCache(): void {
  exportCache.clear();
  hashCache.clear();
  moduleCache.clear();
}

export function getLegacyExportCacheStats(): { exports: number; hashes: number } {
  return {
    exports: exportCache.size,
    hashes: hashCache.size,
  };
}
