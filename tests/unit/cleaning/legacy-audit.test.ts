/**
 * legacy-audit.test.ts — Phase 2A 审计器契约测试
 *
 * 验证审计器能正确识别：
 * - 安全模块 (importSafe=true)
 * - import-time 读取副作用
 * - import-time 写入副作用
 * - 间接依赖（传递性）副作用
 * - 导出 keys 记录
 * - 临时目录清理
 * - 主测试进程无残留
 * - 模块导入失败仍生成合法 Profile
 * - 报告通过 Zod Runtime Schema 校验
 *
 * 约束：不得通过 Mock 掉真实副作用来让测试通过。
 * 所有测试均通过真实子进程 require 真实夹具模块完成。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  probeModule,
  buildProfile,
  determineImportSafe,
  suggestImportStrategy,
} from '../../../scripts/phase2/audit-legacy-modules.js';
import { LegacyModuleProfileSchema } from '../../../src/server/cleaning/contracts/legacy-module-profile.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');

const SAFE_MODULE = join(FIXTURES, 'safe-module.cjs');
const IMPORT_READ_MODULE = join(FIXTURES, 'import-read-module.cjs');
const IMPORT_WRITE_MODULE = join(FIXTURES, 'import-write-module.cjs');
const TRANSITIVE_MODULE = join(FIXTURES, 'transitive-side-effect-module.cjs');
const IMPORT_WRITE_RESIDUE_DIR = join(FIXTURES, '.import-write-test-dir');

// 清理由 import-write-module / transitive-side-effect-module 夹具产生的残留目录
afterEach(() => {
  if (existsSync(IMPORT_WRITE_RESIDUE_DIR)) {
    rmSync(IMPORT_WRITE_RESIDUE_DIR, { recursive: true, force: true });
  }
});

describe('Legacy Audit — 安全模块', () => {
  it('importSafe=true，无文件系统副作用', () => {
    const r = probeModule(SAFE_MODULE);

    expect(r.importError).toBeNull();
    expect(determineImportSafe(r)).toBe(true);

    const importReads = r.filesystemReads.filter((x) => x.phase === 'import');
    const importWrites = r.filesystemWrites.filter((x) => x.phase === 'import');
    expect(importReads).toHaveLength(0);
    expect(importWrites).toHaveLength(0);
    expect(r.globalMutations).toHaveLength(0);
  });

  it('导入策略建议为 CREATE_REQUIRE', () => {
    const r = probeModule(SAFE_MODULE);
    const safe = determineImportSafe(r);
    expect(suggestImportStrategy(safe, r)).toBe('CREATE_REQUIRE');
  });
});

describe('Legacy Audit — import-time 读取', () => {
  it('识别 import-time readFileSync 调用', () => {
    const r = probeModule(IMPORT_READ_MODULE);

    expect(determineImportSafe(r)).toBe(false);

    const importReads = r.filesystemReads.filter((x) => x.phase === 'import');
    expect(importReads.length).toBeGreaterThan(0);
    expect(importReads.some((x) => x.fn === 'readFileSync')).toBe(true);
  });

  it('导入策略建议不为 DIRECT_IMPORT', () => {
    const r = probeModule(IMPORT_READ_MODULE);
    const safe = determineImportSafe(r);
    expect(suggestImportStrategy(safe, r)).not.toBe('CREATE_REQUIRE');
    expect(suggestImportStrategy(safe, r)).not.toBe('DIRECT_IMPORT');
  });
});

describe('Legacy Audit — import-time 写入', () => {
  it('识别 import-time mkdirSync 与 writeFileSync', () => {
    const r = probeModule(IMPORT_WRITE_MODULE);

    expect(determineImportSafe(r)).toBe(false);

    const importWrites = r.filesystemWrites.filter((x) => x.phase === 'import');
    expect(importWrites.length).toBeGreaterThanOrEqual(2);
    expect(importWrites.some((x) => x.fn === 'mkdirSync')).toBe(true);
    expect(importWrites.some((x) => x.fn === 'writeFileSync')).toBe(true);
  });

  it('写入策略建议为 MIGRATE_INCREMENTALLY（有 import-time 写入）', () => {
    const r = probeModule(IMPORT_WRITE_MODULE);
    const safe = determineImportSafe(r);
    expect(suggestImportStrategy(safe, r)).toBe('MIGRATE_INCREMENTALLY');
  });
});

describe('Legacy Audit — 传递性副作用', () => {
  it('间接依赖的 import-time 写入被识别', () => {
    const r = probeModule(TRANSITIVE_MODULE);

    expect(determineImportSafe(r)).toBe(false);

    const importWrites = r.filesystemWrites.filter((x) => x.phase === 'import');
    expect(importWrites.length).toBeGreaterThan(0);
    expect(importWrites.some((x) => x.fn === 'mkdirSync' || x.fn === 'writeFileSync')).toBe(true);
  });

  it('transitiveSideEffects 非空', () => {
    const r = probeModule(TRANSITIVE_MODULE);
    const profile = buildProfile(TRANSITIVE_MODULE, r);
    expect(profile.transitiveSideEffects.length).toBeGreaterThan(0);
  });
});

describe('Legacy Audit — 导出形状记录', () => {
  it('安全模块导出 keys 被正确记录', () => {
    const r = probeModule(SAFE_MODULE);
    expect(r.exportShape).toEqual(expect.arrayContaining(['pureAdd', 'pureEcho', '__name']));
  });

  it('import-read 模块导出 keys 被记录', () => {
    const r = probeModule(IMPORT_READ_MODULE);
    expect(r.exportShape).toEqual(expect.arrayContaining(['readAtImport', 'bytesRead', '__name']));
  });
});

describe('Legacy Audit — 临时目录清理', () => {
  it('probeModule 完成后不残留 phase2a-audit 临时目录', () => {
    const tmpRoot = tmpdir();
    probeModule(SAFE_MODULE);

    // 扫描临时目录中是否有 phase2a-audit-* 残留
    const entries = readdirSync(tmpRoot);
    const residue = entries.filter((e: string) => e.startsWith('phase2a-audit-'));
    expect(residue).toHaveLength(0);
  });
});

describe('Legacy Audit — 主进程无残留', () => {
  it('主测试进程的 cwd 下不创建日志或临时目录', () => {
    const cwd = process.cwd();
    probeModule(IMPORT_WRITE_MODULE);

    // 主进程 cwd 下不应出现 .import-write-test-dir（写入发生在子进程的 fixtures __dirname）
    expect(existsSync(join(cwd, '.import-write-test-dir'))).toBe(false);
    expect(existsSync(join(cwd, 'logs'))).toBe(false);
  });
});

describe('Legacy Audit — 导入失败仍生成合法 Profile', () => {
  it('throw 模块生成带 importError 的 Profile 且通过 Zod 校验', () => {
    // 创建真实会抛错的临时夹具（非 mock）
    const tempDir = mkdtempSync(join(tmpdir(), 'test-throw-'));
    const throwingModule = join(tempDir, 'throw.cjs');
    writeFileSync(throwingModule, "throw new Error('intentional import failure');", 'utf8');

    try {
      const r = probeModule(throwingModule);

      expect(r.importError).not.toBeNull();
      expect(r.importError!.name).toBe('Error');
      expect(r.importError!.message).toContain('intentional import failure');

      const profile = buildProfile(throwingModule, r);
      expect(profile.importError).toBeDefined();
      expect(profile.importSafe).toBe(false);

      // Zod 校验通过
      const result = LegacyModuleProfileSchema.safeParse(profile);
      expect(result.success).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('MODULE_NOT_FOUND 模块生成带 importError 的 Profile', () => {
    const nonExistent = join(FIXTURES, 'does-not-exist.cjs');
    const r = probeModule(nonExistent);

    expect(r.importError).not.toBeNull();
    // require 失败，但 probeModule 不抛异常
    expect(r.exportShape).toHaveLength(0);
  });
});

describe('Legacy Audit — Zod Runtime Schema 校验', () => {
  it('安全模块 Profile 通过 Zod 校验', () => {
    const r = probeModule(SAFE_MODULE);
    const profile = buildProfile(SAFE_MODULE, r);
    const result = LegacyModuleProfileSchema.safeParse(profile);
    expect(result.success).toBe(true);
  });

  it('不安全模块 Profile 通过 Zod 校验', () => {
    const r = probeModule(IMPORT_WRITE_MODULE);
    const profile = buildProfile(IMPORT_WRITE_MODULE, r);
    const result = LegacyModuleProfileSchema.safeParse(profile);
    expect(result.success).toBe(true);
  });

  it('失败模块 Profile 通过 Zod 校验', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'test-zod-'));
    const throwingModule = join(tempDir, 'throw.cjs');
    writeFileSync(throwingModule, "throw new Error('fail');", 'utf8');
    try {
      const r = probeModule(throwingModule);
      const profile = buildProfile(throwingModule, r);
      const result = LegacyModuleProfileSchema.safeParse(profile);
      expect(result.success).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
