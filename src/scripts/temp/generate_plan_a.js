// TEMP: 策划案A（50年代复古旗袍）文档生成脚本 | 2026-06-25 | 预计删除日期 2026-06-28
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign,
  HeadingLevel, ImageRun, MediaType
} = require('docx');
const fs = require('fs');
const path = require('path');

// Helper constants
const FONT = "微软雅黑";
const COLOR_H1 = "2E75B5";
const COLOR_H2 = "404040";
const BODY_SIZE = 24; // half-points -> 12pt
const H1_SIZE = 36;   // 18pt
const H2_SIZE = 28;   // 14pt

const border = { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 100, bottom: 100, left: 120, right: 120 };

function bodyPara(text, opts = {}) {
  return new Paragraph({
    spacing: { before: 200, after: 200 },
    children: [new TextRun({ font: FONT, size: BODY_SIZE, text })]
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 240 },
    children: [new TextRun({ font: FONT, size: H1_SIZE, bold: true, color: COLOR_H1, text })]
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 160 },
    children: [new TextRun({ font: FONT, size: H2_SIZE, bold: true, color: COLOR_H2, text })]
  });
}

function cell(text, width, opts = {}) {
  const runs = [];
  if (opts.bold) runs.push(new TextRun({ font: FONT, size: BODY_SIZE, bold: true, text }));
  else runs.push(new TextRun({ font: FONT, size: BODY_SIZE, text }));
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: opts.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: cellMargins,
    children: [new Paragraph({ children: runs })]
  });
}

function imageCell(imageBuffer, width, opts = {}) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: cellMargins,
    children: [
      new Paragraph({
        children: [
          new ImageRun({
            data: imageBuffer,
            transformation: { width: opts.imgWidth || 180, height: opts.imgHeight || 240 },
            type: opts.mediaType || "jpg"
          })
        ]
      })
    ]
  });
}

// Load images
const img1Path = path.resolve(__dirname, '../docs/extracted_images/image1.jpeg');
const img2Path = path.resolve(__dirname, '../docs/extracted_images/image2.jpeg');
const img1Buffer = fs.readFileSync(img1Path);
const img2Buffer = fs.readFileSync(img2Path);

// Table widths (total ~9360 DXA for letter width with 1-inch margins)
const W_FULL = 9360;
const W_2COL = [3120, 6240];
const W_3COL = [3120, 3120, 3120];
const W_4COL = [2340, 2340, 2340, 2340];
const W_5COL = [1872, 1872, 1872, 1872, 1872];

// ===== Section 3: 拍摄日程 table =====
const scheduleTable = new Table({
  width: { size: W_FULL, type: WidthType.DXA },
  columnWidths: W_5COL,
  rows: [
    new TableRow({
      children: [
        cell("时间段", W_5COL[0], { bold: true, shading: "F2F2F2" }),
        cell("内容", W_5COL[1], { bold: true, shading: "F2F2F2" }),
        cell("地点", W_5COL[2], { bold: true, shading: "F2F2F2" }),
        cell("负责人", W_5COL[3], { bold: true, shading: "F2F2F2" }),
        cell("备注", W_5COL[4], { bold: true, shading: "F2F2F2" })
      ]
    }),
    new TableRow({
      children: [
        cell("07:00 - 08:00", W_5COL[0]),
        cell("妆造准备", W_5COL[1]),
        cell("化妆间", W_5COL[2]),
        cell("化妆师", W_5COL[3]),
        cell("提前确认过敏测试", W_5COL[4])
      ]
    }),
    new TableRow({
      children: [
        cell("08:00 - 08:30", W_5COL[0]),
        cell("服装确认", W_5COL[1]),
        cell("更衣区", W_5COL[2]),
        cell("服装助理", W_5COL[3]),
        cell("熨烫、配饰核对", W_5COL[4])
      ]
    }),
    new TableRow({
      children: [
        cell("08:30 - 12:00", W_5COL[0]),
        cell("正式拍摄", W_5COL[1]),
        cell("主摄影棚", W_5COL[2]),
        cell("摄影师", W_5COL[3]),
        cell("按分镜顺序执行", W_5COL[4])
      ]
    }),
    new TableRow({
      children: [
        cell("12:00 - 13:00", W_5COL[0]),
        cell("午休", W_5COL[1]),
        cell("休息区", W_5COL[2]),
        cell("制片", W_5COL[3]),
        cell("模特状态调整", W_5COL[4])
      ]
    }),
    new TableRow({
      children: [
        cell("13:00 - 15:00", W_5COL[0]),
        cell("补拍 / 特写", W_5COL[1]),
        cell("主摄影棚", W_5COL[2]),
        cell("摄影师", W_5COL[3]),
        cell("细节与情绪特写", W_5COL[4])
      ]
    }),
    new TableRow({
      children: [
        cell("15:00 - 15:30", W_5COL[0]),
        cell("收工 / 器材整理", W_5COL[1]),
        cell("全场", W_5COL[2]),
        cell("制片", W_5COL[3]),
        cell("数据备份、器材归还", W_5COL[4])
      ]
    })
  ]
});

// ===== Section 4: 造型要求 table (with images) =====
const stylingTable = new Table({
  width: { size: W_FULL, type: WidthType.DXA },
  columnWidths: W_2COL,
  rows: [
    new TableRow({
      children: [
        cell("项目", W_2COL[0], { bold: true, shading: "F2F2F2" }),
        cell("具体要求", W_2COL[1], { bold: true, shading: "F2F2F2" })
      ]
    }),
    new TableRow({
      children: [
        cell("旗袍款式", W_2COL[0]),
        cell("修身剪裁，立领斜襟，侧开衩适中；强调利落线条感", W_2COL[1])
      ]
    }),
    new TableRow({
      children: [
        cell("主服装（方案A）", W_2COL[0]),
        cell("浅紫色/淡薰衣草色旗袍，精致花卉刺绣，丝绸质感，摩登优雅", W_2COL[1])
      ]
    }),
    new TableRow({
      children: [
        imageCell(img1Buffer, W_2COL[0], { imgWidth: 180, imgHeight: 240, mediaType: "jpg" }),
        cell("参考图1：浅紫色花卉刺绣旗袍", W_2COL[1])
      ]
    }),
    new TableRow({
      children: [
        cell("备选服装（方案B）", W_2COL[0]),
        cell("墨绿色旗袍搭配灰色短外套，复古电影感，摩登洋气", W_2COL[1])
      ]
    }),
    new TableRow({
      children: [
        imageCell(img2Buffer, W_2COL[0], { imgWidth: 180, imgHeight: 240, mediaType: "jpg" }),
        cell("参考图2：绿色旗袍+灰色外套复古造型", W_2COL[1])
      ]
    }),
    new TableRow({
      children: [
        cell("面料", W_2COL[0]),
        cell("真丝 / 织锦缎 / 丝绒（秋冬备选），光泽感佳", W_2COL[1])
      ]
    }),
    new TableRow({
      children: [
        cell("颜色", W_2COL[0]),
        cell("浅紫、墨绿、酒红、藏青等复古色调", W_2COL[1])
      ]
    }),
    new TableRow({
      children: [
        cell("纹样", W_2COL[0]),
        cell("花卉刺绣、暗纹提花、几何线条（避免过于繁复）", W_2COL[1])
      ]
    }),
    new TableRow({
      children: [
        cell("配饰", W_2COL[0]),
        cell("珍珠耳环 / 细链项链；复古手拿包；尖头高跟鞋或玛丽珍鞋", W_2COL[1])
      ]
    }),
    new TableRow({
      children: [
        cell("备用方案", W_2COL[0]),
        cell("准备同色系披肩/外套一件，以防温度变化或造型调整", W_2COL[1])
      ]
    })
  ]
});

// ===== Section 5: 化妆规格 table =====
const makeupTable = new Table({
  width: { size: W_FULL, type: WidthType.DXA },
  columnWidths: W_3COL,
  rows: [
    new TableRow({
      children: [
        cell("项目", W_3COL[0], { bold: true, shading: "F2F2F2" }),
        cell("50年代风格要求", W_3COL[1], { bold: true, shading: "F2F2F2" }),
        cell("备注", W_3COL[2], { bold: true, shading: "F2F2F2" })
      ]
    }),
    new TableRow({
      children: [
        cell("底妆", W_3COL[0]),
        cell("干净无瑕哑光底妆，均匀肤色，轻微提亮", W_3COL[1]),
        cell("避免厚重假面感", W_3COL[2])
      ]
    }),
    new TableRow({
      children: [
        cell("眉毛", W_3COL[0]),
        cell("弯弯柳叶眉，线条柔和流畅，眉尾略收", W_3COL[1]),
        cell("经典50年代眉形", W_3COL[2])
      ]
    }),
    new TableRow({
      children: [
        cell("眼妆", W_3COL[0]),
        cell("大地色系眼影，自然晕染；眼线细致上扬；睫毛卷翘分明", W_3COL[1]),
        cell("突出眼神明亮感", W_3COL[2])
      ]
    }),
    new TableRow({
      children: [
        cell("唇妆", W_3COL[0]),
        cell("经典红唇，唇线清晰饱满，正红或复古砖红", W_3COL[1]),
        cell("50年代标志元素", W_3COL[2])
      ]
    }),
    new TableRow({
      children: [
        cell("发型", W_3COL[0]),
        cell("手推波或优雅低盘发，发丝光泽顺滑", W_3COL[1]),
        cell("突出复古韵味", W_3COL[2])
      ]
    }),
    new TableRow({
      children: [
        cell("发饰", W_3COL[0]),
        cell("珍珠发夹、绢花、网纱小礼帽（可选）", W_3COL[1]),
        cell("与服装色调呼应", W_3COL[2])
      ]
    }),
    new TableRow({
      children: [
        cell("化妆时长", W_3COL[0]),
        cell("约60-90分钟", W_3COL[1]),
        cell("预留调整时间", W_3COL[2])
      ]
    })
  ]
});

// ===== Build Document =====
const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: FONT, size: BODY_SIZE }
      }
    },
    paragraphStyles: [
      {
        id: "Heading1",
        name: "Heading 1",
        run: { font: FONT, size: H1_SIZE, bold: true, color: COLOR_H1 },
        paragraph: { spacing: { before: 360, after: 240 }, outlineLevel: 0 }
      },
      {
        id: "Heading2",
        name: "Heading 2",
        run: { font: FONT, size: H2_SIZE, bold: true, color: COLOR_H2 },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1 }
      }
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
      }
    },
    children: [
      // Title
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 200, after: 400 },
        children: [new TextRun({ font: FONT, size: 44, bold: true, color: COLOR_H1, text: "策划案A — 50年代复古旗袍·摩登洋气利落 执行策划案" })]
      }),

      // 1. 项目概述
      h1("1. 项目概述"),
      bodyPara("项目名称：50年代复古旗袍·摩登洋气利落 主题拍摄"),
      bodyPara("拍摄目的：打造一组兼具复古韵味与现代审美的旗袍时尚大片，呈现50年代上海画报般的优雅自信与利落线条感。"),
      bodyPara("调性关键词：摩登、洋气、利落、复古、优雅"),
      bodyPara("预期交付物：精修大片 15-20 张、花絮视频 1 条、社交媒体用图 9 张（方形/竖版）"),

      // 2. 概念描述
      h1("2. 概念描述"),
      h2("2.1 风格定位"),
      bodyPara("以1950年代上海都市女性为灵感，融合老上海画报与电影明星的经典形象，塑造摩登、洋气、利落的复古旗袍风格。强调线条的简洁流畅与女性自信优雅的气质。"),
      h2("2.2 视觉参考描述"),
      bodyPara("画面呈现明亮、高对比度的视觉效果，背景简洁但不失层次感。模特姿态端庄大方，眼神坚定自信，整体氛围犹如老上海电影画报中的经典定格。"),
      h2("2.3 情绪板关键词"),
      bodyPara("老上海画报 / 电影明星 / 优雅自信 / 线条利落 / 摩登都市 / 复古色调 / 精致细节"),
      new Paragraph({
        spacing: { before: 200, after: 200 },
        children: [
          new ImageRun({
            data: img2Buffer,
            transformation: { width: 200, height: 267 },
            type: "jpg"
          })
        ]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [new TextRun({ font: FONT, size: 20, italics: true, color: "666666", text: "概念参考图：绿色旗袍+灰色外套复古电影感造型" })]
      }),

      // 3. 拍摄日程
      h1("3. 拍摄日程"),
      bodyPara("拍摄日期：待定（TBD），建议安排在工作日，避开节假日场地高峰。"),
      scheduleTable,

      // 4. 造型要求
      h1("4. 造型要求"),
      bodyPara("以下造型方案围绕「摩登洋气利落」核心调性展开，主服装与备选服装均已准备实物参考。"),
      stylingTable,

      // 5. 化妆规格
      h1("5. 化妆规格"),
      bodyPara("50年代复古妆容强调干净底妆、弯弯柳叶眉与经典红唇，发型以手推波或优雅盘发为主，整体呈现精致画报感。"),
      makeupTable,

      // 6. 场景规划
      h1("6. 场景规划"),
      h2("6.1 拍摄地点"),
      bodyPara("室内专业摄影棚，面积不低于80㎡，层高3.5米以上，便于布光与背景架设。"),
      h2("6.2 背景布置"),
      bodyPara("主背景：纯色幕布（米白/浅灰/暖杏色），简洁干净，突出人物与服装。"),
      bodyPara("辅助道具：复古单人沙发、老式电话机、金属落地灯、丝绒窗帘，营造50年代都市客厅氛围。"),
      h2("6.3 氛围营造"),
      bodyPara("采用明亮、柔和但具有方向性的主光，配合补光与轮廓光，打造高对比度的画报质感。光线应突出旗袍面料光泽与人物面部立体感。"),

      // 7. 后期备注
      h1("7. 后期备注"),
      h2("7.1 调色方向"),
      bodyPara("暖调为主，模拟胶片质感，适度提升对比度与色彩饱和度，肤色偏暖杏色，背景略压暗以突出主体。"),
      h2("7.2 精修重点"),
      bodyPara("皮肤质感保留自然纹理，避免过度磨皮；服装褶皱适度修整但不失真；背景杂物清除，保持画面干净。"),
      h2("7.3 输出规格"),
      bodyPara("精修图：TIFF/PSD 源文件 + JPG 交付文件（长边 3000px，300dpi，sRGB）。"),
      bodyPara("社交媒体图：竖版 1080×1350px，方形 1080×1080px，JPG 格式。"),
      h2("7.4 交付格式"),
      bodyPara("成片以网盘链接形式交付，按「精修大片 / 社交媒体 / 花絮视频」分文件夹整理，附选片编号与修图备注。")
    ]
  }]
});

// Save
const outputPath = path.resolve(__dirname, '../docs/策划案A_50年代复古旗袍_摩登洋气利落_执行策划案.docx');
Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(outputPath, buffer);
  console.log("✅ 文档生成成功：", outputPath);
}).catch(err => {
  console.error("❌ 生成失败：", err);
  process.exit(1);
});
