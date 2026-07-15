const { classifyScene } = require('./scene-classifier');
const { extractFields, extractPhone, extractName, extractChannel, extractShootType, extractBudget, extractStyles, extractDate } = require('./field-extractor');
const { scoreFieldConfidence, scoreOverallConfidence } = require('./confidence-scorer');
const { detectAmbiguities, stringSimilarity } = require('./ambiguity-detector');

module.exports = {
  classifyScene,
  extractFields,
  extractPhone,
  extractName,
  extractChannel,
  extractShootType,
  extractBudget,
  extractStyles,
  extractDate,
  scoreFieldConfidence,
  scoreOverallConfidence,
  detectAmbiguities,
  stringSimilarity
};
