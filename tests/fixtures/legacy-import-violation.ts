// 故意违规的测试夹具：直接 import Legacy 模块。
// 用于验证直接 Legacy Import 禁令扫描器能够发现违规。

// @ts-expect-error 故意违反规则
import { createCleaner } from '../../src/data-cleaning/core/data-cleaner.js';

export function useLegacy(): unknown {
  return createCleaner;
}
