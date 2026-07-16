/**
 * fs-observer.cjs — 文件系统调用观测钩子
 *
 * 在子进程中 require 本模块后，所有 fs 同步/异步读写函数将被拦截记录。
 * 调用方通过 setPhase('import'|'runtime') 区分导入阶段与运行阶段。
 *
 * 监测函数清单（至少）：
 * readFileSync, readFile, writeFileSync, writeFile,
 * appendFileSync, appendFile, mkdirSync, mkdir,
 * openSync, rmSync, unlinkSync
 */
'use strict';

const fs = require('fs');

const OBSERVED_FNS = [
  'readFileSync',
  'readFile',
  'writeFileSync',
  'writeFile',
  'appendFileSync',
  'appendFile',
  'mkdirSync',
  'mkdir',
  'openSync',
  'rmSync',
  'unlinkSync',
];

const READ_FNS = new Set(['readFileSync', 'readFile']);
const WRITE_FNS = new Set([
  'writeFileSync',
  'writeFile',
  'appendFileSync',
  'appendFile',
  'mkdirSync',
  'mkdir',
  'openSync',
  'rmSync',
  'unlinkSync',
]);

let phase = 'import';
const reads = [];
const writes = [];
let installed = false;

function normalizePath(p) {
  if (typeof p === 'string') return p;
  if (p && typeof p === 'object' && typeof p.toString === 'function') return p.toString();
  return 'unknown';
}

function record(fnName, args) {
  const entry = {
    fn: fnName,
    phase,
    path: normalizePath(args[0]),
  };
  if (READ_FNS.has(fnName)) {
    reads.push(entry);
  } else if (WRITE_FNS.has(fnName)) {
    writes.push(entry);
  }
}

function install() {
  if (installed) return;
  installed = true;
  for (const fnName of OBSERVED_FNS) {
    const original = fs[fnName];
    if (typeof original !== 'function') continue;
    // 使用闭包保存原函数引用
    fs[fnName] = function observedFsFn(...args) {
      record(fnName, args);
      return original.apply(this, args);
    };
  }
}

// 安装即生效
install();

module.exports = {
  setPhase(p) {
    phase = p === 'runtime' ? 'runtime' : 'import';
  },
  getPhase() {
    return phase;
  },
  getReads() {
    return reads.map((r) => ({ ...r }));
  },
  getWrites() {
    return writes.map((w) => ({ ...w }));
  },
  reset() {
    reads.length = 0;
    writes.length = 0;
    phase = 'import';
  },
};
