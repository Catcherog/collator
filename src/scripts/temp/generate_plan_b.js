// TEMP: 策划案B（30年代复古旗袍·老宅感）文档生成脚本 | 2026-06-25 | 预计删除日期 2026-06-28
const fs = require('fs');
const path = require('path');
const docx = require('docx');
const {
  Document, Paragraph, TextRun, Table, TableCell, TableRow, WidthType,
  AlignmentType, HeadingLevel, ImageRun, Packer, BorderStyle, convertInchesToTwip
} = docx;

const FONT_NAME = '微软雅黑';

function h1(text) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 300 },
    bold: true,
    font: FONT_NAME,
    size: 36,
    color: '2E75B5',
  });
}

function h2(text) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 200 },
    bold: true,
    font: FONT_NAME,
    size: 28,
    color: '404040',
  });
}

function bodyPara(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, font: FONT_NAME, size: 24 })],
    spacing: { before: 200, after: 200 },
    alignment: opts.alignment || AlignmentType.LEFT,
  });
}

function bodyParaWithRuns(runs, opts = {}) {
  return new Paragraph({
    children: runs,
    spacing: { before: 200, after: 200 },
    alignment: opts.alignment || AlignmentType.LEFT,
  });
}

function cell(text, opts = {}) {
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text, bold: opts.bold || false, font: FONT_NAME, size: 22 })],
      alignment: opts.align || AlignmentType.LEFT,
      spacing: { before: 100, after: 100 },
    })],
    width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
    shading: opts.shading ? { fill: opts.shading } : undefined,
    verticalAlign: docx.VerticalAlign.CENTER,
  });
}

function makeTable(headers, rows, colWidths) {
  const headerRow = new TableRow({
    children: headers.map((h, i) => cell(h, { bold: true, shading: 'D9E2F3', width: colWidths ? colWidths[i] : undefined })),
    tableHeader: true,
  });
  const dataRows = rows.map(r => new TableRow({
    children: r.map((c, i) => cell(String(c), { width: colWidths ? colWidths[i] : undefined })),
  }));
  return new Table({
    rows: [headerRow, ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
      left: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
      right: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
      insideVertical: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
    },
  });
}

async function buildDoc() {
  const image3Path = path.resolve('docs/extracted_images/image3.jpeg');
  const image4Path = path.resolve('docs/extracted_images/image4.jpeg');

  const image3Buffer = fs.readFileSync(image3Path);
  const image4Buffer = fs.readFileSync(image4Path);

  const image3Run = new ImageRun({
    data: image3Buffer,
    transformation: { width: 280, height: 380 },
    type: 'jpg',
  });

  const image4Run = new ImageRun({
    data: image4Buffer,
    transformation: { width: 280, height: 380 },
    type: 'jpg',
  });

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(1),
            right: convertInchesToTwip(1),
            bottom: convertInchesToTwip(1),
            left: convertInchesToTwip(1),
          },
        },
      },
      children: [
        // Title
        new Paragraph({
          children: [new TextRun({ text: '策划案B — 30年代复古旗袍·老宅感 执行策划案', bold: true, font: FONT_NAME, size: 44, color: '2E75B5' })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 200, after: 400 },
        }),

        // 1. 项目概述
        h1('一、项目概述'),
        h2('1.1 项目信息'),
        bodyPara('项目名称：策划案B — 30年代复古旗袍·老宅感主题拍摄'),
        bodyPara('拍摄目的：以30年代民国风情为核心，通过老宅场景与复古旗袍造型，呈现沉静、温婉、古典的视觉氛围，打造具有故事感与怀旧情绪的影像作品。'),
        bodyPara('目标受众：化妆师、模特及制作团队成员'),
        h2('1.2 调性关键词'),
        bodyPara('老宅 / 怀旧 / 沉静 / 古典 / 温婉'),
        h2('1.3 预期交付物'),
        bodyPara('• 精修照片 15–20 张（含横版与竖版构图）'),
        bodyPara('• 调色样片 3–5 张（含不同色调方向）'),
        bodyPara('• 拍摄花絮短视频 1 条（可选）'),
        bodyPara('• 最终成片以电子文件形式交付（JPG/RAW 按需）'),

        // 2. 概念描述
        h1('二、概念描述'),
        h2('2.1 风格定位'),
        bodyPara('本策划以1930年代民国时期为背景，以“老宅感”为核心视觉锚点，将复古旗袍的优雅线条与古旧宅院的沉静氛围相融合，营造岁月静好的叙事感。画面追求低饱和、柔和光感与胶片质感，强调古典含蓄之美。'),
        h2('2.2 视觉参考描述'),
        bodyPara('场景以木质结构、旧式窗棂、古典屏风与斑驳墙面为主，光线透过窗格形成柔和的光影层次。人物姿态温婉内敛，旗袍剪裁贴身、面料垂坠，配饰简约精致，整体呈现民国风韵与深宅大院的静谧气质。'),
        h2('2.3 情绪板关键词'),
        bodyPara('深宅大院 / 民国风韵 / 岁月静好 / 古典含蓄 / 旧时光 / 东方婉约'),
        bodyParaWithRuns([new TextRun({ text: '参考图：浅色旗袍配蓝色镶边与花卉发饰造型', font: FONT_NAME, size: 24, italics: true })]),
        new Paragraph({ children: [image4Run], spacing: { before: 200, after: 200 }, alignment: AlignmentType.LEFT }),

        // 3. 拍摄日程
        h1('三、拍摄日程'),
        h2('3.1 日程安排'),
        makeTable(
          ['时间段', '内容', '负责人', '备注'],
          [
            ['07:30 – 08:00', '全员到场/场地布置/设备调试', '摄影师/制片', '确认灯光与背景'],
            ['08:00 – 10:00', '妆造准备（化妆+发型）', '化妆师', '按化妆规格执行'],
            ['10:00 – 10:30', '服装确认/配饰搭配/最终定妆', '造型师/模特', '核对造型要求表'],
            ['10:30 – 12:30', '正式拍摄（上午场）', '摄影师', '优先拍摄主造型'],
            ['12:30 – 13:30', '午餐休息', '全体', '——'],
            ['13:30 – 16:00', '正式拍摄（下午场/场景切换）', '摄影师', '补拍特写与氛围镜头'],
            ['16:00 – 16:30', '补拍/细节调整', '摄影师/制片', '按需补拍'],
            ['16:30 – 17:00', '收工/设备整理/场地复原', '制片/助理', '确认素材备份'],
          ],
          [2200, 3200, 1600, 2000]
        ),
        bodyPara('拍摄日期：待定（TBD），建议安排在工作日以减少场地干扰。'),

        // 4. 造型要求
        h1('四、造型要求'),
        h2('4.1 旗袍明细'),
        makeTable(
          ['项目', '方案A（主推）', '方案B（备选）'],
          [
            ['款式', '传统立领、斜襟、短袖/七分袖', '同左'],
            ['面料', '深色丝绒（暗紫/墨绿/藏蓝）', '浅色丝缎（米白/浅杏）'],
            ['颜色', '深色系，低饱和', '浅色系，配蓝色镶边'],
            ['纹样', '暗纹提花或纯色', '几何或花卉暗纹'],
            ['长度', '及踝或小腿中下', '及踝或小腿中下'],
          ],
          [1600, 3700, 3700]
        ),
        h2('4.2 配饰搭配'),
        makeTable(
          ['配饰类别', '具体要求', '备选方案'],
          [
            ['手包', '复古珠绣手拿包或丝绒小包', '简约皮质手拿包'],
            ['鞋履', '丝绒或缎面低跟/中跟旗袍鞋', '玛丽珍复古皮鞋'],
            ['首饰', '珍珠耳坠、玉镯或细链项链', '银耳环、发簪'],
            ['发饰', '花卉发饰或珍珠发夹', '丝绒发带、流苏簪'],
          ],
          [1600, 3700, 3700]
        ),
        h2('4.3 造型参考图'),
        bodyPara('方案A：深色丝绒旗袍'),
        new Paragraph({ children: [image3Run], spacing: { before: 200, after: 200 }, alignment: AlignmentType.LEFT }),
        bodyPara('方案B：浅色旗袍配蓝色镶边与花卉发饰'),
        new Paragraph({ children: [image4Run], spacing: { before: 200, after: 200 }, alignment: AlignmentType.LEFT }),

        // 5. 化妆规格
        h1('五、化妆规格'),
        h2('5.1 妆容细节'),
        makeTable(
          ['部位', '规格要求', '参考色号/样式'],
          [
            ['底妆', '轻薄服帖，哑光或微光泽质感，遮瑕自然', '象牙白/自然色'],
            ['眉毛', '细弯眉，眉峰柔和，眉尾略收', '灰棕/深棕色眉笔'],
            ['眼妆', '淡雅大地色系，眼线细而内敛，睫毛自然', '浅棕/香槟色眼影'],
            ['唇色', '裸粉、豆沙或珊瑚色，边缘柔和', '豆沙色/裸粉色口红'],
            ['腮红', '轻扫颧骨，色调与唇色呼应', '蜜桃粉/裸杏色'],
          ],
          [1600, 4200, 3200]
        ),
        h2('5.2 发型与发饰'),
        makeTable(
          ['项目', '规格要求', '备注'],
          [
            ['发型风格', '民国推波（手推波）或双麻花辫', '推波需纹理清晰'],
            ['发色', '自然黑发或深棕', '避免浅色或挑染'],
            ['发饰', '花卉发饰、珍珠发夹或细簪点缀', '与服装色调协调'],
            ['发际处理', '碎发整理，额前可留卷曲刘海', '增加复古感'],
          ],
          [1600, 4200, 3200]
        ),
        h2('5.3 化妆时间线'),
        makeTable(
          ['阶段', '时长', '内容'],
          [
            ['底妆', '30 min', '保湿→隔离→粉底→遮瑕→定妆'],
            ['眉眼', '40 min', '眉毛塑形→眼影→眼线→睫毛'],
            ['唇颊', '20 min', '腮红→唇妆→细节调整'],
            ['发型', '30 min', '推波/编发→发饰固定→定型'],
            ['总时长', '约 2 h', '含中途检查与调整'],
          ],
          [2000, 1600, 5400]
        ),

        // 6. 场景规划
        h1('六、场景规划'),
        h2('6.1 拍摄地点'),
        bodyPara('建议选择具有民国老宅质感的实景场地：如杭州周边保存完好的老宅、庭院、复古民宿或影视基地。场地需具备木质结构、旧式门窗、古典家具等元素，空间光线以自然光为主，可配合柔光板补光。'),
        h2('6.2 背景布置'),
        bodyPara('• 主背景：古典屏风、旧木桌椅、青花瓷瓶、线装书、茶具'),
        bodyPara('• 辅背景：窗棂光影、庭院回廊、砖墙/斑驳墙面'),
        bodyPara('• 道具：油纸伞、折扇、复古手包、老式座钟'),
        h2('6.3 氛围营造'),
        bodyPara('• 光线：以侧光与逆光为主，强调窗棂投射的光影层次，整体偏暗调'),
        bodyPara('• 色调：低饱和、偏冷或暖黄怀旧色调'),
        bodyPara('• 情绪：沉静、温婉，人物动作舒缓，眼神含蓄'),

        // 7. 后期备注
        h1('七、后期备注'),
        h2('7.1 调色方向'),
        bodyPara('• 整体色调：冷调或暖黄怀旧调，低饱和'),
        bodyPara('• 光影处理：柔光效果，保留自然光感，避免过度对比'),
        bodyPara('• 质感增强：适度添加胶片颗粒，营造复古质感'),
        bodyPara('• 肤色处理：自然通透，避免过度磨皮'),
        h2('7.2 修图重点'),
        bodyPara('• 服装褶皱自然保留，适度整理'),
        bodyPara('• 背景杂物清理，突出主体'),
        bodyPara('• 光影过渡柔和，避免生硬边缘'),
        bodyPara('• 眼神与神态微调，增强故事感'),
        h2('7.3 输出规格'),
        makeTable(
          ['项目', '规格'],
          [
            ['分辨率', '长边不低于 4000 px（适合印刷与网络）'],
            ['色彩空间', 'sRGB（网络用）/ Adobe RGB（印刷用）'],
            ['文件格式', 'JPG（交付）+ RAW/PSD（存档）'],
            ['交付方式', '网盘链接或加密压缩包'],
          ],
          [2400, 6600]
        ),
        bodyPara(''),
        new Paragraph({
          children: [new TextRun({ text: '—— 本策划案由泽怀影像制作团队编制 ——', font: FONT_NAME, size: 20, color: '888888', italics: true })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 400, after: 200 },
        }),
      ],
    }],
  });

  const outPath = path.resolve('docs/策划案B_30年代复古旗袍_老宅感_执行策划案.docx');
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buffer);
  console.log('Document created successfully at:', outPath);
}

buildDoc().catch(err => {
  console.error('Error creating document:', err);
  process.exit(1);
});
