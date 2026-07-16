/**
 * transitive-side-effect-module.cjs — 传递性副作用夹具
 *
 * 自身不直接操作 fs，但 require 另一个产生 import-time 写入副作用的模块。
 * 审计器应识别间接依赖副作用，importSafe=false。
 */
'use strict';

// 自身不直接 require fs / 不直接操作文件系统
// 但 require 的子模块会在导入时写文件
const sideEffect = require('./import-write-module.cjs');

module.exports = {
  transitive: true,
  fromSideEffect: sideEffect.__name,
  __name: 'transitive-side-effect-module',
};
