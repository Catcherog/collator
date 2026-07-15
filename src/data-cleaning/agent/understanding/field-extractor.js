const confidenceScorer = require('./confidence-scorer');

const PHONE_REGEX = /(1[3-9]\d{9})/g;
const DATE_PATTERNS = [
  { regex: /(今天|明天|后天)/g, handler: 'relative' },
  { regex: /(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/g, handler: 'ymd' },
  { regex: /(\d{1,2})月(\d{1,2})[日号]/g, handler: 'md' },
  { regex: /这(周末|周|周六|周日|周末)/g, handler: 'weekend' },
  { regex: /下(周末|周|周六|周日)/g, handler: 'next_weekend' }
];

const BUDGET_PATTERNS = [
  { regex: /(\d{3,5})\s*[元块]?\s*(左右|上下|大概|差不多)/, map: 'range' },
  { regex: /预算\s*(\d{3,5})/, map: 'range' },
  { regex: /(\d{3,5})\s*[-~到]\s*(\d{3,5})/, map: 'range_exact' },
  { regex: /一千多|1000多/, value: '1000-2000元' },
  { regex: /两千多|2000多/, value: '2000-3000元' },
  { regex: /三千多|3000多/, value: '3000-5000元' },
  { regex: /几百块|几百|便宜|学生/, value: '1000元以下' },
  { regex: /不差钱|高端|vip|豪华/, value: '5000元以上' }
];

const CHANNEL_KEYWORDS = {
  '小红书': ['小红书', 'red', '红色软件', '种草', '笔记平台'],
  '抖音': ['抖音', 'douyin', '抖', '短视频'],
  '视频号': ['视频号', '微信视频号'],
  '朋友圈': ['朋友圈', 'pyq', '朋友推荐', '转发'],
  '老客转介绍': ['老客介绍', '朋友介绍', '熟人介绍', '转介绍', '回头客', '朋友推荐的'],
  '线下': ['线下', '门店', '路过', '实体店', '地推', '展会', '活动'],
  '其他': ['百度', '美团', '大众点评']
};

const SHOOT_TYPE_KEYWORDS = {
  '亲子': ['亲子', '宝宝', '儿童', '全家福', '周岁', '百天', '满月', '母女', '父子', '宝妈'],
  '商业拍摄': ['商业', '产品', '形象照', '职业照', '团队照', '电商', '企业'],
  '创作片': ['写真', '艺术照', '个人写真', '创作', '模特约拍', '约拍', '个人']
};

const STYLE_KEYWORDS = {
  '日系清新': ['日系', '清新', '小清新', '日式', '森系', '自然光', '明亮', '治愈', '干净'],
  '韩系唯美': ['韩系', '韩式', '唯美', '浪漫', '温柔', '仙女', '仙气', '精致'],
  '复古胶片': ['复古', '胶片', '怀旧', '港风', '电影感', '年代感', '经典'],
  '暗调情绪': ['暗调', '情绪', '暗黑', '高级感', '质感', '冷淡风', '酷', '个性', '情绪片'],
  '法式浪漫': ['法式', '浪漫', '油画', '宫廷', '优雅', '公主风', '华丽', '梦幻'],
  '国潮古风': ['国潮', '古风', '汉服', '中式', '古典', '传统', '东方', '武侠']
};

function extractPhone(text) {
  const matches = text.match(PHONE_REGEX);
  if (matches &amp;&amp; matches.length &gt; 0) {
    return { value: matches[0], confidence: 0.99, source: matches[0] };
  }
  return null;
}

function extractName(text) {
  const patterns = [
    /我叫([^\s,，。、！!]{2,4})/,
    /名字是([^\s,，。、！!]{2,4})/,
    /叫([^\s,，。、！!]{2,4})[，,。\s]/,
    /([^\s,，。、！!]{2,3})[，,]?想拍/,
    /客户[是:：-]?\s*([^\s,，。、！!]{2,4})/,
    /姓名[是:：]?\s*([^\s,，。、！!]{2,4})/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return { value: match[1].trim(), confidence: 0.85, source: match[0] };
    }
  }
  return null;
}

function extractChannel(text) {
  const lowerText = text.toLowerCase();
  for (const [channel, keywords] of Object.entries(CHANNEL_KEYWORDS)) {
    for (const kw of keywords) {
      if (lowerText.includes(kw.toLowerCase())) {
        return { value: channel, confidence: 0.9, source: kw };
      }
    }
  }
  return null;
}

function extractShootType(text) {
  const lowerText = text.toLowerCase();
  for (const [type, keywords] of Object.entries(SHOOT_TYPE_KEYWORDS)) {
    for (const kw of keywords) {
      if (lowerText.includes(kw.toLowerCase())) {
        return { value: type, confidence: 0.9, source: kw };
      }
    }
  }
  return null;
}

function extractBudget(text) {
  for (const pattern of BUDGET_PATTERNS) {
    if (pattern.value) {
      if (pattern.regex.test(text)) {
        return { value: pattern.value, confidence: 0.85, source: pattern.regex.toString() };
      }
    } else if (pattern.map === 'range') {
      const match = text.match(pattern.regex);
      if (match) {
        const amount = parseInt(match[1]);
        let range;
        if (amount &lt; 1000) range = '1000元以下';
        else if (amount &lt; 2000) range = '1000-2000元';
        else if (amount &lt; 3000) range = '2000-3000元';
        else if (amount &lt; 5000) range = '3000-5000元';
        else range = '5000元以上';
        return { value: range, confidence: 0.88, source: match[0] };
      }
    }
  }
  return null;
}

function extractStyles(text) {
  const styles = [];
  const lowerText = text.toLowerCase();
  for (const [style, keywords] of Object.entries(STYLE_KEYWORDS)) {
    for (const kw of keywords) {
      if (lowerText.includes(kw.toLowerCase())) {
        styles.push({ value: style, confidence: 0.9, source: kw });
        break;
      }
    }
  }
  return styles.length &gt; 0 ? styles : null;
}

function extractDate(text) {
  const today = new Date();
  
  if (text.includes('今天')) {
    return { value: today.toISOString().split('T')[0], confidence: 0.95, source: '今天' };
  }
  if (text.includes('明天')) {
    const d = new Date(today); d.setDate(d.getDate() + 1);
    return { value: d.toISOString().split('T')[0], confidence: 0.95, source: '明天' };
  }
  if (text.includes('后天')) {
    const d = new Date(today); d.setDate(d.getDate() + 2);
    return { value: d.toISOString().split('T')[0], confidence: 0.95, source: '后天' };
  }

  const ymd = text.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (ymd) {
    return { 
      value: `${ymd[1]}-${String(ymd[2]).padStart(2,'0')}-${String(ymd[3]).padStart(2,'0')}`, 
      confidence: 0.98, 
      source: ymd[0] 
    };
  }

  const md = text.match(/(\d{1,2})月(\d{1,2})[日号]/);
  if (md) {
    return {
      value: `${today.getFullYear()}-${String(md[1]).padStart(2,'0')}-${String(md[2]).padStart(2,'0')}`,
      confidence: 0.8,
      source: md[0]
    };
  }

  return null;
}

function extractFields(text, schema) {
  if (!text || !schema) {
    return { fields: {}, missing: [], raw: {} };
  }

  const fields = {};
  const raw = {};
  const missing = [];

  const phone = extractPhone(text);
  if (phone) {
    fields['联系方式'] = { ...phone, fieldMeta: schema.fields?.find(f =&gt; f.fieldName === '联系方式') };
    raw['联系方式'] = phone;
  }

  const name = extractName(text);
  if (name) {
    fields['客户姓名'] = { ...name, fieldMeta: schema.fields?.find(f =&gt; f.fieldName === '客户姓名') };
    raw['客户姓名'] = name;
  }

  const channel = extractChannel(text);
  if (channel) {
    fields['来源渠道'] = { ...channel, fieldMeta: schema.fields?.find(f =&gt; f.fieldName === '来源渠道') };
    raw['来源渠道'] = channel;
  }

  const shootType = extractShootType(text);
  if (shootType) {
    const typeField = schema.fields?.find(f =&gt; f.fieldName === '拍摄类型' || f.fieldName === '项目类型');
    if (typeField) {
      let mappedType = shootType.value;
      if (typeField.enumValues &amp;&amp; !typeField.enumValues.includes(mappedType)) {
        if (typeField.enumValues.includes('客片')) mappedType = '客片';
      }
      fields[typeField.fieldName] = { ...shootType, value: mappedType, fieldMeta: typeField };
      raw[typeField.fieldName] = { ...shootType, value: mappedType };
    } else {
      fields['拍摄类型'] = { ...shootType, fieldMeta: null };
    }
  }

  const budget = extractBudget(text);
  if (budget) {
    fields['预算区间'] = { ...budget, fieldMeta: schema.fields?.find(f =&gt; f.fieldName === '预算区间') };
    raw['预算区间'] = budget;
  }

  const styles = extractStyles(text);
  if (styles) {
    const styleField = schema.fields?.find(f =&gt; f.fieldName === '意向风格' || f.fieldName === '拍摄风格');
    if (styleField) {
      fields[styleField.fieldName] = { 
        value: styles.map(s =&gt; s.value), 
        confidence: styles.reduce((a, b) =&gt; a + b.confidence, 0) / styles.length,
        source: styles.map(s =&gt; s.source).join(', '),
        fieldMeta: styleField
      };
      raw[styleField.fieldName] = fields[styleField.fieldName];
    }
  }

  const date = extractDate(text);
  if (date) {
    const dateField = schema.fields?.find(f =&gt; f.fieldName === '咨询时间' || f.fieldName === '拍摄日期');
    if (dateField) {
      fields[dateField.fieldName] = { ...date, fieldMeta: dateField };
    } else {
      fields['咨询时间'] = { ...date, fieldMeta: null };
    }
    raw['日期'] = date;
  }

  if (schema.fields) {
    for (const field of schema.fields) {
      if (field.required &amp;&amp; !fields[field.fieldName] &amp;&amp; field.type !== 'auto_number') {
        if (!['项目负责人', '参与人员', '关联客户 ID'].includes(field.fieldName)) {
          missing.push(field.fieldName);
        }
      }
    }
  }

  return { fields, missing, raw };
}

module.exports = {
  extractFields,
  extractPhone,
  extractName,
  extractChannel,
  extractShootType,
  extractBudget,
  extractStyles,
  extractDate
};
