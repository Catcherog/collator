/**
 * safe-module.cjs — 安全模块夹具
 *
 * 无文件系统操作，导出纯函数。审计器应将其标记为 importSafe=true。
 */
'use strict';

function pureAdd(a, b) {
  return a + b;
}

function pureEcho(x) {
  return x;
}

module.exports = {
  pureAdd,
  pureEcho,
  __name: 'safe-module',
};
