// TEMP: 东方女性肖像五派策划概览文档生成脚本 | 2026-06-25 | 预计删除日期 2026-06-28
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType,
  ShadingType, TableLayoutType, VerticalAlign, convertInchesToTwip,
  LevelFormat
} = require("docx");

const FONT = "\u5FAE\u8F6F\u96C5\u9ED1";
const C_BLUE = "2E75B5";
const C_DARK = "2D2D2D";
const C_GRAY = "666666";
const C_BG = "F7F7F7";

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 160 },
    children: [new TextRun({ text, font: FONT, size: 64, bold: true, color: C_BLUE })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 120 },
    children: [new TextRun({ text, font: FONT, size: 44, bold: true, color: C_DARK })],
  });
}

function p(text) {
  return new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text, font: FONT, size: 24, color: C_DARK })],
  });
}

function pItalic(text) {
  return new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text, font: FONT, size: 22, italics: true, color: C_GRAY })],
  });
}

function pBold(label, value) {
  return new Paragraph({
    spacing: { after: 80 },
    children: [
      new TextRun({ text: label, font: FONT, size: 24, bold: true, color: C_DARK }),
      new TextRun({ text: value, font: FONT, size: 24, color: C_DARK }),
    ],
  });
}

function bullet(text) {
  return new Paragraph({
    spacing: { after: 60 },
    numbering: { reference: "bl", level: 0 },
    children: [new TextRun({ text, font: FONT, size: 24, color: C_DARK })],
  });
}

function makeCell(text, opts) {
  const { bold, shading, width } = opts || {};
  return new TableCell({
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: shading ? { type: ShadingType.SOLID, color: shading } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: [new TextRun({ text: text || "", font: FONT, size: 22, bold: !!bold, color: C_DARK })] })],
  });
}

function makeTable(headers, rows, colWidths) {
  const bs = { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" };
  const borders = { top: bs, bottom: bs, left: bs, right: bs };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, i) => makeCell(h, { bold: true, shading: C_BG, width: colWidths?.[i] })) }),
      ...rows.map((row) => new TableRow({ children: row.map((cell, i) => makeCell(cell, { width: colWidths?.[i] })) })),
    ],
  });
}

function emptyLine() {
  return new Paragraph({ spacing: { after: 80 }, children: [] });
}

function divider() {
  return new Paragraph({ spacing: { before: 160, after: 160 }, border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: "E0E0E0", space: 1 } }, children: [] });
}

const doc = new Document({
  numbering: {
    config: [{
      reference: "bl",
      levels: [
        { level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) } } } },
      ],
    }],
  },
  sections: [
    {
      properties: { page: { margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1.25), right: convertInchesToTwip(1.25) } } },
      children: [
        emptyLine(), emptyLine(), emptyLine(), emptyLine(), emptyLine(),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: "\u6CFD\u6000\u5F71\u50CF", font: FONT, size: 72, bold: true, color: C_BLUE })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: "\u4E1C\u65B9\u5973\u6027\u8096\u50CF \u00B7 \u4E94\u6D3E\u7B56\u5212\u6982\u89C8", font: FONT, size: 48, bold: true, color: C_DARK })] }),
        emptyLine(),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: "\u6863\u671F\u5F81\u8BE2\u51FD", font: FONT, size: 28, color: C_GRAY })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 }, children: [new TextRun({ text: "2026\u5E745\u6708", font: FONT, size: 24, color: C_GRAY })] }),
      ],
    },
    {
      properties: { page: { margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1.25), right: convertInchesToTwip(1.25) } } },
      children: [
        h1("\u9879\u76EE\u6982\u8FF0"),
        p("\u672C\u6B21\u62CD\u6444\u4EE5\u300C\u4E1C\u65B9\u5973\u6027\u8096\u50CF\u300D\u4E3A\u547D\u9898\uFF0C\u63D0\u70BC\u4E94\u79CD\u5973\u6027\u7CBE\u795E\u539F\u578B\u3002\u5171\u8BA15\u7EC4\uFF0C\u6BCF\u7EC41\u4F4D\u6A21\u7279\uFF0C\u9884\u8BA12-3\u4E2A\u62CD\u6444\u65E5\u3002"),
        emptyLine(),
        divider(),

        h2("\u7B2C\u4E00\u6D3E\uFF1A\u6E05\u96C5 / \u98CE\u9AA8\u6D3E"),
        pItalic("\u5B8B\u4EE3\u7F8E\u5B66\u7684\u300C\u9759\u300D\u2014\u2014\u5185\u5FC3\u6781\u5EA6\u79E9\u5E8F\u5316\u540E\u7684\u4ECE\u5BB9"),
        p("\u753B\u9762\u6781\u7B80\uFF0C\u7559\u767D\u8981\u591A\uFF0C\u50CF\u5B8B\u753B\u4E00\u6837\u3002\u4EBA\u5F80\u90A3\u4E00\u7AD9\uFF0C\u4E0D\u7528\u8BF4\u8BDD\uFF0C\u9759\u6C14\u5C31\u51FA\u6765\u4E86\u3002"),
        bullet("\u4ECE\u5BB9\u3001\u6E29\u5A49\u3001\u8BD7\u610F\uFF08\u6885\u82B1\u3001\u5170\u82B1\u3001\u674F\u82B1\u3001\u9E22\u5C3E\uFF09"),
        bullet("\u9759\u6C14\u3001\u98CE\u9AA8\u3001\u6C14\u8282\uFF08\u7AF9\u83CA\u677E\uFF09"),
        pBold("\u670D\u88C5\uFF1A", "\u5B8B\u5236\u8919\u5B50\uFF0C\u7D20\u8272\u771F\u4E1D/\u9999\u4E91\u7EB1\uFF0C\u6708\u767D/\u5929\u9752/\u8C46\u7EFF/\u85D5\u8377"),
        pBold("\u5986\u53D1\uFF1A", "\u6781\u7B80\u88F8\u5986\uFF0C\u7B80\u7EA6\u4F4E\u9AF1\uFF0C\u7389\u7C2A/\u7D20\u94F6\u7C2A"),
        pBold("\u9053\u5177\uFF1A", "\u6298\u6247\u3001\u8336\u76CF\u3001\u6885\u82B1\u679D\u3001\u53E4\u7434\u3001\u5BA3\u7EB8\u58A8\u952D\uFF08\u4E00\u4EF6\u8DB3\u77DF\uFF09"),
        divider(),

        h2("\u7B2C\u4E8C\u6D3E\uFF1A\u60B2\u60C5\u5BBF\u547D\u6D3E"),
        pItalic("\u9B4F\u664B\u98CE\u9AA8\u7684\u300C\u771F\u300D\u4E0E\u7834\u788E\u611F\u2014\u2014\u5411\u6B7B\u800C\u751F\u7684\u5F20\u529B"),
        p("\u865E\u59EC\u522B\u518D\u6446\u68CB\u5C40\u4E86\uFF0C\u90A3\u662F\u8FD0\u7B79\u5E37\u5E4C\u3002\u6563\u843D\u7684\u9ED1\u56F4\u68CB\u5B50\u624D\u662F\u5BF9\u7684\u2014\u2014\u547D\u8FD0\u788E\u88C2\u7684\u58F0\u97F3\u3002"),
        bullet("\u6E05\u51B7\u3001\u7834\u788E\u3001\u8BD7\u610F"),
        bullet("\u620F\u5267\u3001\u4E2A\u4F53\u547D\u8FD0\u5728\u5386\u53F2\u4E2D\u65E0\u529B\u7684\u60B2\u5267\u611F"),
        pBold("\u670D\u88C5\uFF1A", "\u9B4F\u664B\u4EA4\u9886\u5BBD\u8896\uFF0C\u771F\u4E1D\u7EE1/\u7EF8\u7EB1\uFF0C\u6708\u84DD/\u971C\u7070/\u58A8\u9752/\u85D5\u7D2B\uFF0C\u8863\u886B\u53EF\u300C\u4E0D\u6574\u300D"),
        pBold("\u5986\u53D1\uFF1A", "\u5E95\u5986\u504F\u767D\u504F\u51B7\uFF0C\u6101\u7709\uFF0C\u773C\u5C3E\u5FAE\u7EA2\uFF0C\u7EDB\u5507\uFF0C\u53D1\u9AF1\u534A\u6563"),
        pBold("\u9053\u5177\uFF1A", "\u6563\u843D\u9ED1\u56F4\u68CB\u5B50\u3001\u65AD\u5F26\u53E4\u7434\u3001\u67AF\u840E\u82B1\u679D\u3001\u788E\u94DC\u955C\u3001\u8584\u7EB1"),
        divider(),

        h2("\u7B2C\u4E09\u6D3E\uFF1A\u5229\u843D\u4FA0\u6C14\u6D3E"),
        pItalic("\u6D12\u8131\u4FA0\u6C14\u2014\u2014\u6C5F\u6E56\u513F\u5973\u7684\u4E0D\u7F81\u4E0E\u5014\u5F3A"),
        bullet("\u7389\u5A07\u9F99 / \u5C0F\u9F99\u5973\u2014\u2014\u6D12\u8131\u4FA0\u6C14"),
        bullet("\u67AF\u5C71\u6C34 / \u5BAB\u4E8C\u2014\u2014\u5014\u5F3A\u9690\u5FCD"),
        pBold("\u670D\u88C5\uFF1A", "\u6539\u826F\u7BAD\u8896\u77ED\u8863+\u675F\u8170+\u957F\u88E4\uFF0C\u68C9\u9EBB/\u76AE\u9769\uFF0C\u58A8\u9ED1/\u70DF\u7070/\u6DF1\u9752\uFF1B\u5014\u5F3A\u7EC4\u7ACB\u9886\u5BF9\u895F\u957F\u886B"),
        pBold("\u5986\u53D1\uFF1A", "\u54D1\u5149\u5E95\u5986\uFF0C\u5251\u7709/\u4E00\u5B57\u7709\uFF0C\u4E0D\u753B\u816E\u7EA2\uFF0C\u4FEE\u5BB9\u5F3A\u8C03\u9AA8\u76F8\uFF1B\u9AD8\u9A6C\u5C3E/\u4F4E\u9AF1\u7D27\u675F"),
        pBold("\u9053\u5177\uFF1A", "\u957F\u5251\u3001\u6597\u7B20\u3001\u7AF9\u6756\u3001\u9152\u58F6\uFF1B\u5014\u5F3A\u7EC4\u62F3\u5934\u7279\u5199\u3001\u6728\u4EBA\u6869"),
        divider(),

        h2("\u7B2C\u56DB\u6D3E\uFF1A\u6743\u8C0B / \u5E1D\u738B\u6D3E"),
        pItalic("\u300C\u6E29\u67D4\u7684\u66B4\u541B\u300D\u2014\u2014\u96CC\u6027\u529B\u91CF\u4E3A\u4F53\uFF0C\u96C4\u6027\u8C0B\u7565\u4E3A\u7528"),
        p("\u5524\u9192\u5BA2\u6237\u5FC3\u91CC\u88AB\u538B\u6291\u7684\u300C\u5973\u6027\u539F\u578B\u300D\u3002\u505A\u6700\u6E29\u67D4\u7684\u5973\u4EBA\uFF0C\u7ACB\u6700\u786C\u7684\u89C4\u77E9\u3002"),
        bullet("\u6743\u8C0B\uFF1A\u73ED\u662D\u3001\u4E0A\u5B98\u5A49\u513F"),
        bullet("\u5E1D\u738B\uFF1A\u6B66\u5219\u5929"),
        pBold("\u670D\u88C5\uFF1A", "\u6743\u8C0B\u7EC4\u5510\u5236\u5927\u8896\uFF0C\u7EC7\u9526/\u5986\u82B1\u7F0E\uFF0C\u7EDB\u7D2B/\u58A8\u7EFF/\u85CF\u84DD\uFF1B\u5E1D\u738B\u7EC4\u9F99\u7EB9\u6539\u826F\u6C49\u670D\uFF0C\u7EC7\u91D1/\u5986\u82B1\uFF0C\u6B63\u7EA2/\u660E\u9EC4/\u7384\u9ED1"),
        pBold("\u5986\u53D1\uFF1A", "\u6743\u8C0B\u7EC4\u67F3\u53F6\u7709\u3001\u4F3C\u7B11\u975E\u7B11\u3001\u6B63\u7EA2\u504F\u6697\u5507\uFF1B\u5E1D\u738B\u7EC4\u82B1\u94BF\u659C\u7EA2\u3001\u6B63\u7EA2\u5982\u8840\u3001\u51E4\u51A0/\u6B65\u6447\u51A0"),
        pBold("\u9053\u5177\uFF1A", "\u68CB\u76D8\u3001\u5E37\u5E4C\u7EB1\u5E18\u3001\u5377\u8F74\u3001\u94DC\u7089\uFF1B\u5E1D\u738B\u7EC4\u7389\u73BA\u3001\u594F\u6298\u3001\u51E4\u51A0"),
        divider(),

        h2("\u7B2C\u4E94\u6D3E\uFF1A\u4ED9\u9038 / \u7985\u610F"),
        pItalic("\u81EA\u6D3D\u8005\u7684\u5185\u6536\u4E0E\u795E\u6027\u2014\u2014\u4E00\u5FF5\u653E\u4E0B\uFF0C\u4E07\u822C\u81EA\u5728"),
        p("\u7ED9\u5DF2\u7ECF\u81EA\u6D3D\u7684\u5973\u6027\u51C6\u5907\u7684\u3002\u73B0\u4EE3\u526A\u88C1\u65B0\u4E2D\u5F0F\uFF0C\u5C0F\u7ACB\u9886\uFF0C\u4F4E\u9971\u548C\u8272\uFF0C\u4E0D\u8981\u9053\u5177\uFF0C\u53EA\u8981\u67D4\u5149\u548C\u6F2B\u53CD\u5C04\u3002\u62CD\u7684\u4E0D\u662F\u8138\uFF0C\u662F\u5185\u6536\u7684\u3001\u6148\u60B2\u7684\u3001\u795E\u6027\u7684\u72B6\u6001\u3002"),
        bullet("\u8C2A\u4ED9\u2014\u2014\u4ED9\u6C14\u843D\u82B1"),
        bullet("\u7985\u610F\u2014\u2014\u4FEE\u884C\uFF0C\u4E00\u5FF5\u653E\u4E0B\u4E07\u822C\u81EA\u5728\uFF0C\u4FE1\u5F92"),
        pBold("\u670D\u88C5\uFF1A", "\u65B0\u4E2D\u5F0F\u5C0F\u7ACB\u9886\uFF0C\u771F\u4E1D/\u68C9\u9EBB\uFF0C\u96FE\u7070/\u6708\u767D/\u6DE1\u85D5/\u7EAF\u767D"),
        pBold("\u5986\u53D1\uFF1A", "\u8FD1\u4E4E\u7D20\u989C\uFF0C\u8F7B\u8584\u5E95\u5986\uFF0C\u81EA\u7136\u7709\uFF0C\u88F8\u5507\uFF1B\u8C2A\u4ED9\u7EC4\u62AB\u53D1\uFF0C\u7985\u610F\u7EC4\u4F4E\u9AF1/\u77ED\u53D1\uFF0C\u65E0\u53D1\u9970"),
        pBold("\u9053\u5177\uFF1A", "\u8C2A\u4ED9\u7EC4\u82B1\u74E3/\u8F7B\u70DF\uFF1B\u7985\u610F\u7EC4\u65E0\u9053\u5177"),
        divider(),

        h1("\u4E94\u6D3E\u901F\u67E5"),
        makeTable(
          ["\u6D3E\u7CFB", "\u7CBE\u795E\u5185\u6838", "\u8272\u5F69", "\u670D\u88C5", "\u5986\u53D1", "\u9053\u5177"],
          [
            ["\u6E05\u96C5/\u98CE\u9AA8", "\u9759\u6C14\u00B7\u4ECE\u5BB9", "\u6708\u767D\u00B7\u5929\u9752\u00B7\u8C46\u7EFF", "\u5B8B\u5236\u8919\u5B50\u00B7\u7D20\u8272\u771F\u4E1D", "\u88F8\u5986\u00B7\u4F4E\u9AF1", "\u6298\u6247\u00B7\u8336\u76CF\u00B7\u6885\u679D"],
            ["\u60B2\u60C5\u5BBF\u547D", "\u7834\u788E\u00B7\u5BBF\u547D", "\u6708\u84DD\u00B7\u971C\u7070\u00B7\u85D5\u7D2B", "\u9B4F\u664B\u5BBD\u8896\u00B7\u8863\u886B\u4E0D\u6574", "\u51B7\u767D\u00B7\u7EDB\u5507\u00B7\u534A\u6563", "\u6563\u68CB\u5B50\u00B7\u65AD\u5F26\u00B7\u788E\u955C"],
            ["\u5229\u843D\u4FA0\u6C14", "\u4FA0\u9AA8\u00B7\u5014\u5F3A", "\u58A8\u9ED1\u00B7\u70DF\u7070\u00B7\u6DF1\u9752", "\u7BAD\u8896\u77ED\u8863\u00B7\u675F\u8170", "\u54D1\u5149\u00B7\u5251\u7709\u00B7\u9AD8\u9A6C\u5C3E", "\u957F\u5251\u00B7\u6597\u7B20\u00B7\u9152\u58F6"],
            ["\u6743\u8C0B/\u5E1D\u738B", "\u638C\u63A7\u00B7\u8C0B\u7565", "\u7EDB\u7D2B\u00B7\u85CF\u84DD\u00B7\u6B63\u7EA2", "\u5510\u5236\u5927\u8896\u00B7\u7EC7\u91D1\u5986\u82B1", "\u67F3\u53F6\u7709\u00B7\u6B63\u7EA2\u5507\u00B7\u51E4\u51A0", "\u68CB\u76D8\u00B7\u5E37\u5E4C\u00B7\u7389\u73BA"],
            ["\u4ED9\u9038/\u7985\u610F", "\u81EA\u6D3D\u00B7\u795E\u6027", "\u96FE\u7070\u00B7\u6708\u767D\u00B7\u7EAF\u767D", "\u65B0\u4E2D\u5F0F\u00B7\u5C0F\u7ACB\u9886\u00B7\u68C9\u9EBB", "\u7D20\u989C\u00B7\u62AB\u53D1/\u4F4E\u9AF1", "\u82B1\u74E3\u00B7\u8F7B\u70DF\u00B7\u6216\u65E0"],
          ],
          [12, 14, 16, 18, 20, 20]
        ),
        emptyLine(),
        divider(),

        h1("\u6863\u671F\u786E\u8BA4"),
        p("\u8BF7\u5404\u4F4D\u6839\u636E\u4EE5\u4E0A\u4E94\u6D3E\u65B9\u5411\uFF0C\u786E\u8BA4\u610F\u5411\u7EC4\u522B\u4E0E\u53EF\u7528\u6863\u671F\u3002"),
        emptyLine(),
        pBold("\u6A21\u7279\uFF1A", "\u610F\u5411\u6D3E\u7CFB\uFF08\u53EF\u591A\u9009\uFF09+ \u53EF\u7528\u6863\u671F\uFF082-3\u5929\uFF09+ \u662F\u5426\u6709\u6C49\u670D/\u65B0\u4E2D\u5F0F\u81EA\u5E26"),
        pBold("\u5316\u5986\u5E08\uFF1A", "\u610F\u5411\u6D3E\u7CFB\uFF08\u53EF\u591A\u9009\uFF09+ \u53EF\u7528\u6863\u671F\uFF082-3\u5929\uFF09+ \u662F\u5426\u6709\u53E4\u98CE\u5986\u9020\u4F5C\u54C1\u96C6"),
        emptyLine(),
        pBold("\u56DE\u590D\u622A\u6B62\uFF1A", "2026\u5E745\u670822\u65E5"),
        pBold("\u8054\u7CFB\uFF1A", "\u6CFD\u6000\u5F71\u50CF\u5DE5\u4F5C\u5BA4"),
      ],
    },
  ],
});

const OUTPUT_DIR = path.join(__dirname, "..", "docs");
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const OUTPUT_PATH = path.join(OUTPUT_DIR, "\u4E1C\u65B9\u5973\u6027\u8096\u50CF\u4E94\u6D3E\u7B56\u5212\u6982\u89C8.docx");

Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(OUTPUT_PATH, buffer);
  console.log("SUCCESS");
  console.log("SIZE:" + fs.statSync(OUTPUT_PATH).size);
});
