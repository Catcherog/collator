/**
 * import-write-module.cjs — 导入时写入文件夹具
 *
 * require 时创建目录并写文件，审计器应识别为 import-time 写入副作用，
 * importSafe=false。
 */
'use strict';

const fs = require('fs');
const path = require('path');

// import-time 创建目录
const dir = path.join(__dirname, '.import-write-test-dir');
fs.mkdirSync(dir, { recursive: true });

// import-time 写文件
const markerPath = path.join(dir, 'marker.txt');
fs.writeFileSync(markerPath, 'import-time write marker', 'utf-8');

module.exports = {
  writeAtImport: true,
  markerPath: markerPath,
  __name: 'import-write-module',
};
