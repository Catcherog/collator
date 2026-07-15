const SCENARIOS = {
  customer_consultation: {
    keywords: ['咨询', '加微信', '想拍', '预算', '风格', '了解', '问一下', '怎么收费', '多少钱', '微信', '手机号', '电话', '想了解', '宝妈', '准新娘', '周岁', '百天', '宝宝', '亲子'],
    weight: 1,
    tableKeys: ['customer', 'project'],
    primaryTable: 'customer'
  },
  order_creation: {
    keywords: ['下单', '签约', '合同', '付款', '定金', '预约', '定了', '确认订单', '签单', '交定金', '付了', '成交'],
    weight: 1.2,
    tableKeys: ['project'],
    primaryTable: 'project'
  },
  resource_onboarding: {
    keywords: ['名片', '化妆师', '模特', '场地', '影棚', '报价', '合作', '资源', '妆造', '修图师', '摄影师', '租赁', '互勉', '经纪人'],
    weight: 1,
    tableKeys: ['resource'],
    primaryTable: 'resource'
  },
  material_archival: {
    keywords: ['拍摄完', '原片', '素材', '归档', '拍完了', 'raw', '原片', '初筛', '选片', '网盘', '云盘', '素材盘'],
    weight: 1,
    tableKeys: ['material'],
    primaryTable: 'material'
  },
  product_publishing: {
    keywords: ['发布', '小红书', '抖音', '文案', '数据', '笔记', '封面', '运营', '上传', '发笔记', '点赞', '收藏', '评论', '播放量'],
    weight: 1,
    tableKeys: ['product'],
    primaryTable: 'product'
  },
  research: {
    keywords: ['爆款', '参考', '链接', '点赞', '对标', '案例', '调研', '竞品', '分析', '热门', '趋势'],
    weight: 0.9,
    tableKeys: ['research'],
    primaryTable: 'research'
  },
  sop: {
    keywords: ['SOP', '流程', '规范', '标准化', '迭代', '优化', '审批', '评审'],
    weight: 0.8,
    tableKeys: ['sop'],
    primaryTable: 'sop'
  }
};

function classifyScene(text) {
  if (!text || typeof text !== 'string') {
    return { scene: 'unknown', confidence: 0, tableKeys: [], primaryTable: null, scores: {} };
  }

  const lowerText = text.toLowerCase();
  const scores = {};
  let maxScore = 0;
  let maxScene = 'unknown';

  for (const [scene, config] of Object.entries(SCENARIOS)) {
    let score = 0;
    const matchedKeywords = [];
    
    for (const keyword of config.keywords) {
      if (lowerText.includes(keyword.toLowerCase())) {
        score += config.weight;
        matchedKeywords.push(keyword);
      }
    }

    scores[scene] = { score, matchedKeywords, count: matchedKeywords.length };
    
    if (score &gt; maxScore) {
      maxScore = score;
      maxScene = scene;
    }
  }

  if (maxScore === 0) {
    if (lowerText.includes('客户') || lowerText.includes('姓名') || lowerText.includes('手机')) {
      return {
        scene: 'customer_consultation',
        confidence: 0.6,
        tableKeys: ['customer', 'project'],
        primaryTable: 'customer',
        scores,
        fallback: true
      };
    }
    return { scene: 'unknown', confidence: 0, tableKeys: [], primaryTable: null, scores };
  }

  const totalKeywords = Object.values(SCENARIOS).reduce((sum, s) =&gt; sum + s.keywords.length, 0);
  const confidence = Math.min(0.5 + maxScore * 0.15, 0.99);

  return {
    scene: maxScene,
    confidence: Math.round(confidence * 100) / 100,
    tableKeys: SCENARIOS[maxScene].tableKeys,
    primaryTable: SCENARIOS[maxScene].primaryTable,
    matchedKeywords: scores[maxScene].matchedKeywords,
    scores
  };
}

module.exports = {
  classifyScene,
  SCENARIOS
};
