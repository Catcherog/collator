const { classifyInput, isImagePath, isAudioPath, isDocumentPath, isChatLog, isBatchData } = require('./input-classifier');
const { processInput } = require('./dispatcher');
const docParser = require('./doc-parser');

module.exports = {
  classifyInput,
  isImagePath,
  isAudioPath,
  isDocumentPath,
  isChatLog,
  isBatchData,
  processInput,
  extractDocumentText: docParser.extractText
};
