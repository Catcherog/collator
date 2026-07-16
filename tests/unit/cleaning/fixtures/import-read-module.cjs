/**
 * import-read-module.cjs — 导入时读取文件夹具
 *
 * require 时执行 readFileSync，审计器应识别为 import-time 读取副作用，
 * importSafe=false。
 */
'use strict';

const fs = require('fs');
const path = require('path');

// import-time 读取同目录下的 safe-module.cjs
const targetPath = path.join(__dirname, 'safe-module.cjs');
const content = fs.readFileSync(targetPath, 'utf-8');

module.exports = {
  readAtImport: true,
  bytesRead: content.length,
  __name: 'import-read-module',
};
