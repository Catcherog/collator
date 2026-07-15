const fs = require('fs');
const path = require('path');

async function extractText(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return { success: false, text: '', error: 'Invalid file path' };
  }

  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  
  if (!fs.existsSync(absolutePath)) {
    return { success: false, text: '', error: `File not found: ${absolutePath}` };
  }

  const ext = path.extname(absolutePath).toLowerCase();

  try {
    if (ext === '.txt' || ext === '.csv' || ext === '.json' || ext === '.md') {
      const text = fs.readFileSync(absolutePath, 'utf-8');
      return { success: true, text, metadata: { ext, size: fs.statSync(absolutePath).size } };
    }

    if (ext === '.docx') {
      try {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ path: absolutePath });
        return { 
          success: true, 
          text: result.value, 
          metadata: { ext, warnings: result.warnings } 
        };
      } catch (e) {
        return { 
          success: false, 
          text: '', 
          error: 'DOCX parsing requires mammoth package. Install with: npm install mammoth',
          fallback: 'Manual text extraction needed'
        };
      }
    }

    if (ext === '.xlsx' || ext === '.xls') {
      return {
        success: false,
        text: '',
        error: 'Excel parsing requires dedicated CSV export or xlsx package',
        suggestion: 'Please export as CSV first for batch import'
      };
    }

    if (ext === '.pdf') {
      return {
        success: false,
        text: '',
        error: 'PDF parsing not directly supported',
        suggestion: 'Please copy text content or use OCR for scanned PDFs'
      };
    }

    const text = fs.readFileSync(absolutePath, 'utf-8');
    return { success: true, text, metadata: { ext: 'unknown', size: fs.statSync(absolutePath).size } };
  } catch (err) {
    return { success: false, text: '', error: err.message };
  }
}

module.exports = {
  extractText
};
