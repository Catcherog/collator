# Phase 2A Legacy Module Profiles

> 生成时间: 2026-07-16T04:19:32.813Z
> 基线 Commit: 9d62350627161c308a58407fc8af0ce414e77d9d
> 审计工具版本: phase2a-1.0.0
> 耗时: 9750 ms

## 一、汇总

| 指标 | 值 |
|------|-----|
| discovered_module_count | 62 |
| profiled_module_count | 62 |
| excluded_module_count | 0 |
| safe_module_count | 29 |
| unsafe_module_count | 33 |
| import_failed_count | 33 |
| cjs_module_count | 62 |
| esm_module_count | 0 |
| unprofiled_modules | [] (空) |

**校验**: profiled + excluded = 62 = discovered 62

## 三、模块 Profile 详情

### src/data-cleaning/agent/execution/bitable-writer.js

- **moduleFormat**: cjs
- **sourceHash**: `c0ec418f5a1175073b15cde0471d086d779d04a2912d7af175d1bc372bb6146e`
- **importSafe**: true
- **importStrategy**: `CREATE_REQUIRE`
- **exportShape**: `BitableWriter`, `createBitableWriter`
- **allowedExports**: `BitableWriter`, `createBitableWriter`
- **workingDirectoryDependency**: false
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 导入 src/data-cleaning/agent/execution/bitable-writer.js 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象

### src/data-cleaning/agent/execution/confirmation-ui.js

- **moduleFormat**: cjs
- **sourceHash**: `dd4413b7bd966e196a79aff847c3ad70f6de377a97672bd1e9aaba79b1ee5b11`
- **importSafe**: true
- **importStrategy**: `CREATE_REQUIRE`
- **exportShape**: `generateConfirmation`, `generateSuccessReport`, `generateErrorReport`, `generateBatchPreview`, `SCENE_NAMES`, `CONFIDENCE_LEVELS`
- **allowedExports**: `generateConfirmation`, `generateSuccessReport`, `generateErrorReport`, `generateBatchPreview`, `SCENE_NAMES`, `CONFIDENCE_LEVELS`
- **workingDirectoryDependency**: false
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
  - 存在对象类型导出, 互操作需注意引用语义
- **sideEffectTest**: 导入 src/data-cleaning/agent/execution/confirmation-ui.js 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象

### src/data-cleaning/agent/execution/index.js

- **moduleFormat**: cjs
- **sourceHash**: `b0fd1fa019ba4166d69d439bfa0f4958822ce2296cb47449625092f8678104dd`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=require, name=SyntaxError, message=Unexpected token ';'
- **filesystemReads** (1):
  - [import] readFileSync -> src/data-cleaning/agent/execution/linkage-engine.js
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**:
  - import-time readFileSync -> src/data-cleaning/agent/execution/linkage-engine.js
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言 import-time 读取被识别 (1 次); 断言导入失败仍生成合法 Profile (SyntaxError)

### src/data-cleaning/agent/execution/linkage-engine.js

- **moduleFormat**: cjs
- **sourceHash**: `c3b6fa84660e37ccc5b1249cf2f3b1588a7fc69b06ba70bd939b27c969044ce4`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=require, name=SyntaxError, message=Unexpected token ';'
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言导入失败仍生成合法 Profile (SyntaxError)

### src/data-cleaning/agent/execution/rollback-manager.js

- **moduleFormat**: cjs
- **sourceHash**: `f78a8dd95ebec4b62f594bc27dfafd0ab4f33bb27f765115eff0d13df0761296`
- **importSafe**: true
- **importStrategy**: `CREATE_REQUIRE`
- **exportShape**: `RollbackManager`, `createRollbackManager`
- **allowedExports**: `RollbackManager`, `createRollbackManager`
- **workingDirectoryDependency**: false
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 导入 src/data-cleaning/agent/execution/rollback-manager.js 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象

### src/data-cleaning/agent/index.js

- **moduleFormat**: cjs
- **sourceHash**: `aed1da8150928566ee2853c68d99d7ae7518421b6b8d8cbf1d43d61b98f2a8a7`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=require, name=SyntaxError, message=Unexpected token ';'
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言导入失败仍生成合法 Profile (SyntaxError)

### src/data-cleaning/agent/perception/dispatcher.js

- **moduleFormat**: cjs
- **sourceHash**: `0075e6906f8ec5202425261cd73d3e40912be932536ff240413c435d5d06a517`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=require, name=SyntaxError, message=Unexpected token ';'
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言导入失败仍生成合法 Profile (SyntaxError)

### src/data-cleaning/agent/perception/doc-parser.js

- **moduleFormat**: cjs
- **sourceHash**: `69c9790716ca5f67ef151575cb8eb30369cdcb01064d0cc4bafe9653e45fd1d9`
- **importSafe**: true
- **importStrategy**: `CREATE_REQUIRE`
- **exportShape**: `extractText`
- **allowedExports**: `extractText`
- **workingDirectoryDependency**: false
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 导入 src/data-cleaning/agent/perception/doc-parser.js 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象

### src/data-cleaning/agent/perception/index.js

- **moduleFormat**: cjs
- **sourceHash**: `87b5b730382bd8da9d6f09cb41b33980e45fa184d1ecd738102a95e30329a9b9`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=require, name=SyntaxError, message=Unexpected token ';'
- **filesystemReads** (1):
  - [import] readFileSync -> src/data-cleaning/agent/perception/input-classifier.js
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**:
  - import-time readFileSync -> src/data-cleaning/agent/perception/input-classifier.js
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言 import-time 读取被识别 (1 次); 断言导入失败仍生成合法 Profile (SyntaxError)

### src/data-cleaning/agent/perception/input-classifier.js

- **moduleFormat**: cjs
- **sourceHash**: `a874ccd662aa3ad469a1425a65a522d303d09dceedb0d35e4cba37e1cd077403`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=require, name=SyntaxError, message=Unexpected token ';'
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言导入失败仍生成合法 Profile (SyntaxError)

### src/data-cleaning/agent/understanding/ambiguity-detector.js

- **moduleFormat**: cjs
- **sourceHash**: `da20ab758780e99d23d144e225b690f5f927855acfbf16e7daffaa2e62cf02eb`
- **importSafe**: true
- **importStrategy**: `CREATE_REQUIRE`
- **exportShape**: `detectAmbiguities`, `stringSimilarity`
- **allowedExports**: `detectAmbiguities`, `stringSimilarity`
- **workingDirectoryDependency**: false
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 导入 src/data-cleaning/agent/understanding/ambiguity-detector.js 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象

### src/data-cleaning/agent/understanding/confidence-scorer.js

- **moduleFormat**: cjs
- **sourceHash**: `084bb1cc4fb43df3745e7ab2b55cace4884c08e8d2aab04232cdc99e879d363f`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=require, name=SyntaxError, message=Unexpected token ';'
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言导入失败仍生成合法 Profile (SyntaxError)

### src/data-cleaning/agent/understanding/field-extractor.js

- **moduleFormat**: cjs
- **sourceHash**: `1d6b6922e9149613d0d83c11fa0e1bb513e902a8d4409962cdefe4fe105935fc`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=require, name=SyntaxError, message=Unexpected token ';'
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言导入失败仍生成合法 Profile (SyntaxError)

### src/data-cleaning/agent/understanding/index.js

- **moduleFormat**: cjs
- **sourceHash**: `9d50645bc3d8f57b0d1893630d961e80bd4f6e0769be3896d48728d6498bb4de`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=require, name=SyntaxError, message=Unexpected token ';'
- **filesystemReads** (1):
  - [import] readFileSync -> src/data-cleaning/agent/understanding/scene-classifier.js
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**:
  - import-time readFileSync -> src/data-cleaning/agent/understanding/scene-classifier.js
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言 import-time 读取被识别 (1 次); 断言导入失败仍生成合法 Profile (SyntaxError)

### src/data-cleaning/agent/understanding/scene-classifier.js

- **moduleFormat**: cjs
- **sourceHash**: `18b24ef6086d5edbd927522c5bd98cd246352c3f7a9375eb3a5f3d362b4b0cbb`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=require, name=SyntaxError, message=Unexpected token ';'
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言导入失败仍生成合法 Profile (SyntaxError)

### src/data-cleaning/agent/workflows/base-workflow.js

- **moduleFormat**: cjs
- **sourceHash**: `cd81e193b21e6fc14b34f23a0ce1b81dd0a991c2ee33082b82a720702efa7f5c`
- **importSafe**: true
- **importStrategy**: `CREATE_REQUIRE`
- **exportShape**: `default`
- **allowedExports**: `default`
- **workingDirectoryDependency**: false
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 导入 src/data-cleaning/agent/workflows/base-workflow.js 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象

### src/data-cleaning/agent/workflows/batch-import.js

- **moduleFormat**: cjs
- **sourceHash**: `80fd866452370b597b942dcdb062a5e285b61b789d7230e4a13336b11a0e1a26`
- **importSafe**: true
- **importStrategy**: `CREATE_REQUIRE`
- **exportShape**: `default`
- **allowedExports**: `default`
- **workingDirectoryDependency**: false
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 导入 src/data-cleaning/agent/workflows/batch-import.js 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象

### src/data-cleaning/agent/workflows/customer-consultation.js

- **moduleFormat**: cjs
- **sourceHash**: `5b1e4388b14561aa537f5576057608e13ed9f4845254d813d371a13ec880c4c4`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=require, name=SyntaxError, message=Unexpected token ';'
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言导入失败仍生成合法 Profile (SyntaxError)

### src/data-cleaning/agent/workflows/index.js

- **moduleFormat**: cjs
- **sourceHash**: `508e07e033f9246b25ea2ee81b352c7d7c7381dd91dbe75131b54c8df7ce99da`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=require, name=SyntaxError, message=Unexpected token ';'
- **filesystemReads** (1):
  - [import] readFileSync -> src/data-cleaning/agent/workflows/customer-consultation.js
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**:
  - import-time readFileSync -> src/data-cleaning/agent/workflows/customer-consultation.js
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言 import-time 读取被识别 (1 次); 断言导入失败仍生成合法 Profile (SyntaxError)

### src/data-cleaning/agent/workflows/namecard-ocr.js

- **moduleFormat**: cjs
- **sourceHash**: `5f86b7c162a742276be70191e1278b95ee4866f6a1f52983c8a3bca5286181e7`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=require, name=SyntaxError, message=Unexpected token ';'
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言导入失败仍生成合法 Profile (SyntaxError)

### src/data-cleaning/agent/workflows/resource-onboarding.js

- **moduleFormat**: cjs
- **sourceHash**: `1003ba4060a02a2e39075f824d09b4d78a981b1daf4a0533eb970080749882aa`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=require, name=SyntaxError, message=Unexpected token ';'
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言导入失败仍生成合法 Profile (SyntaxError)

### src/data-cleaning/benchmark/metrics.js

- **moduleFormat**: cjs
- **sourceHash**: `fe9b1cffbd4385f8327661baecf66c4676b14a1a8aa8ffa83d6474d4288b2344`
- **importSafe**: true
- **importStrategy**: `CREATE_REQUIRE`
- **exportShape**: `isEqual`, `accuracy`, `computeFieldAccuracy`, `computeCorrectionsAccuracy`, `computeStatusMatch`, `computeCasePassed`, `computeSynonymRecall`, `computeRequiredInterception`, `scoreWithinRange`, `computeWER`, `computeCRA`
- **allowedExports**: `isEqual`, `accuracy`, `computeFieldAccuracy`, `computeCorrectionsAccuracy`, `computeStatusMatch`, `computeCasePassed`, `computeSynonymRecall`, `computeRequiredInterception`, `scoreWithinRange`, `computeWER`, `computeCRA`
- **workingDirectoryDependency**: false
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 导入 src/data-cleaning/benchmark/metrics.js 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象

### src/data-cleaning/benchmark/run-benchmark.js

- **moduleFormat**: cjs
- **sourceHash**: `9ebc7eae8c418635d83d46c212a88468dfdc0aecd0b218d30be800aac63c9881`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=require, name=SyntaxError, message=Unexpected token ';'
- **filesystemReads** (2):
  - [import] readFileSync -> src/data-cleaning/index.js
  - [import] readFileSync -> src/data-cleaning/agent/index.js
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**:
  - import-time readFileSync -> src/data-cleaning/index.js
  - import-time readFileSync -> src/data-cleaning/agent/index.js
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言 import-time 读取被识别 (2 次); 断言导入失败仍生成合法 Profile (SyntaxError)

### src/data-cleaning/config/index.js

- **moduleFormat**: cjs
- **sourceHash**: `a9a0282fd1eb74a1c37a77186cdbe33eed43f9ccb85bd94ac8921af1a56e0499`
- **importSafe**: true
- **importStrategy**: `CREATE_REQUIRE`
- **exportShape**: `loadAllConfig`, `getSynonyms`, `getCleaningRules`, `getStyleSynonyms`, `getShootTypeMapping`, `getFieldFormatRule`, `getStateMachine`, `getValidationLevel`, `clearCache`, `getRuleLearner`, `RuleLearner`
- **allowedExports**: `loadAllConfig`, `getSynonyms`, `getCleaningRules`, `getStyleSynonyms`, `getShootTypeMapping`, `getFieldFormatRule`, `getStateMachine`, `getValidationLevel`, `clearCache`, `getRuleLearner`, `RuleLearner`
- **workingDirectoryDependency**: false
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 导入 src/data-cleaning/config/index.js 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象

### src/data-cleaning/core/batch-processor.js

- **moduleFormat**: cjs
- **sourceHash**: `64a9e0886fcaaebfbbc55af2904d506de9e37d864e27aefffa1795367bc2e636`
- **importSafe**: true
- **importStrategy**: `CREATE_REQUIRE`
- **exportShape**: `BatchProcessor`, `createBatchProcessor`
- **allowedExports**: `BatchProcessor`, `createBatchProcessor`
- **workingDirectoryDependency**: false
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 导入 src/data-cleaning/core/batch-processor.js 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象

### src/data-cleaning/core/data-cleaner.js

- **moduleFormat**: cjs
- **sourceHash**: `1723e65854e8a089dfee12541219ef1351b2769fff8044148bd17be822aeae16`
- **importSafe**: true
- **importStrategy**: `CREATE_REQUIRE`
- **exportShape**: `DataCleaner`, `CleaningPipeline`, `FormatCleaner`, `EnumMappingCleaner`, `DefaultValueCleaner`, `NullToEmptyCleaner`, `createCleaner`
- **allowedExports**: `DataCleaner`, `CleaningPipeline`, `FormatCleaner`, `EnumMappingCleaner`, `DefaultValueCleaner`, `NullToEmptyCleaner`, `createCleaner`
- **workingDirectoryDependency**: false
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 导入 src/data-cleaning/core/data-cleaner.js 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象

### src/data-cleaning/core/data-scanner.js

- **moduleFormat**: cjs
- **sourceHash**: `88c3046b5405f0edc9c40bf991fcc2d70c4a97bf977ea3d44d61079a7fb9773c`
- **importSafe**: true
- **importStrategy**: `CREATE_REQUIRE`
- **exportShape**: `DataScanner`, `createDataScanner`
- **allowedExports**: `DataScanner`, `createDataScanner`
- **workingDirectoryDependency**: false
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 导入 src/data-cleaning/core/data-scanner.js 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象

### src/data-cleaning/core/index.js

- **moduleFormat**: cjs
- **sourceHash**: `2e77c252190d8e1a20c889937e6ac93e6d1a6691e64dcb5ea9587188b4e88557`
- **importSafe**: true
- **importStrategy**: `CREATE_REQUIRE`
- **exportShape**: `DataCleaner`, `CleaningPipeline`, `FormatCleaner`, `EnumMappingCleaner`, `DefaultValueCleaner`, `NullToEmptyCleaner`, `OperationLogger`, `DataScanner`, `QualityScorer`, `RuleLearner`, `BatchProcessor`, `createCleaner`, `createDataScanner`, `createQualityScorer`, `createRuleLearner`, `createLogger`, `createBatchProcessor`
- **allowedExports**: `DataCleaner`, `CleaningPipeline`, `FormatCleaner`, `EnumMappingCleaner`, `DefaultValueCleaner`, `NullToEmptyCleaner`, `OperationLogger`, `DataScanner`, `QualityScorer`, `RuleLearner`, `BatchProcessor`, `createCleaner`, `createDataScanner`, `createQualityScorer`, `createRuleLearner`, `createLogger`, `createBatchProcessor`
- **workingDirectoryDependency**: false
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 导入 src/data-cleaning/core/index.js 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象

### src/data-cleaning/core/operation-logger.js

- **moduleFormat**: cjs
- **sourceHash**: `c2900398df84ead991c05e9a20f405bb7d394e06368523e37a63d524250d6bd5`
- **importSafe**: true
- **importStrategy**: `CREATE_REQUIRE`
- **exportShape**: `OperationLogger`, `createLogger`
- **allowedExports**: `OperationLogger`, `createLogger`
- **workingDirectoryDependency**: false
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 导入 src/data-cleaning/core/operation-logger.js 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象

### src/data-cleaning/core/quality-scorer.js

- **moduleFormat**: cjs
- **sourceHash**: `bb16f014922b1c896933cc6425bc68d91f7b0c84dbfc69e36e1b62aa02f070a6`
- **importSafe**: true
- **importStrategy**: `CREATE_REQUIRE`
- **exportShape**: `QualityScorer`, `createQualityScorer`
- **allowedExports**: `QualityScorer`, `createQualityScorer`
- **workingDirectoryDependency**: false
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 导入 src/data-cleaning/core/quality-scorer.js 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象

### src/data-cleaning/core/rule-learning.js

- **moduleFormat**: cjs
- **sourceHash**: `3299ae751d218053ddb704648ea7f95c7359aa76c5a7316829915da75b34e499`
- **importSafe**: true
- **importStrategy**: `CREATE_REQUIRE`
- **exportShape**: `RuleLearner`, `createInstance`
- **allowedExports**: `RuleLearner`, `createInstance`
- **workingDirectoryDependency**: false
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 导入 src/data-cleaning/core/rule-learning.js 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象

### src/data-cleaning/core/test-batch.js

- **moduleFormat**: cjs
- **sourceHash**: `e385f138a13d3bdfe0ba21bd3eb1f987de39001b300664a4280c201cd4531f33`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=evaluate, name=SyntaxError, message=子进程失败/超时: Unexpected token '=', "=== 批量处理与质"... is not valid JSON
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言导入失败仍生成合法 Profile (SyntaxError)

### src/data-cleaning/core/test-cleaner.js

- **moduleFormat**: cjs
- **sourceHash**: `84cf47bf064419465bd134f9dcfbfb2b41bf4311b5e699ab0c1627b9aefddb16`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=evaluate, name=SyntaxError, message=子进程失败/超时: Unexpected token '=', "=== 数据清洗引擎"... is not valid JSON
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言导入失败仍生成合法 Profile (SyntaxError)

### src/data-cleaning/core/test-learning.js

- **moduleFormat**: cjs
- **sourceHash**: `1c7171ad844e570c66684dcbad51902021582ced0248d906fa58d8e1ab72111c`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=evaluate, name=SyntaxError, message=子进程失败/超时: Unexpected token '=', "=========="... is not valid JSON
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言导入失败仍生成合法 Profile (SyntaxError)

### src/data-cleaning/core/test-logger.js

- **moduleFormat**: cjs
- **sourceHash**: `f3983cc72153baa62693a4b2dd4dfb9482a2f552be91efa24a8f520e15812ee2`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=evaluate, name=Error, message=子进程失败/超时: Command failed: node <repo>\scripts\phase2\audit-worker.cjs --target=<repo>\src\data-cleaning\core\test-logger.js --observer=<repo>\tests\unit\cleaning\fixtures\fs-observer.cjs --repoRoot=<repo>
创建日志目录失败: ENOENT: no such file or directory, mkdir 'Z:\nonexistent\path\that\cannot\exist'
写入日志失败: ENOENT: no such file or directory, open 'Z:\nonexistent\path\that\cannot\exist\cleaning-2026-07-16.jsonl'

- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言导入失败仍生成合法 Profile (Error)

### src/data-cleaning/core/test-quality.js

- **moduleFormat**: cjs
- **sourceHash**: `e2c54023694917bebf49dbf569746ad2ada82b8a1e3b303a349ef0a326047b56`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=evaluate, name=SyntaxError, message=子进程失败/超时: Unexpected token '=', "=========="... is not valid JSON
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言导入失败仍生成合法 Profile (SyntaxError)

### src/data-cleaning/core/test-scanner.js

- **moduleFormat**: cjs
- **sourceHash**: `95b506bcdba5a7537f5df24d7cc6551ac73ca958cdf834c60cbe97b7c8bf23ae`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=evaluate, name=SyntaxError, message=子进程失败/超时: Unexpected token '=', "=== 数据质量扫描"... is not valid JSON
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言导入失败仍生成合法 Profile (SyntaxError)

### src/data-cleaning/examples/example-add-synonym.js

- **moduleFormat**: cjs
- **sourceHash**: `cac1f767189dd74c1af7084ecab064db0ae1d61b917160cf22b53e004e443d3f`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=require, name=SyntaxError, message=Unexpected token ';'
- **filesystemReads** (2):
  - [import] readFileSync -> src/data-cleaning/index.js
  - [import] readFileSync -> src/data-cleaning/agent/index.js
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**:
  - import-time readFileSync -> src/data-cleaning/index.js
  - import-time readFileSync -> src/data-cleaning/agent/index.js
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言 import-time 读取被识别 (2 次); 断言导入失败仍生成合法 Profile (SyntaxError)

### src/data-cleaning/examples/example-batch-process.js

- **moduleFormat**: cjs
- **sourceHash**: `5b0f8579739b9ba07519120280196053a87e19331002a04c6c88ee7077d59aa4`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=require, name=SyntaxError, message=Unexpected token ';'
- **filesystemReads** (2):
  - [import] readFileSync -> src/data-cleaning/index.js
  - [import] readFileSync -> src/data-cleaning/agent/index.js
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**:
  - import-time readFileSync -> src/data-cleaning/index.js
  - import-time readFileSync -> src/data-cleaning/agent/index.js
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言 import-time 读取被识别 (2 次); 断言导入失败仍生成合法 Profile (SyntaxError)

### src/data-cleaning/examples/example-single-clean.js

- **moduleFormat**: cjs
- **sourceHash**: `8e13480f1f1219c5a197a150f9198ddfb5ffaf589174802c0cb1c58c4dc7c0ad`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=require, name=SyntaxError, message=Unexpected token ';'
- **filesystemReads** (2):
  - [import] readFileSync -> src/data-cleaning/index.js
  - [import] readFileSync -> src/data-cleaning/agent/index.js
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**:
  - import-time readFileSync -> src/data-cleaning/index.js
  - import-time readFileSync -> src/data-cleaning/agent/index.js
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言 import-time 读取被识别 (2 次); 断言导入失败仍生成合法 Profile (SyntaxError)

### src/data-cleaning/index.js

- **moduleFormat**: cjs
- **sourceHash**: `b49831a23213bee7f3d6b99e1db4a832ac9108d2d5404a67a457f709840208d8`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=require, name=SyntaxError, message=Unexpected token ';'
- **filesystemReads** (1):
  - [import] readFileSync -> src/data-cleaning/agent/index.js
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**:
  - import-time readFileSync -> src/data-cleaning/agent/index.js
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言 import-time 读取被识别 (1 次); 断言导入失败仍生成合法 Profile (SyntaxError)

### src/data-cleaning/multimodal/asr/feishu-minutes-adapter.js

- **moduleFormat**: cjs
- **sourceHash**: `f6e4ae5dc8c026a46d8e378fbd4f71509374bdfb2ca7bbe40d65371253e72f6e`
- **importSafe**: true
- **importStrategy**: `CREATE_REQUIRE`
- **exportShape**: `transcribe`, `checkFeishuAvailable`, `_deps`
- **allowedExports**: `transcribe`, `checkFeishuAvailable`, `_deps`
- **workingDirectoryDependency**: false
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
  - 存在对象类型导出, 互操作需注意引用语义
- **sideEffectTest**: 导入 src/data-cleaning/multimodal/asr/feishu-minutes-adapter.js 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象

### src/data-cleaning/multimodal/asr/index.js

- **moduleFormat**: cjs
- **sourceHash**: `7f8d27175b51f24b209167920a8cb9ca2c67720839e5a83db4813e4ab5bcc153`
- **importSafe**: true
- **importStrategy**: `CREATE_REQUIRE`
- **exportShape**: `transcribe`, `whisperAdapter`, `feishuAdapter`
- **allowedExports**: `transcribe`, `whisperAdapter`, `feishuAdapter`
- **workingDirectoryDependency**: false
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
  - 存在对象类型导出, 互操作需注意引用语义
- **sideEffectTest**: 导入 src/data-cleaning/multimodal/asr/index.js 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象

### src/data-cleaning/multimodal/asr/local-whisper-adapter.js

- **moduleFormat**: cjs
- **sourceHash**: `0a851c51e90af2fcd7e69f51d76cb44fc7a00575c2dfae3cd72ffd9fddbca785`
- **importSafe**: true
- **importStrategy**: `CREATE_REQUIRE`
- **exportShape**: `transcribe`, `checkWhisperAvailable`
- **allowedExports**: `transcribe`, `checkWhisperAvailable`
- **workingDirectoryDependency**: false
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 导入 src/data-cleaning/multimodal/asr/local-whisper-adapter.js 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象

### src/data-cleaning/multimodal/asr/test-asr.js

- **moduleFormat**: cjs
- **sourceHash**: `2348c8d4bd582d76fd416345f71fff9004d97861b52de1f76715c9391392922a`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=require, name=SyntaxError, message=Unexpected token ';'
- **filesystemReads** (2):
  - [import] readFileSync -> src/data-cleaning/index.js
  - [import] readFileSync -> src/data-cleaning/agent/index.js
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**:
  - import-time readFileSync -> src/data-cleaning/index.js
  - import-time readFileSync -> src/data-cleaning/agent/index.js
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言 import-time 读取被识别 (2 次); 断言导入失败仍生成合法 Profile (SyntaxError)

### src/data-cleaning/multimodal/asr/wechat-voice-converter.js

- **moduleFormat**: cjs
- **sourceHash**: `bb28738b1d02614d818de7a1073d1b06309b91189c1d92f67e1c9cd38ed16ef6`
- **importSafe**: true
- **importStrategy**: `CREATE_REQUIRE`
- **exportShape**: `isSilkFile`, `convertSilkToWav`
- **allowedExports**: `isSilkFile`, `convertSilkToWav`
- **workingDirectoryDependency**: false
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 导入 src/data-cleaning/multimodal/asr/wechat-voice-converter.js 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象

### src/data-cleaning/multimodal/clip/index.js

- **moduleFormat**: cjs
- **sourceHash**: `0e44b1d11095433d85fc16e8f7f6f276bce34986b3234bc412c905ffb89a44e5`
- **importSafe**: true
- **importStrategy**: `CREATE_REQUIRE`
- **exportShape**: `checkImageTextMatch`
- **allowedExports**: `checkImageTextMatch`
- **workingDirectoryDependency**: false
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 导入 src/data-cleaning/multimodal/clip/index.js 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象

### src/data-cleaning/multimodal/clip/python-bridge.js

- **moduleFormat**: cjs
- **sourceHash**: `8b31dcab4958f4e345483a3aa9d855ef8eb6715a147d7a6a70e3c6e494f68a5f`
- **importSafe**: true
- **importStrategy**: `CREATE_REQUIRE`
- **exportShape**: `checkPythonAvailable`, `computeSimilarity`, `checkImageTextMatch`
- **allowedExports**: `checkPythonAvailable`, `computeSimilarity`, `checkImageTextMatch`
- **workingDirectoryDependency**: false
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 导入 src/data-cleaning/multimodal/clip/python-bridge.js 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象

### src/data-cleaning/multimodal/clip/test-clip.js

- **moduleFormat**: cjs
- **sourceHash**: `61847a17474bc0752f75b78399e86676b11e8569dc5f03107ecd3e0950aa685d`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=evaluate, name=SyntaxError, message=子进程失败/超时: Unexpected token '=', "=== CLIP 模"... is not valid JSON
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言导入失败仍生成合法 Profile (SyntaxError)

### src/data-cleaning/multimodal/ocr/business-card-parser.js

- **moduleFormat**: cjs
- **sourceHash**: `519d5e18b1addb742458c4987164a37a7e318921ff3d8fc9955f0dafb95000bf`
- **importSafe**: true
- **importStrategy**: `CREATE_REQUIRE`
- **exportShape**: `parseBusinessCard`, `parseContract`, `parsePhone`, `parseWechat`, `parseName`, `parseAmount`, `parseDate`
- **allowedExports**: `parseBusinessCard`, `parseContract`, `parsePhone`, `parseWechat`, `parseName`, `parseAmount`, `parseDate`
- **workingDirectoryDependency**: false
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 导入 src/data-cleaning/multimodal/ocr/business-card-parser.js 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象

### src/data-cleaning/multimodal/ocr/feishu-ocr-adapter.js

- **moduleFormat**: cjs
- **sourceHash**: `be5e6e734cf5f690cd2eeea1ef2de454ffa4d9bb8d1776ca4c8b47d2701bdce0`
- **importSafe**: true
- **importStrategy**: `CREATE_REQUIRE`
- **exportShape**: `extractText`, `checkFeishuAvailable`
- **allowedExports**: `extractText`, `checkFeishuAvailable`
- **workingDirectoryDependency**: false
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 导入 src/data-cleaning/multimodal/ocr/feishu-ocr-adapter.js 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象

### src/data-cleaning/multimodal/ocr/index.js

- **moduleFormat**: cjs
- **sourceHash**: `8e30d1ea0909a93fa3c33bc15294de7ee71f43aca93a1a530bc5e858a38fe32e`
- **importSafe**: true
- **importStrategy**: `CREATE_REQUIRE`
- **exportShape**: `extractText`, `isImage`, `tesseractAdapter`, `feishuAdapter`
- **allowedExports**: `extractText`, `isImage`, `tesseractAdapter`, `feishuAdapter`
- **workingDirectoryDependency**: false
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
  - 存在对象类型导出, 互操作需注意引用语义
- **sideEffectTest**: 导入 src/data-cleaning/multimodal/ocr/index.js 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象

### src/data-cleaning/multimodal/ocr/tesseract-adapter.js

- **moduleFormat**: cjs
- **sourceHash**: `037586e9377fb260e111b9f1dd658c46aa3c86571f4b2bc0daa0985e256af2ed`
- **importSafe**: true
- **importStrategy**: `CREATE_REQUIRE`
- **exportShape**: `extractText`, `checkTesseractAvailable`
- **allowedExports**: `extractText`, `checkTesseractAvailable`
- **workingDirectoryDependency**: false
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 导入 src/data-cleaning/multimodal/ocr/tesseract-adapter.js 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象

### src/data-cleaning/multimodal/ocr/test-ocr.js

- **moduleFormat**: cjs
- **sourceHash**: `4f90ee509df43a44e47e8ed816f7bf59fa10aaef2d92b62a897a41ab40718b5b`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=evaluate, name=SyntaxError, message=子进程失败/超时: Unexpected token '=', "=== 飞书 OCR"... is not valid JSON
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言导入失败仍生成合法 Profile (SyntaxError)

### src/data-cleaning/multimodal/test-modules.js

- **moduleFormat**: cjs
- **sourceHash**: `5b23e0d8b9f0a7ac758e70c74ae2d8f73d289bd950d5a9d1bc85b1ecfa6e99e6`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=require, name=Error, code=MODULE_NOT_FOUND, message=Cannot find module '../../benchmark/metrics'
Require stack:
- <repo>\src\data-cleaning\multimodal\test-modules.js
- <repo>\scripts\phase2\audit-worker.cjs
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言导入失败仍生成合法 Profile (Error)

### src/data-cleaning/rules/index.js

- **moduleFormat**: cjs
- **sourceHash**: `31b86d89de5871805e46fdec996ee6c776c236905d5a4bfd08915af8adfa9659`
- **importSafe**: true
- **importStrategy**: `CREATE_REQUIRE`
- **exportShape**: `validateField`, `validateRequiredFields`, `validateStateTransition`, `validateLogicConsistency`, `validateRecord`, `makeIssue`, `isEmpty`
- **allowedExports**: `validateField`, `validateRequiredFields`, `validateStateTransition`, `validateLogicConsistency`, `validateRecord`, `makeIssue`, `isEmpty`
- **workingDirectoryDependency**: false
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 导入 src/data-cleaning/rules/index.js 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象

### src/data-cleaning/rules/test-rules.js

- **moduleFormat**: cjs
- **sourceHash**: `3d291adc3549748cbee996732496d8c8ca7de43821bed0d9e74e68003e05db85`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=evaluate, name=Error, message=子进程失败/超时: Command failed: node <repo>\scripts\phase2\audit-worker.cjs --target=<repo>\src\data-cleaning\rules\test-rules.js --observer=<repo>\tests\unit\cleaning\fixtures\fs-observer.cjs --repoRoot=<repo>
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言导入失败仍生成合法 Profile (Error)

### src/data-cleaning/schemas/index.js

- **moduleFormat**: cjs
- **sourceHash**: `6b7913dd28a3dbe9f3fdc3a2e7cc1798b0a3dbe7a948d8bb819ac8c6690250c6`
- **importSafe**: true
- **importStrategy**: `CREATE_REQUIRE`
- **exportShape**: `loadAllSchemas`, `getSchema`, `getSchemaByTableId`, `getSchemaByTableName`, `getFieldSchema`, `getFieldByFieldId`, `getRequiredFields`, `getEnumFields`, `clearCache`, `schemaFiles`
- **allowedExports**: `loadAllSchemas`, `getSchema`, `getSchemaByTableId`, `getSchemaByTableName`, `getFieldSchema`, `getFieldByFieldId`, `getRequiredFields`, `getEnumFields`, `clearCache`, `schemaFiles`
- **workingDirectoryDependency**: false
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
  - 存在对象类型导出, 互操作需注意引用语义
- **sideEffectTest**: 导入 src/data-cleaning/schemas/index.js 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象

### src/data-cleaning/test-integration.js

- **moduleFormat**: cjs
- **sourceHash**: `f64283b696b943c68da1abae6f562487fcab5e00abc25090348f72efc41ef722`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=require, name=SyntaxError, message=Unexpected token ';'
- **filesystemReads** (2):
  - [import] readFileSync -> src/data-cleaning/index.js
  - [import] readFileSync -> src/data-cleaning/agent/index.js
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**:
  - import-time readFileSync -> src/data-cleaning/index.js
  - import-time readFileSync -> src/data-cleaning/agent/index.js
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言 import-time 读取被识别 (2 次); 断言导入失败仍生成合法 Profile (SyntaxError)

### src/data-cleaning/test-multimodal-integration.js

- **moduleFormat**: cjs
- **sourceHash**: `4c9f30cfe68894263a0656da1a8fef4a7a98ea2d5e81e2dd240795d8d8538ffe`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=require, name=SyntaxError, message=Unexpected token ';'
- **filesystemReads** (2):
  - [import] readFileSync -> src/data-cleaning/index.js
  - [import] readFileSync -> src/data-cleaning/agent/index.js
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**:
  - import-time readFileSync -> src/data-cleaning/index.js
  - import-time readFileSync -> src/data-cleaning/agent/index.js
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言 import-time 读取被识别 (2 次); 断言导入失败仍生成合法 Profile (SyntaxError)

### src/data-cleaning/utils/index.js

- **moduleFormat**: cjs
- **sourceHash**: `23c05e1bcf88729b009ab0d1a8a70444f65eb8888c2b31bb487d5a859200252f`
- **importSafe**: true
- **importStrategy**: `CREATE_REQUIRE`
- **exportShape**: `toHalfWidth`, `sanitizePhone`, `sanitizeText`, `sanitizeUrl`, `isValidPhone`, `isValidWechat`, `isValidUrl`, `isValidRating`, `parseAmount`, `parseDate`, `normalizeBudget`, `createLogger`, `findMatchingStyle`, `findMatchingShootType`
- **allowedExports**: `toHalfWidth`, `sanitizePhone`, `sanitizeText`, `sanitizeUrl`, `isValidPhone`, `isValidWechat`, `isValidUrl`, `isValidRating`, `parseAmount`, `parseDate`, `normalizeBudget`, `createLogger`, `findMatchingStyle`, `findMatchingShootType`
- **workingDirectoryDependency**: false
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 导入 src/data-cleaning/utils/index.js 不触发 fs 读写、不创建目录、不读环境变量、不修改全局对象

### src/data-cleaning/utils/test-utils.js

- **moduleFormat**: cjs
- **sourceHash**: `45ee26a6c9ea7f732c8f1af8ddac92849d419ab8a5bd484396fd5d4a93fd5e43`
- **importSafe**: false
- **importStrategy**: `BLOCKED_UNSAFE_IMPORT`
- **exportShape**: (空)
- **allowedExports**: (空 — 需提取纯函数)
- **workingDirectoryDependency**: false
- **importError**: stage=evaluate, name=SyntaxError, message=子进程失败/超时: Unexpected token '=', "
=========="... is not valid JSON
- **filesystemReads**: (无)
- **filesystemWrites**: (无)
- **environmentReads**: (无)
- **globalMutations**: (无)
- **transitiveSideEffects**: (无)
- **runtimeInterop**:
  - CJS module.exports, ESM 需 createRequire 互操作
  - 无 TypeScript 类型声明
- **sideEffectTest**: 断言导入失败仍生成合法 Profile (SyntaxError)
