import { describe, it, expect } from 'vitest';
import {
  redactPhone,
  redactWechatId,
  redactContent,
  redactObject,
  sanitizeWarningText,
} from '../../../src/server/security/redaction.js';

describe('redactPhone', () => {
  it('masks an 11-digit Chinese mobile number', () => {
    expect(redactPhone('13800138000')).toBe('138****8000');
  });

  it('masks a number with +86 prefix', () => {
    expect(redactPhone('+8613800138000')).toBe('138****8000');
  });

  it('leaves non-phone strings unchanged', () => {
    expect(redactPhone('张三')).toBe('张三');
  });
});

describe('redactWechatId', () => {
  it('preserves first and last two chars and masks the middle', () => {
    // length 16: head "we", tail "01", middle 12 chars masked
    expect(redactWechatId('wechat_secret_01')).toBe('we************01');
  });

  it('masks a typical WeChat ID', () => {
    // length 11: head "zh", tail "01", middle 7 chars masked
    expect(redactWechatId('zhangsan001')).toBe('zh*******01');
  });

  it('fully masks IDs of length 4 (never returns the original secret)', () => {
    expect(redactWechatId('abcd')).toBe('****');
  });

  it('fully masks IDs shorter than 4', () => {
    expect(redactWechatId('abc')).toBe('***');
    expect(redactWechatId('ab')).toBe('**');
    expect(redactWechatId('a')).toBe('*');
  });

  it('returns empty string unchanged', () => {
    expect(redactWechatId('')).toBe('');
  });

  it('handles a length-5 ID (1 middle char masked)', () => {
    // length 5: head "ab", tail "de", middle 1 char
    expect(redactWechatId('abcde')).toBe('ab*de');
  });
});

describe('redactContent', () => {
  it('redacts phones and truncates long content', () => {
    const long = `客户说电话是13800138000，${'x'.repeat(220)}`;
    const result = redactContent(long);
    expect(result).not.toContain('13800138000');
    expect(result).toContain('138****8000');
    expect(result.endsWith('... [truncated]')).toBe(true);
  });
});

describe('redactObject (recursive)', () => {
  it('does not mutate the input object', () => {
    const input = {
      contact: '13800138000',
      nested: { phone: '13900139000' },
    };
    redactObject(input);
    // Input is unchanged.
    expect(input.contact).toBe('13800138000');
    expect(input.nested.phone).toBe('13900139000');
  });

  it('redacts top-level sensitive string keys', () => {
    const result = redactObject({ contact: '13800138000', name: '张三' });
    expect(result.contact).toBe('138****8000');
    expect(result.name).toBe('张三');
  });

  it('redacts nested phone numbers under sensitive keys at any depth', () => {
    const input = {
      candidate: {
        fields: {
          联系方式: '13800138000',
          客户姓名: '张三',
        },
        evidence: {
          contact: '电话13900139000',
        },
      },
    };
    const result = redactObject(input) as Record<string, unknown>;
    const candidate = result.candidate as Record<string, unknown>;
    const fields = candidate.fields as Record<string, unknown>;
    const evidence = candidate.evidence as Record<string, unknown>;
    expect(fields['联系方式']).toBe('138****8000');
    expect(fields['客户姓名']).toBe('张三');
    // `contact` is now a sensitive key; redactContactValue masks the embedded phone.
    expect(evidence['contact']).toBe('电话139****9000');
  });

  it('redacts phone numbers inside arrays of objects', () => {
    const input = {
      duplicate_candidates: [
        { 联系方式: '13800138000' },
        { phone: '13700137000' },
      ],
    };
    const result = redactObject(input) as Record<string, unknown>;
    const arr = result.duplicate_candidates as Array<Record<string, unknown>>;
    expect(arr[0]['联系方式']).toBe('138****8000');
    expect(arr[1].phone).toBe('137****7000');
  });

  it('redacts non-phone WeChat IDs under wechat / 微信 / 联系方式 / contact keys at any depth', () => {
    const input = {
      candidate: {
        fields: {
          wechat: 'zhangsan001',
          微信: 'lisi_model',
          联系方式: 'wx_secret_01',
          客户姓名: '张三',
        },
        evidence: {
          // `contact` is a sensitive contact key; a non-phone WeChat ID
          // must also be masked here at the response boundary.
          contact: 'wechat_secret_01',
        },
      },
    };
    const result = redactObject(input) as Record<string, unknown>;
    const candidate = result.candidate as Record<string, unknown>;
    const fields = candidate.fields as Record<string, unknown>;
    const evidence = candidate.evidence as Record<string, unknown>;
    // Each WeChat ID keeps first/last 2 chars, middle masked.
    // `wx_secret_01` has length 12 → head "wx" + 8 masked + tail "01".
    expect(fields['wechat']).toBe('zh*******01');
    expect(fields['微信']).toBe('li******el');
    expect(fields['联系方式']).toBe('wx********01');
    expect(fields['客户姓名']).toBe('张三');
    // evidence.contact is now a sensitive contact key; WeChat ID is masked too.
    expect(evidence['contact']).toBe('we************01');
  });

  it('redacts WeChat IDs inside arrays of objects under wechat / 微信 / 联系方式', () => {
    const input = {
      duplicate_candidates: [
        { wechat: 'zhangsan001' },
        { 微信: 'lisi_model' },
        { 联系方式: 'wx_secret_01' },
      ],
    };
    const result = redactObject(input) as Record<string, unknown>;
    const arr = result.duplicate_candidates as Array<Record<string, unknown>>;
    expect(arr[0]['wechat']).toBe('zh*******01');
    expect(arr[1]['微信']).toBe('li******el');
    expect(arr[2]['联系方式']).toBe('wx********01');
  });

  it('fully masks short WeChat IDs (length <= 4) under contact keys', () => {
    const input = {
      candidate: {
        fields: {
          wechat: 'abcd', // length 4
          微信: 'wx', // length 2
          联系方式: 'a', // length 1
        },
      },
    };
    const result = redactObject(input) as Record<string, unknown>;
    const candidate = result.candidate as Record<string, unknown>;
    const fields = candidate.fields as Record<string, unknown>;
    expect(fields['wechat']).toBe('****');
    expect(fields['微信']).toBe('**');
    expect(fields['联系方式']).toBe('*');
  });

  it('still masks phone numbers under wechat / 微信 / 联系方式 / contact keys (phone takes precedence)', () => {
    const input = {
      candidate: {
        fields: {
          联系方式: '13800138000',
          wechat: '13900139000',
          微信: '+8613700137000',
        },
        evidence: {
          contact: '电话13800138000',
        },
      },
    };
    const result = redactObject(input) as Record<string, unknown>;
    const candidate = result.candidate as Record<string, unknown>;
    const fields = candidate.fields as Record<string, unknown>;
    const evidence = candidate.evidence as Record<string, unknown>;
    expect(fields['联系方式']).toBe('138****8000');
    expect(fields['wechat']).toBe('139****9000');
    expect(fields['微信']).toBe('137****7000');
    // evidence.contact is a sensitive contact key; redactContactValue masks the embedded phone.
    expect(evidence['contact']).toBe('电话138****8000');
  });

  it('redacts raw-text keys with redactContent (truncation + phone)', () => {
    const longRaw = `电话13800138000${'y'.repeat(220)}`;
    const input = { 原始文本: longRaw, content: longRaw };
    const result = redactObject(input);
    expect(result['原始文本']).not.toContain('13800138000');
    expect(result['原始文本']).toContain('138****8000');
    expect((result['原始文本'] as string).endsWith('... [truncated]')).toBe(true);
    expect(result.content).not.toContain('13800138000');
  });

  it('returns non-object values unchanged through deep traversal', () => {
    const input = { count: 42, flag: true, nil: null };
    const result = redactObject(input);
    expect(result.count).toBe(42);
    expect(result.flag).toBe(true);
    expect(result.nil).toBeNull();
  });
});

describe('redactObject (P0-01 residual: fail-closed contact + context propagation)', () => {
  it('P0-01A: masks a mixed phone+wechat contact string without leaking the wechat ID', () => {
    const input = { contact: '电话13800138000 微信wechat_secret_01' };
    const result = redactObject(input) as Record<string, unknown>;
    const masked = result.contact as string;
    expect(masked).not.toContain('wechat_secret_01');
    expect(masked).not.toContain('13800138000');
    // Mixed/ambiguous → fail closed: whole value masked with `*`.
    expect(masked).toBe('*'.repeat('电话13800138000 微信wechat_secret_01'.length));
  });

  it('P0-01A: preserves pure-phone masking format for "电话13800138000"', () => {
    const input = { contact: '电话13800138000' };
    const result = redactObject(input) as Record<string, unknown>;
    expect(result.contact).toBe('电话138****8000');
  });

  it('P0-01A: preserves pure wechat ID first/last 2 chars rule', () => {
    const input = { contact: 'wechat_secret_01' };
    const result = redactObject(input) as Record<string, unknown>;
    expect(result.contact).toBe('we************01');
  });

  it('P0-01B: redacts contact arrays element-wise using contact redaction (not redactPhone)', () => {
    const input = { fields: { contact: ['wechat_secret_01'] } };
    const result = redactObject(input) as Record<string, unknown>;
    const fields = result.fields as Record<string, unknown>;
    const arr = fields.contact as string[];
    expect(arr[0]).toBe('we************01');
  });

  it('P0-01B: propagates contact context through nested objects/arrays under contact key', () => {
    const input = {
      fields: {
        contact: {
          primary: 'wechat_secret_01',
          alternatives: [
            'wechat_alt_02',
            { label: 'main', value: 'wechat_inner_03' },
          ],
        },
      },
    };
    const result = redactObject(input) as Record<string, unknown>;
    const fields = result.fields as Record<string, unknown>;
    const contact = fields.contact as Record<string, unknown>;
    expect(contact.primary).toBe('we************01');
    const alternatives = contact.alternatives as unknown[];
    expect(alternatives[0]).toBe('we*********02'); // length 13 → 9 middle stars
    const altObj = alternatives[1] as Record<string, unknown>;
    // `label: "main"` (length 4) → fully masked under contact context.
    expect(altObj.label).toBe('****');
    // `value: "wechat_inner_03"` (length 15) → head "we" + 11 stars + tail "03".
    expect(altObj.value).toBe('we***********03');
  });

  it('P0-01B: propagates contact context through 联系方式 key to nested values', () => {
    const input = { 联系方式: { wechat: 'wechat_secret_01', extras: ['wx_alt_04'] } };
    const result = redactObject(input) as Record<string, unknown>;
    const masked = result.联系方式 as Record<string, unknown>;
    expect(masked.wechat).toBe('we************01');
    const extras = masked.extras as string[];
    // `wx_alt_04` length 9 → head "wx" + 5 stars + tail "04".
    expect(extras[0]).toBe('wx*****04');
  });

  it('P0-01B: does not mutate input when redacting contact arrays/objects', () => {
    const input = {
      fields: {
        contact: ['wechat_secret_01', { nested: 'wechat_inner_02' }],
      },
    };
    redactObject(input);
    const fields = input.fields as Record<string, unknown>;
    const arr = fields.contact as unknown[];
    expect(arr[0]).toBe('wechat_secret_01');
    const obj = arr[1] as Record<string, unknown>;
    expect(obj.nested).toBe('wechat_inner_02');
  });

  it('P0-01B: pure phone inside contact array still uses phone masking', () => {
    const input = { contact: ['13800138000', '13900139000'] };
    const result = redactObject(input) as Record<string, unknown>;
    const arr = result.contact as string[];
    expect(arr[0]).toBe('138****8000');
    expect(arr[1]).toBe('139****9000');
  });
});

describe('sanitizeWarningText', () => {
  it('redacts phone numbers embedded in warning text', () => {
    expect(sanitizeWarningText('phone_13800138000_field')).toBe('phone_138****8000_field');
  });

  it('redacts absolute Unix paths', () => {
    expect(sanitizeWarningText('/etc/passwd')).toBe('<PATH>');
    expect(sanitizeWarningText('field /usr/local/bin node')).toBe('field <PATH> node');
  });

  it('redacts absolute Windows paths', () => {
    expect(sanitizeWarningText('C:\\Users\\admin\\secret')).toBe('<PATH>');
  });

  it('leaves normal field names intact', () => {
    expect(sanitizeWarningText('unknown_field')).toBe('unknown_field');
    expect(sanitizeWarningText('style_preferences')).toBe('style_preferences');
  });

  it('leaves normal messages intact (except embedded PII/paths)', () => {
    expect(sanitizeWarningText('未识别的 Candidate 字段: unknown_field')).toBe(
      '未识别的 Candidate 字段: unknown_field'
    );
  });
});

describe('redactObject (P0-01C: parent contact/content mode overrides nested sensitive child keys)', () => {
  it('parent contact mode wins over nested content key', () => {
    // `contact.content` would normally use redactContent (phone-only),
    // leaking a non-phone WeChat ID. Parent contact mode must be
    // authoritative so the WeChat ID is masked via redactContactValue.
    const input = { contact: { content: 'wechat_secret_01' } };
    const result = redactObject(input) as Record<string, unknown>;
    const contact = result.contact as Record<string, unknown>;
    expect(contact.content).toBe('we************01');
    expect(contact.content).not.toBe('wechat_secret_01');
  });

  it('parent contact mode wins over nested phone key', () => {
    const input = { contact: { phone: 'wechat_secret_01' } };
    const result = redactObject(input) as Record<string, unknown>;
    const contact = result.contact as Record<string, unknown>;
    expect(contact.phone).toBe('we************01');
    expect(contact.phone).not.toBe('wechat_secret_01');
  });

  it('parent contact mode wins over nested mobile key', () => {
    const input = { contact: { mobile: 'wechat_secret_01' } };
    const result = redactObject(input) as Record<string, unknown>;
    const contact = result.contact as Record<string, unknown>;
    expect(contact.mobile).toBe('we************01');
  });

  it('parent contact mode wins over nested 原始文本 key under 联系方式', () => {
    const input = { 联系方式: { 原始文本: 'wechat_secret_01' } };
    const result = redactObject(input) as Record<string, unknown>;
    const contact = result.联系方式 as Record<string, unknown>;
    expect(contact.原始文本).toBe('we************01');
  });

  it('parent contact mode wins over nested content key under 联系方式', () => {
    const input = { 联系方式: { content: 'wechat_secret_01' } };
    const result = redactObject(input) as Record<string, unknown>;
    const contact = result.联系方式 as Record<string, unknown>;
    expect(contact.content).toBe('we************01');
  });

  it('parent contact mode propagates through arrays of nested sensitive keys', () => {
    // Array element under contact key contains an object whose key would
    // normally select content/phone mode. Parent contact mode must still
    // win for every descendant string.
    const input = {
      contact: [
        { content: 'wechat_secret_01' },
        { phone: 'wechat_alt_02' },
      ],
    };
    const result = redactObject(input) as Record<string, unknown>;
    const arr = result.contact as Array<Record<string, unknown>>;
    expect(arr[0].content).toBe('we************01');
    expect(arr[1].phone).toBe('we*********02'); // length 13 → 9 middle stars
  });

  it('parent contact mode still masks a real phone under a nested phone key', () => {
    // A genuine phone number under a nested phone key must still be
    // masked; contact redaction masks phones via redactPhone internally.
    const input = { contact: { phone: '13800138000' } };
    const result = redactObject(input) as Record<string, unknown>;
    const contact = result.contact as Record<string, unknown>;
    expect(contact.phone).toBe('138****8000');
  });

  it('parent content mode remains active for ordinary nested phone keys', () => {
    // Content mode stays authoritative for ordinary `phone` children
    // (redactContent = phone masking + truncation). This case intentionally
    // only contains `phone`; nested `contact` upgrade coverage lives in
    // the P0-01D matrix below.
    const longRaw = `电话13800138000${'y'.repeat(220)}`;
    const input = { 原始文本: { phone: longRaw } };
    const result = redactObject(input) as Record<string, unknown>;
    const content = result.原始文本 as Record<string, unknown>;
    const masked = content.phone as string;
    expect(masked).not.toContain('13800138000');
    expect(masked).toContain('138****8000');
    expect(masked.endsWith('... [truncated]')).toBe(true);
  });

  it('does not mutate input when parent mode overrides nested sensitive keys', () => {
    const input = {
      contact: { content: 'wechat_secret_01', phone: 'wechat_alt_02' },
      联系方式: { 原始文本: 'wechat_inner_03' },
    };
    redactObject(input);
    const contact = input.contact as Record<string, unknown>;
    expect(contact.content).toBe('wechat_secret_01');
    expect(contact.phone).toBe('wechat_alt_02');
    const cn = input.联系方式 as Record<string, unknown>;
    expect(cn.原始文本).toBe('wechat_inner_03');
  });
});

describe('redactObject (P0-01D: nested contact semantics upgrade beneath content parent)', () => {
  // Inherited content mode must not downgrade a nested contact/WeChat key.
  // Contact sensitivity is monotonic: contact > content > default. Any
  // descendant string beneath a content parent that hits a nested contact
  // key (contact / 联系方式 / wechat / 微信) must upgrade to contact mode
  // so non-phone WeChat IDs are masked instead of leaking through
  // redactContent (which only masks phone numbers).
  it.each([
    {
      name: 'content.contact',
      input: { content: { contact: 'wechat_secret_01' } },
    },
    {
      name: 'content.wechat through an array',
      input: { content: [{ wechat: 'wechat_secret_01' }] },
    },
    {
      name: '原始文本.联系方式',
      input: { 原始文本: { 联系方式: 'wechat_secret_01' } },
    },
    {
      name: 'multi-depth content to 微信',
      input: { content: { nested: { 微信: 'wechat_secret_01' } } },
    },
  ])('upgrades nested contact semantics under $name', ({ input }) => {
    const before = structuredClone(input);
    const result = redactObject(input);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('wechat_secret_01');
    expect(serialized).toContain('we************01');
    expect(input).toEqual(before);
    expect(redactObject(input)).toEqual(result);
  });
});

describe('redactObject (P0-04: structural identifiers preserved at response boundary)', () => {
  it('preserves the exact failing ingestion_id byte-for-byte', () => {
    // This ID triggered P0-04: the 11-digit substring `19181507170`
    // matches the phone pattern and was masked to `191****7170`.
    const failingId = 'ing_2e042890392546c19181507170127599';
    const input = { ingestion_id: failingId };
    const result = redactObject(input) as Record<string, unknown>;
    expect(result.ingestion_id).toBe(failingId);
  });

  it('preserves a 32-char hex UUID without dashes', () => {
    const hex32 = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
    const input = { review_record_id: hex32 };
    const result = redactObject(input) as Record<string, unknown>;
    expect(result.review_record_id).toBe(hex32);
  });

  it('preserves a canonical UUID with dashes', () => {
    const uuid = 'a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6';
    const input = { review_record_id: uuid };
    const result = redactObject(input) as Record<string, unknown>;
    expect(result.review_record_id).toBe(uuid);
  });

  it('preserves a 64-char SHA-256 idempotency key', () => {
    const sha256 =
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const input = { idempotency_key: sha256 };
    const result = redactObject(input) as Record<string, unknown>;
    expect(result.idempotency_key).toBe(sha256);
  });

  it('preserves prefixed opaque IDs (rec_001, reviewer_1, etc.)', () => {
    const input = {
      source_record_id: 'rec_001',
      reviewer_id: 'reviewer_1',
      workflow_run_id: 'run_001',
    };
    const result = redactObject(input);
    expect(result.source_record_id).toBe('rec_001');
    expect(result.reviewer_id).toBe('reviewer_1');
    expect(result.workflow_run_id).toBe('run_001');
  });

  it('still masks a phone number embedded in free-text under a non-sensitive key', () => {
    // Free-text with spaces must NOT be treated as a structural ID;
    // embedded phone numbers must still be masked.
    const input = { notes: 'call me at 13800138000 tomorrow' };
    const result = redactObject(input) as Record<string, unknown>;
    expect(result.notes).toBe('call me at 138****8000 tomorrow');
  });

  it('still masks a pure phone number under a non-sensitive key', () => {
    const input = { budget: '13800138000' };
    const result = redactObject(input) as Record<string, unknown>;
    expect(result.budget).toBe('138****8000');
  });

  it('does not mutate input when preserving structural IDs', () => {
    const failingId = 'ing_2e042890392546c19181507170127599';
    const input = { ingestion_id: failingId, notes: '13800138000' };
    redactObject(input);
    expect(input.ingestion_id).toBe(failingId);
    expect(input.notes).toBe('13800138000');
  });
});

describe('redactObject (P0-04B: untrusted fields/evidence cannot bypass phone redaction via ID-shaped values)', () => {
  // Value shape alone is not proof of a structural ID. Preservation
  // additionally requires that the current key is a trusted contract ID
  // field. Attacker-controlled unknown Candidate/evidence strings must
  // continue through redactPhone even when they match `<alpha>_<alphanumeric>`.
  it('does not treat structural-looking values in untrusted fields as trusted IDs', () => {
    const input = {
      raw_candidate: {
        fields: {
          unknown_field: 'note_13900139000',
          nested: ['proof_13700137000'],
        },
        evidence: {
          unknown_field: 'trace_13600136000',
        },
      },
    };
    const before = structuredClone(input);
    const result = redactObject(input) as typeof input;

    expect(result.raw_candidate.fields.unknown_field).toBe(
      'note_139****9000'
    );
    expect(result.raw_candidate.fields.nested[0]).toBe(
      'proof_137****7000'
    );
    expect(result.raw_candidate.evidence.unknown_field).toBe(
      'trace_136****6000'
    );
    expect(input).toEqual(before);
    expect(redactObject(input)).toEqual(result);
  });
});
