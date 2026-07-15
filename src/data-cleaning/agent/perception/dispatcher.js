const path = require('path');
const { classifyInput } = require('./input-classifier');
const docParser = require('./doc-parser');

let ocrModule = null;
let asrModule = null;
let clipModule = null;

try { ocrModule = require('../../multimodal/ocr'); } catch (e) {}
try { asrModule = require('../../multimodal/asr'); } catch (e) {}
try { clipModule = require('../../multimodal/clip'); } catch (e) {}

async function processInput(input, options = {}) {
  const classification = classifyInput(input);
  const result = {
    originalType: classification.type,
    text: '',
    metadata: { ...classification.metadata, classification },
    multimodalResults: {}
  };

  switch (classification.type) {
    case 'text':
      result.text = typeof input === 'string' ? input.trim() : String(input);
      break;

    case 'image':
      if (ocrModule) {
        try {
          const ocrResult = await ocrModule.extractText(classification.metadata.path, {
            engine: options.ocrEngine || 'feishu',
            fallback: true,
            confidenceThreshold: 0.7
          });
          result.text = ocrResult.text || '';
          result.multimodalResults.ocr = ocrResult;
        } catch (err) {
          result.error = `OCR failed: ${err.message}`;
          if (ocrModule.tesseractAdapter) {
            try {
              const fallback = await ocrModule.tesseractAdapter.extractText(classification.metadata.path);
              result.text = fallback.text || '';
              result.multimodalResults.ocrFallback = fallback;
            } catch (e) {}
          }
        }
      } else {
        result.error = 'OCR module not available';
        result.text = '';
      }
      break;

    case 'audio':
      if (asrModule &amp;&amp; asrModule.transcribe) {
        try {
          const asrResult = await asrModule.transcribe(classification.metadata.path);
          result.text = asrResult.text || '';
          result.multimodalResults.asr = asrResult;
        } catch (err) {
          result.error = `ASR failed: ${err.message}`;
        }
      } else {
        result.error = 'ASR module not available';
      }
      break;

    case 'document':
      try {
        const docResult = await docParser.extractText(classification.metadata.path);
        result.text = docResult.text || '';
        result.multimodalResults.document = docResult;
        if (!docResult.success) {
          result.error = docResult.error;
        }
      } catch (err) {
        result.error = `Document parsing failed: ${err.message}`;
      }
      break;

    case 'chat_log':
      result.text = typeof input === 'string' ? input.trim() : '';
      result.metadata.isChatLog = true;
      break;

    case 'batch':
      result.text = typeof input === 'string' ? input : JSON.stringify(input);
      result.metadata.isBatch = true;
      break;

    default:
      result.text = typeof input === 'string' ? input : JSON.stringify(input);
      result.warning = `Unknown input type: ${classification.type}`;
  }

  return result;
}

module.exports = {
  processInput
};
