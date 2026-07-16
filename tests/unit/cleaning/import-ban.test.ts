import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

interface Violation {
  file: string;
  line: number;
  content: string;
}

const LEGACY_IMPORT_PATTERNS = [
  /from\s+['"][^'"]*data-cleaning[^'"]*['"]/,
  /require\s*\(\s*['"][^'"]*data-cleaning[^'"]*['"]\s*\)/,
  /import\s*\(\s*['"][^'"]*data-cleaning[^'"]*['"]\s*\)/,
];

const ALLOWED_PATHS = [
  'src/server/cleaning/legacy-module-loader.ts',
  'src/server/cleaning/legacy-audit.ts',
  'scripts/phase2',
];

function isAllowed(file: string): boolean {
  const relative = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
  return ALLOWED_PATHS.some(allowed => relative === allowed || relative.startsWith(allowed + '/'));
}

function findLegacyImportViolations(dir: string): Violation[] {
  const violations: Violation[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      violations.push(...findLegacyImportViolations(fullPath));
    } else if (entry.isFile() && /\.(ts|js|mts|cts)$/.test(entry.name)) {
      if (isAllowed(fullPath)) continue;

      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('//')) continue; // 跳过注释行（简单处理）
        for (const pattern of LEGACY_IMPORT_PATTERNS) {
          if (pattern.test(line)) {
            violations.push({
              file: path.relative(REPO_ROOT, fullPath).replace(/\\/g, '/'),
              line: i + 1,
              content: line.trim(),
            });
            break;
          }
        }
      }
    }
  }

  return violations;
}

describe('直接 Legacy Import 禁令', () => {
  it('生产代码（src/ 除 Loader 外）不存在直接 import / require Legacy 模块', () => {
    const srcDir = path.join(REPO_ROOT, 'src');
    const violations = findLegacyImportViolations(srcDir);

    if (violations.length > 0) {
      const summary = violations
        .map(v => `  ${v.file}:${v.line} -> ${v.content}`)
        .join('\n');
      throw new Error(`发现 ${violations.length} 处直接 Legacy Import 违规：\n${summary}`);
    }

    expect(violations).toHaveLength(0);
  });

  it('扫描器能识别故意违规的测试夹具', () => {
    const fixtureDir = path.join(REPO_ROOT, 'tests', 'fixtures');
    const violations = findLegacyImportViolations(fixtureDir);

    const violation = violations.find(v => v.file.includes('legacy-import-violation.ts'));
    expect(violation).toBeDefined();
    expect(violation?.content).toContain('data-cleaning');
  });
});
