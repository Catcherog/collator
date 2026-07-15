const BaseWorkflow = require('./base-workflow');

class NamecardOCRWorkflow extends BaseWorkflow {
  get name() { return 'namecard_ocr'; }
  get description() { return '名片OCR识别：从名片图片提取信息录入资源表'; }

  async execute(input, context = {}) {
    const perception = require('../perception');
    
    if (typeof input === 'string') {
      input = { imagePath: input };
    }

    const pResult = await perception.processInput(input);
    const text = pResult.text;

    if (!text || text.length &lt; 5) {
      throw new Error('OCR识别结果为空或内容过短，请检查图片质量');
    }

    const parsed = await this.parseAndValidate(text, 'resource');
    parsed.fields['资源类型'] = { value: '人力资源', confidence: 0.9, source: 'namecard_default' };
    parsed.fields['入驻时间'] = { value: new Date().toISOString().split('T')[0], confidence: 1.0, source: 'auto' };
    parsed.fields['状态'] = { value: '待审核', confidence: 1.0, source: 'auto_default' };

    const phone = require('../understanding/field-extractor').extractPhone(text);
    if (phone) {
      parsed.fields['联系方式'] = phone;
    }

    const name = this.extractNameFromCard(text);
    if (name &amp;&amp; !parsed.fields['资源名称']) {
      parsed.fields['资源名称'] = { value: name, confidence: 0.8, source: 'ocr_extract' };
    }

    if (parsed.ambiguities.needsUserConfirmation &amp;&amp; !context.autoConfirm) {
      return {
        status: 'needs_confirmation',
        parsed,
        ocrText: text,
        requiresUserInput: true,
        confirmationMessage: this.agent.ui.generateConfirmation(parsed)
      };
    }

    const snapshotId = this.rollback.createSnapshot('namecard_ocr');

    try {
      const resourceFields = this.flatFields(parsed.fields);
      const result = await this.writeRecord('resource', resourceFields, snapshotId);

      return {
        status: 'success',
        records: [{ ...result, action: 'created' }],
        ocrText: text,
        snapshotId
      };
    } catch (err) {
      await this.rollback.rollback(snapshotId);
      throw { message: err.message, rollback: true };
    }
  }

  extractNameFromCard(text) {
    const lines = text.split('\n').map(l =&gt; l.trim()).filter(l =&gt; l.length &gt; 0);
    for (const line of lines) {
      if (line.length &lt;= 4 &amp;&amp; /^[\u4e00-\u9fa5]+$/.test(line)) {
        return line;
      }
    }
    return null;
  }
}

module.exports = NamecardOCRWorkflow;
