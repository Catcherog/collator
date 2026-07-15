const BaseWorkflow = require('./base-workflow');

class ResourceOnboardingWorkflow extends BaseWorkflow {
  get name() { return 'resource_onboarding'; }
  get description() { return '资源入驻：模特/化妆师/场地等资源录入'; }

  async execute(input, context = {}) {
    const perception = require('../perception');
    
    let text = input;
    if (typeof input === 'object' &amp;&amp; input.text) {
      text = input.text;
    } else if (typeof input !== 'string') {
      const p = await perception.processInput(input);
      text = p.text;
    }

    const parsed = await this.parseAndValidate(text, 'resource');
    parsed.fields['入驻时间'] = { value: new Date().toISOString().split('T')[0], confidence: 1.0, source: 'auto' };
    parsed.fields['状态'] = { value: '待审核', confidence: 1.0, source: 'auto_default' };

    if (!parsed.fields['资源名称'] &amp;&amp; parsed.fields['客户姓名']) {
      parsed.fields['资源名称'] = parsed.fields['客户姓名'];
    }

    if (parsed.ambiguities.needsUserConfirmation &amp;&amp; !context.autoConfirm) {
      return {
        status: 'needs_confirmation',
        parsed,
        requiresUserInput: true,
        confirmationMessage: this.agent.ui.generateConfirmation(parsed)
      };
    }

    const snapshotId = this.rollback.createSnapshot('resource_onboarding');

    try {
      const resourceFields = this.flatFields(parsed.fields);
      const result = await this.writeRecord('resource', resourceFields, snapshotId);

      return {
        status: 'success',
        records: [{ ...result, action: 'created' }],
        snapshotId
      };
    } catch (err) {
      await this.rollback.rollback(snapshotId);
      throw { message: err.message, rollback: true };
    }
  }
}

module.exports = ResourceOnboardingWorkflow;
