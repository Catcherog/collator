const BaseWorkflow = require('./base-workflow');

class CustomerConsultationWorkflow extends BaseWorkflow {
  get name() { return 'customer_consultation'; }
  get description() { return '客户咨询入库：客户表+项目表联动'; }

  async execute(input, context = {}) {
    const perception = require('../perception');
    
    let text = input;
    let perceptionResult = null;

    if (typeof input === 'object' &amp;&amp; input.text) {
      text = input.text;
      perceptionResult = input;
    } else if (typeof input !== 'string') {
      perceptionResult = await perception.processInput(input);
      text = perceptionResult.text;
    }

    if (!text || text.trim().length === 0) {
      throw new Error('无法获取文本内容进行解析');
    }

    const parsed = await this.parseAndValidate(text, 'customer');
    
    if (!parsed.fields['联系方式']) {
      parsed.missing.push('联系方式');
      parsed.ambiguities.issues.push({
        type: 'missing_required',
        field: '联系方式',
        message: '缺少必填字段: 联系方式（手机号）',
        severity: 'error',
        blocking: true
      });
      parsed.ambiguities.blockingIssues.push({
        type: 'missing_required',
        field: '联系方式'
      });
    }

    parsed.fields['咨询时间'] = {
      value: new Date().toISOString().split('T')[0],
      confidence: 1.0,
      source: 'auto_generated'
    };

    parsed.fields['客户状态'] = {
      value: '待跟进',
      confidence: 1.0,
      source: 'auto_default'
    };

    if (parsed.ambiguities.needsUserConfirmation &amp;&amp; !context.autoConfirm) {
      return {
        status: 'needs_confirmation',
        parsed,
        requiresUserInput: true,
        confirmationMessage: this.agent.ui.generateConfirmation(parsed)
      };
    }

    const snapshotId = this.rollback.createSnapshot('customer_consultation');
    const records = [];
    const warnings = [];

    try {
      let customerRecordId = null;
      const phone = parsed.fields['联系方式']?.value;

      if (phone) {
        const dupCheck = await this.linkage.checkDuplicatePhone(phone, 'customer');
        if (dupCheck.isDuplicate &amp;&amp; !context.allowDuplicate) {
          warnings.push(`手机号 ${phone} 已存在，将更新现有记录而非创建新客户`);
          customerRecordId = dupCheck.existingRecordId;
        }
      }

      const customerFields = this.flatFields({
        '客户姓名': parsed.fields['客户姓名'],
        '联系方式': parsed.fields['联系方式'],
        '来源渠道': parsed.fields['来源渠道'],
        '咨询时间': parsed.fields['咨询时间'],
        '客户状态': parsed.fields['客户状态'],
        '意向风格': parsed.fields['意向风格']
      });

      if (customerRecordId) {
        await this.writer.updateRecord(this.writer.getTableId('customer'), customerRecordId, { fields: customerFields });
        records.push({ tableId: this.writer.getTableId('customer'), recordId: customerRecordId, tableName: 'customer', action: 'updated' });
      } else {
        const customerResult = await this.writeRecord('customer', customerFields, snapshotId);
        customerRecordId = customerResult.recordId;
        records.push({ ...customerResult, action: 'created' });
      }

      const projectFields = this.flatFields({
        '项目名称': parsed.fields['客户姓名'] ? `${parsed.fields['客户姓名'].value}的咨询` : '新客户咨询',
        '拍摄类型': parsed.fields['拍摄类型'] || parsed.fields['项目类型'],
        '预算区间': parsed.fields['预算区间'],
        '意向风格': parsed.fields['意向风格'],
        '关联客户 ID': [customerRecordId],
        '项目状态': '待跟进'
      });

      const projectResult = await this.writeRecord('project', projectFields, snapshotId);
      records.push({ ...projectResult, action: 'created' });

      const linkageResult = await this.linkage.executeLinkages({
        tableId: projectResult.tableId,
        recordId: projectResult.recordId,
        fields: projectFields,
        scene: 'customer_consultation'
      }, {
        snapshotId,
        customerRecordId
      });

      return {
        status: 'success',
        records,
        linkages: linkageResult,
        warnings,
        snapshotId
      };
    } catch (err) {
      await this.rollback.rollback(snapshotId);
      throw {
        message: err.message,
        code: err.code || 'WORKFLOW_ERROR',
        diagnosis: '客户咨询入库流程失败',
        suggestion: ['检查字段格式是否正确', '检查飞书API连接状态', '检查必填字段是否完整'],
        rollback: true
      };
    }
  }
}

module.exports = CustomerConsultationWorkflow;
