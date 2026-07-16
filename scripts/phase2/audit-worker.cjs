/**
 * audit-worker.cjs — Phase 2A 隔离子进程审计 worker
 *
 * 由 audit-legacy-modules.ts 为每个旧模块 spawn 一个独立子进程运行。
 * 在独立临时工作目录中 require 目标模块，捕获真实副作用。
 *
 * 参数：
 *   --target=<absolute path>   目标模块绝对路径
 *   --observer=<absolute path>  fs-observer.cjs 绝对路径
 *   --repoRoot=<absolute path>  仓库根目录绝对路径
 *
 * 输出：单行 JSON 到 stdout
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

// ---- 强制 .js 文件按 CJS 加载 ----
// 项目 package.json 含 "type": "module"，导致 Node.js 将所有 .js 文件视为 ESM。
// 但 src/data-cleaning 下的旧模块全部为 CJS（使用 require/module.exports）。
// 覆盖 Module._extensions['.js'] 使其跳过 ESM 检测，直接用 _compile 编译为 CJS。
// 本 worker 运行在隔离子进程中，仅用于审计，覆盖全局行为是安全的。
const originalJsHandler = Module._extensions['.js'];
Module._extensions['.js'] = function compileAsCJS(module, filename) {
  const content = fs.readFileSync(filename, 'utf8');
  module._compile(content, filename);
};

// ---- 参数解析 ----
function getArg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

const targetPath = getArg('target');
const observerPath = getArg('observer');
const repoRoot = getArg('repoRoot');

if (!targetPath || !observerPath || !repoRoot) {
  process.stderr.write('missing required args: --target, --observer, --repoRoot\n');
  process.exit(2);
}

// ---- 路径脱敏工具 ----
function toRepoRelative(p) {
  if (!p || typeof p !== 'string') return 'unknown';
  const normalized = path.resolve(p);
  const root = path.resolve(repoRoot);
  if (normalized.startsWith(root)) {
    const rel = normalized.slice(root.length).replace(/\\/g, '/');
    return rel.replace(/^\//, '');
  }
  return normalized.replace(/\\/g, '/');
}

function sanitizeMessage(msg) {
  if (!msg || typeof msg !== 'string') return String(msg || '');
  const root = path.resolve(repoRoot);
  return msg.split(root).join('<repo>');
}

// ---- 安装 fs 观察器 ----
const observer = require(observerPath);
observer.reset();
observer.setPhase('import');

// ---- 环境变量读取追踪 ----
const envReads = new Set();
let envProxyInstalled = false;
try {
  const realEnv = process.env;
  const handler = {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && !['toString', 'valueOf', 'constructor', '__proto__', 'toJSON', 'inspect'].includes(prop)) {
        envReads.add(prop);
      }
      return Reflect.get(target, prop, receiver);
    },
  };
  const proxied = new Proxy(realEnv, handler);
  Object.defineProperty(process, 'env', {
    value: proxied,
    writable: true,
    configurable: true,
  });
  envProxyInstalled = true;
} catch (_e) {
  // 无法安装代理，跳过 env 追踪
}

// ---- 全局键快照 ----
const globalBefore = new Set(Object.getOwnPropertyNames(global));

// ---- process.cwd 追踪 ----
let cwdCalled = false;
const realCwd = process.cwd;
process.cwd = function trackedCwd() {
  cwdCalled = true;
  return realCwd.call(process);
};

// ---- require 目标模块 ----
// 清除缓存确保全新加载
delete require.cache[require.resolve(targetPath)];

// 快照 require.cache keys（模块加载前），用于后续过滤模块系统自身的文件读取
const requireCacheBefore = new Set(Object.keys(require.cache));

let moduleExports = null;
let exportShape = [];
let exportEntries = [];
let importError = null;

try {
  moduleExports = require(targetPath);
  if (moduleExports && typeof moduleExports === 'object') {
    exportShape = Object.keys(moduleExports);
    for (const key of exportShape) {
      const val = moduleExports[key];
      const type = typeof val;
      exportEntries.push({ name: key, type });
    }
  } else {
    exportShape = ['default'];
    exportEntries.push({ name: 'default', type: typeof moduleExports });
  }
} catch (err) {
  importError = {
    stage: 'require',
    name: err.name || 'Error',
    code: err.code,
    message: sanitizeMessage(err.message),
  };
}

// ---- 切换到 runtime 阶段 ----
observer.setPhase('runtime');

// ---- 全局变异检测 ----
const globalAfter = new Set(Object.getOwnPropertyNames(global));
const globalMutations = [...globalAfter].filter((k) => !globalBefore.has(k));

// ---- 恢复 process.cwd ----
process.cwd = realCwd;

// ---- 构建结果 ----
const rawReads = observer.getReads();
const rawWrites = observer.getWrites();

// 收集所有由 require() 模块加载系统读取的文件路径（目标模块自身 + 传递依赖），
// 这些读取不是模块代码的显式副作用，需过滤掉。
const moduleLoadedPaths = new Set();
for (const cacheKey of Object.keys(require.cache)) {
  if (!requireCacheBefore.has(cacheKey)) {
    moduleLoadedPaths.add(toRepoRelative(cacheKey));
  }
}
// 目标模块自身路径也加入过滤集
const targetRelPath = toRepoRelative(targetPath);
moduleLoadedPaths.add(targetRelPath);

const result = {
  exportShape,
  exportEntries,
  importError,
  filesystemReads: rawReads
    .map((r) => ({
      fn: r.fn,
      phase: r.phase,
      path: toRepoRelative(r.path),
    }))
    .filter((r) => !moduleLoadedPaths.has(r.path)),
  filesystemWrites: rawWrites.map((w) => ({
    fn: w.fn,
    phase: w.phase,
    path: toRepoRelative(w.path),
  })),
  environmentReads: [...envReads].filter(
    (k) => !['NODE_OPTIONS', 'NODE_PATH', 'PATH', 'PATHEXT', 'USERPROFILE', 'WINDIR', 'SYSTEMROOT', 'TEMP', 'TMP', 'OS', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS', 'COMPUTERNAME', 'USERDOMAIN', 'USERNAME', 'APPDATA', 'LOCALAPPDATA', 'ProgramFiles', 'ProgramData', 'SystemDrive', 'SystemRoot', 'PUBLIC'].includes(k)
  ),
  globalMutations,
  workingDirectoryDependency: cwdCalled,
  envProxyInstalled,
};

// 输出单行 JSON
process.stdout.write(JSON.stringify(result));
