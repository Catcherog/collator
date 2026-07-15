// TEMP: 人像写真摄影项目策划案文档生成脚本 | 2026-06-25 | 预计删除日期 2026-06-28
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, PageBreak,
  ShadingType, TableLayoutType, VerticalAlign, convertInchesToTwip,
  LevelFormat, UnderlineType
} = require("docx");

const FONT = "微软雅黑";
const COLOR_BLUE = "2E75B5";
const COLOR_DARK_GRAY = "404040";
const COLOR_HEADER_BG = "F2F2F2";
const COLOR_BLACK = "000000";

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 200 },
    children: [
      new TextRun({ text, font: FONT, size: 72, bold: true, color: COLOR_BLUE }),
    ],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 150 },
    children: [
      new TextRun({ text, font: FONT, size: 56, bold: true, color: COLOR_DARK_GRAY }),
    ],
  });
}

function p(text) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [
      new TextRun({ text, font: FONT, size: 24, color: COLOR_BLACK }),
    ],
  });
}

function pBold(label, value) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [
      new TextRun({ text: label, font: FONT, size: 24, bold: true, color: COLOR_BLACK }),
      new TextRun({ text: value, font: FONT, size: 24, color: COLOR_BLACK }),
    ],
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    spacing: { after: 80 },
    numbering: { reference: "bullet-list", level },
    children: [
      new TextRun({ text, font: FONT, size: 24, color: COLOR_BLACK }),
    ],
  });
}

function bulletBold(label, value, level = 0) {
  return new Paragraph({
    spacing: { after: 80 },
    numbering: { reference: "bullet-list", level },
    children: [
      new TextRun({ text: label, font: FONT, size: 24, bold: true, color: COLOR_BLACK }),
      new TextRun({ text: value, font: FONT, size: 24, color: COLOR_BLACK }),
    ],
  });
}

function makeCell(text, opts = {}) {
  const { bold, shading, width, alignment } = opts;
  return new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: shading ? { type: ShadingType.SOLID, color: shading } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [
      new Paragraph({
        alignment: alignment || AlignmentType.LEFT,
        children: [
          new TextRun({
            text: text || "",
            font: FONT,
            size: 22,
            bold: !!bold,
            color: COLOR_BLACK,
          }),
        ],
      }),
    ],
  });
}

function makeTable(headers, rows, colWidths) {
  const borderStyle = {
    style: BorderStyle.SINGLE,
    size: 1,
    color: "CCCCCC",
  };
  const borders = {
    top: borderStyle,
    bottom: borderStyle,
    left: borderStyle,
    right: borderStyle,
  };

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) =>
      makeCell(h, { bold: true, shading: COLOR_HEADER_BG, width: colWidths?.[i] })
    ),
  });

  const dataRows = rows.map(
    (row) =>
      new TableRow({
        children: row.map((cell, i) => makeCell(cell, { width: colWidths?.[i] })),
      })
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders,
    rows: [headerRow, ...dataRows],
  });
}

function emptyLine() {
  return new Paragraph({ spacing: { after: 100 }, children: [] });
}

const doc = new Document({
  numbering: {
    config: [
      {
        reference: "bullet-list",
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: "\u2022",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) } } },
          },
          {
            level: 1,
            format: LevelFormat.BULLET,
            text: "\u25E6",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: convertInchesToTwip(1), hanging: convertInchesToTwip(0.25) } } },
          },
        ],
      },
    ],
  },
  sections: [
    // ===== 封面页 =====
    {
      properties: {
        page: {
          margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1.25), right: convertInchesToTwip(1.25) },
        },
      },
      children: [
        emptyLine(), emptyLine(), emptyLine(), emptyLine(), emptyLine(), emptyLine(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [
            new TextRun({ text: "泽怀影像", font: FONT, size: 80, bold: true, color: COLOR_BLUE }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
          children: [
            new TextRun({ text: "人像写真拍摄项目策划案", font: FONT, size: 60, bold: true, color: COLOR_DARK_GRAY }),
          ],
        }),
        emptyLine(), emptyLine(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
          children: [
            new TextRun({ text: "—— 打造高品质人像写真作品 ——", font: FONT, size: 28, color: COLOR_BLUE }),
          ],
        }),
        emptyLine(), emptyLine(), emptyLine(), emptyLine(), emptyLine(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [
            new TextRun({ text: "编制日期：2026年5月15日", font: FONT, size: 24, color: COLOR_DARK_GRAY }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [
            new TextRun({ text: "编制单位：泽怀影像工作室", font: FONT, size: 24, color: COLOR_DARK_GRAY }),
          ],
        }),
      ],
    },
    // ===== 正文 =====
    {
      properties: {
        page: {
          margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1.25), right: convertInchesToTwip(1.25) },
        },
      },
      children: [
        // ===== 第一章：项目概述 =====
        h1("第一章 项目概述"),
        h2("1.1 项目名称"),
        p("泽怀影像·人像写真拍摄项目"),
        h2("1.2 拍摄目的"),
        p("打造一组高品质人像写真作品，用于品牌展示与客户案例积累。通过精心策划的拍摄方案，呈现模特在不同风格下的情绪表达与视觉张力，为工作室积累优质样片素材，同时提升品牌在目标客群中的认知度与信任感。"),
        h2("1.3 预期成果"),
        bullet("精选成片15-20张，含不同造型与情绪表达"),
        bullet("清新自然风格成片8-10张"),
        bullet("文艺复古风格成片7-10张"),
        bullet("全部原片RAW格式存档，便于后期二次创作"),
        bullet("精修成片同时输出高清JPG及Web适配尺寸"),
        h2("1.4 时间规划"),
        makeTable(
          ["阶段", "时间节点", "工作内容", "交付物"],
          [
            ["前期筹备", "D-14 ~ D-1", "模特确认、服装采购、道具准备、场景布置方案", "筹备清单确认单"],
            ["拍摄日", "D-Day", "两组风格拍摄（清新自然+文艺复古）", "全部原片素材"],
            ["后期制作", "D+1 ~ D+7", "选片、精修、调色、排版", "精修成片15-20张"],
            ["交付", "D+8 ~ D+10", "客户审片、微调、最终交付", "成品图包+使用授权"],
          ],
          [15, 20, 35, 30]
        ),

        // ===== 第二章：题材定位 =====
        h1("第二章 题材定位"),
        h2("2.1 风格方向"),
        p("本次拍摄采用清新自然与文艺复古双线并行的策略，两组风格在视觉调性上形成对比与互补，既能展示工作室多元创作能力，又能为不同审美的目标客群提供参考案例。"),
        h2("2.2 参考风格描述"),
        p("以自然光线为主，捕捉人物真实情绪，色调偏暖，画面通透。清新自然组追求日系写真的通透感与呼吸感，文艺复古组则借鉴胶片摄影的色彩质感与叙事氛围。两组均强调人物情绪的自然流露，避免过度摆拍导致的僵硬感。"),
        h2("2.3 视觉调性关键词"),
        p("柔光、通透、情绪感、故事性、质感"),
        h2("2.4 风格关键词与视觉表现"),
        makeTable(
          ["风格关键词", "视觉表现", "适用组别"],
          [
            ["柔光", "大面积漫射光，无明显硬阴影，皮肤质感柔和细腻", "清新自然组"],
            ["通透", "画面层次分明，高光不过曝，暗部有细节，整体清透", "清新自然组"],
            ["情绪感", "眼神、微表情、肢体语言传达内心状态，画面有感染力", "两组通用"],
            ["故事性", "场景与人物互动产生叙事感，观者可联想画面外的情节", "文艺复古组"],
            ["质感", "服装材质、皮肤纹理、光影过渡均有细腻呈现", "两组通用"],
          ],
          [20, 55, 25]
        ),

        // ===== 第三章：模特方案 =====
        h1("第三章 模特方案"),
        h2("3.1 已确定模特信息"),
        makeTable(
          ["姓名", "身高", "三围", "鞋码", "特点", "备注"],
          [
            ["待定", "165-172cm", "待测量", "36-38", "五官精致、气质佳", "签约模特优先"],
          ],
          [15, 15, 20, 10, 20, 20]
        ),
        h2("3.2 待招募模特标准"),
        makeTable(
          ["维度", "标准要求"],
          [
            ["年龄", "20-28岁，形象气质佳，皮肤状态良好"],
            ["身高", "162cm以上，身材比例匀称"],
            ["形象", "五官立体感强，镜头表现力好，无明显纹身（小面积可接受）"],
            ["表现力", "能理解拍摄意图，自然表达不同情绪，配合度高"],
            ["经验", "有平面拍摄经验者优先，新人需提供素颜照及全身照审核"],
          ],
          [20, 80]
        ),
        h2("3.3 模特沟通要点"),
        p("拍摄前沟通清单："),
        bullet("确认拍摄日期、时间、地点，提前2天发送拍摄须知"),
        bullet("发送风格参考图，确保模特理解拍摄方向"),
        bullet("确认服装尺码，提醒自带内衣颜色（肤色/白色无痕内衣）"),
        bullet("提醒拍摄前1天充足睡眠，避免熬夜导致皮肤状态不佳"),
        bullet("确认是否对特定化妆品过敏，提前告知化妆师"),
        p("注意事项："),
        bullet("拍摄当天素颜到场，不自行化妆"),
        bullet("长发模特不洗头（拍摄当天），便于造型师做慵懒纹理"),
        bullet("携带个人舒适平底鞋，拍摄间隙穿着"),

        // ===== 第四章：服装造型方案 =====
        h1("第四章 服装造型方案"),
        h2("4.1 主推服装风格"),
        p("清新自然风：以白色系连衣裙搭配浅色针织开衫为核心，营造轻盈、通透的视觉感受。服装选择注重面料垂坠感与光泽度，确保在自然光下呈现高级质感。"),
        h2("4.2 配色方案"),
        p("以白色、米色、浅粉为主色调，搭配卡其色和浅灰作为点缀色。整体色彩饱和度偏低，明度偏高，与清新自然的视觉调性保持一致。"),
        h2("4.3 服装细节描述"),
        makeTable(
          ["部位", "单品", "颜色", "材质", "品牌建议", "备注"],
          [
            ["连衣裙", "法式方领连衣裙", "奶白色", "雪纺/缎面", "Maje、Sandro", "裙长及膝，有腰线"],
            ["外搭", "针织开衫", "浅米色", "细针织羊绒", "COS、Uniqlo U", "V领，不扣扣子"],
            ["鞋履", "平底凉拖", "裸色", "皮质", "& Other Stories", "简约款式，不抢镜"],
            ["配饰", "极细锁骨链", "金色", "14K镀金", "APM Monaco", "点缀作用，不喧宾夺主"],
            ["手部", "编织草编包", "米白色", "草编", "Maison Margiela", "作为道具互动使用"],
          ],
          [10, 18, 10, 12, 20, 30]
        ),
        h2("4.4 备选方案"),
        p("文艺复古风：深色丝绒上衣搭配格纹半裙，营造浓郁复古氛围。丝绒面料在侧光下呈现独特光泽，格纹元素增添英伦学院感，配合深色唇妆与复古发型，形成与清新组鲜明的风格反差。"),
        makeTable(
          ["部位", "单品", "颜色", "材质", "品牌建议", "备注"],
          [
            ["上衣", "方领丝绒衬衫", "酒红色", "丝绒", "& Other Stories", "泡泡袖设计"],
            ["半裙", "格纹A字半裙", "棕绿格纹", "羊毛混纺", "Sandro", "及膝长度"],
            ["鞋履", "玛丽珍鞋", "黑色", "皮质", "Repetto", "低跟，复古感"],
            ["配饰", "珍珠耳夹", "白色", "人造珍珠", "Vivienne Westwood", "复古标志性配饰"],
          ],
          [10, 18, 10, 12, 20, 30]
        ),

        // ===== 第五章：发型设计 =====
        h1("第五章 发型设计"),
        h2("5.1 发型风格定位"),
        p("自然慵懒感，不做过度造型。发型设计遵循「减法原则」，以突出人物本身气质为核心，避免过度造型导致的刻意感。通过纹理感和空气感的营造，让发型与整体风格自然融合。"),
        h2("5.2 具体发型描述"),
        makeTable(
          ["造型编号", "发型名称", "适用场景", "技术要点", "参考图描述"],
          [
            ["A01", "慵懒低马尾", "清新自然组-窗边侧光", "耳侧留碎发，马尾位置在枕骨下方，用手指抓松制造纹理", "日杂封面模特随性低马尾"],
            ["A02", "法式微卷披发", "清新自然组-沙发互动", "32mm卷棒做S型波浪，发尾外翻，头顶拉松制造蓬松感", "法国博主Jeanne Damas风格"],
            ["A03", "复古手推波纹", "文艺复古组-暗调场景", "湿发造型+手推波纹，一侧别至耳后，搭配珍珠发针", "1920s好莱坞复古造型"],
            ["A04", "半扎发+丝带", "文艺复古组-道具互动", "上半部分扎低马尾，丝带绑蝴蝶结，下半部分自然微卷", "英伦田园风半扎发"],
          ],
          [10, 15, 20, 30, 25]
        ),
        h2("5.3 发饰搭配建议"),
        bullet("简约发夹：金色极细一字夹，3-5枚斜插于耳侧，点缀不堆砌"),
        bullet("丝带绑发：选择与服装同色系丝绒缎带，宽度1.5cm，系低马尾或半扎发"),
        bullet("珍珠发针：复古组专用，单枚别于波纹造型侧面，提升复古精致感"),

        // ===== 第六章：道具清单 =====
        h1("第六章 道具清单"),
        h2("6.1 核心道具列表"),
        makeTable(
          ["道具名称", "用途", "数量", "来源", "预算（元）", "备注"],
          [
            ["干花束", "手持道具，增加画面层次", "2束", "淘宝定制", "80", "白色+米色系，勿选鲜艳色"],
            ["复古相框", "构图前景，营造故事感", "1个", "宜家/淘宝", "45", "金色或原木色，空框"],
            ["蕾丝布", "铺沙发/地面，增加质感", "2米", "布料市场", "35", "米白色，棉质优先"],
            ["香薰蜡烛", "氛围营造，暖光点缀", "3支", "Zara Home", "90", "不点燃，仅做视觉道具"],
            ["英文旧书", "手持/桌面摆放", "2本", "二手书店", "30", "精装硬壳，泛黄页面"],
            ["透明雨伞", "逆光场景道具", "1把", "淘宝", "25", "全透明，无图案"],
            ["草帽", "清新组外景/窗边道具", "1顶", "淘宝", "50", "米色宽檐，可系丝带"],
          ],
          [15, 20, 8, 12, 12, 33]
        ),
        h2("6.2 场景装饰道具"),
        bullet("干花束：白色满天星+尤加利叶组合，搭配牛皮纸包裹"),
        bullet("复古相框：8x10寸金色雕花相框，放置于窗台或茶几"),
        bullet("蕾丝布：1.5m宽幅，垂坠于沙发扶手或铺于地面"),
        bullet("蜡烛：不同高度柱形蜡烛组合，搭配金属烛台"),
        h2("6.3 备选道具"),
        bullet("透明雨伞：用于逆光剪影场景，光线穿透伞面形成柔和光晕"),
        bullet("草帽：模特手持或半遮面，增加清新田园氛围"),
        bullet("书本：英文精装旧书，翻阅状态，增加文艺气质"),

        // ===== 第七章：灯光方案 =====
        h1("第七章 灯光方案"),
        h2("7.1 主光方案"),
        p("以自然光为主光源，选择大窗户侧光位，光线经白色纱帘过滤后形成大面积柔光。拍摄时间控制在上午9:00-12:00，此时段自然光色温偏暖（约5000-5500K），光线角度适中，适合人像拍摄。纱帘作为天然柔光箱，将直射阳光转化为均匀漫射光，有效消除硬阴影。"),
        h2("7.2 辅光/补光方案"),
        bullet("反光板（金色面）：用于暗部补光，金色面反射暖调光线，与主光色温一致，适合清新自然组"),
        bullet("反光板（银色面）：用于轮廓光勾勒，银色面反射冷调光线，在复古组中制造明暗对比"),
        bullet("LED补光灯：备用方案，阴天或光线不足时启用，色温可调（3200-5600K），功率60W"),
        h2("7.3 特殊光效"),
        bulletBold("逆光剪影：", "模特背对窗户，关闭室内补光，仅保留窗外自然光轮廓，曝光补偿-1.3EV，营造神秘氛围"),
        bulletBold("窗光轮廓光：", "模特侧对窗户45度，纱帘半开，光线从一侧勾勒面部轮廓，另一侧用反光板微弱补光，保留明暗过渡"),
        h2("7.4 灯光设备清单"),
        makeTable(
          ["设备名称", "型号", "数量", "用途", "备注"],
          [
            ["反光板", "5合1 110cm", "1块", "暗部补光、轮廓光", "金银双面+柔光布"],
            ["LED补光灯", "神牛SL60II", "1台", "阴天备用主光", "色温可调，配柔光箱"],
            ["柔光板", "60x90cm", "1块", "过滤窗户直射光", "1档减光"],
            ["灯架", "2.6m铝合金", "2个", "支撑补光灯/柔光板", "含沙袋配重"],
            ["遮光板", "黑色泡沫板", "2块", "遮挡杂光、制造阴影", "自制即可"],
          ],
          [18, 18, 8, 28, 28]
        ),

        // ===== 第八章：拍摄场景规划 =====
        h1("第八章 拍摄场景规划"),
        h2("8.1 场景描述"),
        p("室内自然光场景，选择朝东或朝南的大窗户房间，窗户宽度不低于2米，确保光线覆盖面积充足。白色纱帘作为光线过滤层，将直射阳光转化为均匀柔光。地面为浅色木地板或白色瓷砖，墙面以白色或浅灰色为主，避免强烈色彩干扰。"),
        h2("8.2 背景布置"),
        bullet("简约白墙：作为主要背景，干净通透，突出人物主体"),
        bullet("绿植点缀：龟背竹或琴叶榕盆栽1-2盆，放置于画面边缘，增加生机感"),
        bullet("浅色布艺沙发：米白色或浅灰色棉麻沙发，模特可坐/靠/躺，丰富姿态变化"),
        bullet("原木茶几：放置道具（书本、蜡烛、花束），增加画面层次"),
        h2("8.3 场景氛围营造"),
        p("整体氛围以暖色调为基础，通过柔和光影与生活化场景营造温馨、自然的视觉感受。具体手法包括："),
        bullet("利用纱帘制造光晕效果，增强画面空气感"),
        bullet("绿植与自然光结合，营造室内花园氛围"),
        bullet("布艺沙发与针织毯增加居家温暖感"),
        bullet("蜡烛与暖色道具点缀，提升画面温度"),
        bullet("复古组场景减少绿植，增加深色木质家具与暖色灯光，营造浓郁氛围"),

        // ===== 第九章：拍摄流程 =====
        h1("第九章 拍摄流程"),
        h2("9.1 拍摄日时间线"),
        makeTable(
          ["时间段", "环节", "内容", "负责人", "备注"],
          [
            ["08:00-08:30", "到达与准备", "团队到场、设备架设、场景最终确认", "摄影助理", "提前检查天气与光线"],
            ["08:30-09:00", "模特化妆造型", "清新自然组妆造：轻薄底妆+自然眉+裸色唇", "化妆师", "模特素颜到场"],
            ["09:00-09:15", "场景灯光确认", "试拍+曝光确认+白平衡校准", "摄影师", "用手机预览确认色调"],
            ["09:15-10:30", "第一组拍摄", "清新自然风：窗边侧光+沙发互动+手持道具", "摄影师", "每20分钟查看一次效果"],
            ["10:30-10:45", "休息与造型更换", "模特补妆+更换复古造型+场景调整", "化妆师+助理", "复古妆：深唇+上扬眼线"],
            ["10:45-12:00", "第二组拍摄", "文艺复古风：暗调场景+复古道具+特殊光效", "摄影师", "尝试逆光剪影效果"],
            ["12:00-12:30", "收工与素材确认", "原片备份+模特确认+设备收纳", "摄影助理", "双重备份（本地+移动硬盘）"],
          ],
          [15, 15, 30, 15, 25]
        ),
        h2("9.2 各环节负责人"),
        bulletBold("总负责/摄影师：", "把控整体拍摄节奏、构图、光线，确保成片质量"),
        bulletBold("化妆师：", "负责两组妆造设计及现场补妆，确保妆面持久"),
        bulletBold("摄影助理：", "设备架设、场景调整、反光板持握、原片备份"),
        bulletBold("造型师（兼）：", "服装搭配确认、发型调整、道具递送"),
        h2("9.3 注意事项"),
        bullet("拍摄前一天确认天气预报，如遇阴天启用LED补光方案"),
        bullet("准备备用存储卡（不少于2张64GB），避免存储空间不足"),
        bullet("模特情绪引导优先于技术调整，先建立信任再追求效果"),
        bullet("每组拍摄中间安排5分钟查看回放，及时调整方向"),
        bullet("复古组拍摄时关闭室内所有日光灯，仅保留自然光+暖色补光"),
        bullet("全程手机静音，避免干扰拍摄氛围"),

        // ===== 第十章：预算估算 =====
        h1("第十章 预算估算"),
        h2("10.1 各项费用明细"),
        makeTable(
          ["项目", "数量", "单价（元）", "小计（元）", "备注"],
          [
            ["模特费用", "1人/天", "800", "800", "含肖像使用授权"],
            ["化妆造型", "1人/天", "600", "600", "含两组妆造+补妆"],
            ["服装租赁", "2套", "300", "600", "清新组+复古组各1套"],
            ["道具采购", "1批", "355", "355", "详见第六章道具清单"],
            ["场地租赁", "1天", "500", "500", "含窗户朝南大房间"],
            ["灯光设备", "1批", "200", "200", "自有设备折旧+耗材"],
            ["后期修图", "20张", "30", "600", "精修含调色+排版"],
            ["其他", "1项", "200", "200", "交通、餐饮、应急"],
          ],
          [18, 12, 15, 15, 40]
        ),
        emptyLine(),
        pBold("总计：", "3,855元"),
        emptyLine(),
        p("注：以上预算为单次拍摄基础预算，如需增加模特人数或拍摄天数，相应费用按比例递增。服装租赁费用视品牌档次浮动，道具采购可复用于后续拍摄。"),
      ],
    },
  ],
});

const OUTPUT_DIR = path.join(__dirname, "..", "docs");
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}
const OUTPUT_PATH = path.join(OUTPUT_DIR, "人像写真摄影项目策划案.docx");

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(OUTPUT_PATH, buffer);
  const stats = fs.statSync(OUTPUT_PATH);
  console.log("SUCCESS");
  console.log("PATH:" + OUTPUT_PATH);
  console.log("SIZE:" + stats.size);
});
