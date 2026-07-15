const path = require('path');
const fs = require('fs');
const { RuleLearner } = require('../core/rule-learning');

const configDir = __dirname;

function loadJsonConfig(filename) {
  const filePath = path.join(configDir, filename);
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Failed to load config ${filename}:`, error.message);
    return null;
  }
}

let cachedConfig = null;
let ruleLearnerInstance = null;

function loadAllConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }

  const synonyms = loadJsonConfig('synonyms.json');
  const cleaningRules = loadJsonConfig('cleaning-rules.json');

  cachedConfig = {
    synonyms,
    cleaningRules,
    loadedAt: new Date().toISOString()
  };

  return cachedConfig;
}

function getRuleLearner() {
  if (!ruleLearnerInstance) {
    ruleLearnerInstance = new RuleLearner({
      configDir: configDir
    });
  }
  return ruleLearnerInstance;
}

function getSynonyms() {
  const config = loadAllConfig();
  return config.synonyms;
}

function getCleaningRules() {
  const config = loadAllConfig();
  return config.cleaningRules;
}

function getStyleSynonyms(styleName) {
  const synonyms = getSynonyms();
  if (!synonyms || !synonyms.styleSynonyms) return [];
  return synonyms.styleSynonyms[styleName] || [];
}

function getShootTypeMapping() {
  const synonyms = getSynonyms();
  if (!synonyms) return {};
  return synonyms.shootTypeMapping || {};
}

function getFieldFormatRule(fieldType) {
  const rules = getCleaningRules();
  if (!rules || !rules.fieldFormatRules) return null;
  return rules.fieldFormatRules[fieldType] || null;
}

function getStateMachine(machineName) {
  const rules = getCleaningRules();
  if (!rules || !rules.stateMachines) return null;
  return rules.stateMachines[machineName] || null;
}

function getValidationLevel(level) {
  const rules = getCleaningRules();
  if (!rules || !rules.validationLevels) return null;
  return rules.validationLevels[level] || null;
}

function clearCache() {
  cachedConfig = null;
}

module.exports = {
  loadAllConfig,
  getSynonyms,
  getCleaningRules,
  getStyleSynonyms,
  getShootTypeMapping,
  getFieldFormatRule,
  getStateMachine,
  getValidationLevel,
  clearCache,
  getRuleLearner,
  RuleLearner
};
