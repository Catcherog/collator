// utils-adapter.ts
// 从 src/data-cleaning/utils/index.js 中提取无状态纯函数，不 import 旧模块。

export interface ParseDateContext {
  /** 基准日期，ISO 8601 日期字符串 YYYY-MM-DD */
  referenceDate: string;
  timezone?: string;
}

export interface BudgetResult {
  interval: string | null;
  confidence: number;
}

export interface StyleMatch {
  style: string;
  confidence: number;
}

export interface ShootTypeMatch {
  type: string;
  confidence: number;
  needsConfirmation: boolean;
}

const chineseNumbers: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

export function toHalfWidth(str: unknown): unknown {
  if (typeof str !== 'string') return str;
  let result = '';
  for (let i = 0; i < str.length; i++) {
    const charCode = str.charCodeAt(i);
    if (charCode === 12288) {
      result += String.fromCharCode(32);
    } else if (charCode >= 65281 && charCode <= 65374) {
      result += String.fromCharCode(charCode - 65248);
    } else {
      result += str[i];
    }
  }
  return result;
}

export function sanitizePhone(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return String(toHalfWidth(value)).replace(/[\s\-()（）]/g, '').trim();
}

export function sanitizeText(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return String(toHalfWidth(value)).replace(/\s+/g, ' ').trim();
}

export function sanitizeUrl(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.trim();
}

export function isValidPhone(value: unknown): boolean {
  const phone = sanitizePhone(value);
  return typeof phone === 'string' && /^1[3-9]\d{9}$/.test(phone);
}

export function isValidWechat(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  return /^[a-zA-Z][a-zA-Z0-9_-]{5,19}$/.test(v) || /^1[3-9]\d{9}$/.test(v);
}

export function isValidUrl(value: unknown): boolean {
  const url = sanitizeUrl(value);
  return typeof url === 'string' && /^https?:\/\/[\w-]+(\.[\w-]+)+[/#?]?.*$/.test(url);
}

export function isValidRating(value: unknown): boolean {
  const num = Number(value);
  return !Number.isNaN(num) && num >= 1 && num <= 5 && Number.isInteger(num);
}

export function parseAmount(text: unknown): { value: number; approximate: boolean } | null {
  if (typeof text !== 'string') return null;

  const kMatch = text.match(/(\d+)k/i);
  if (kMatch) {
    return { value: parseInt(kMatch[1], 10) * 1000, approximate: true };
  }

  const numMatch = text.match(/(\d+(?:\.\d+)?)/);
  if (numMatch) {
    const value = parseFloat(numMatch[1]);
    const approximate = /[多左右大概]/.test(text);
    return { value, approximate };
  }

  return null;
}

export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function chineseToNum(str: unknown): number | null {
  if (!str || typeof str !== 'string') return null;
  if (/^\d+$/.test(str)) return parseInt(str, 10);

  if (str === '十') return 10;
  if (str.startsWith('十')) {
    const rest = str.slice(1);
    return 10 + (chineseNumbers[rest] || 0);
  }
  if (str.endsWith('十')) {
    const first = str.slice(0, -1);
    return (chineseNumbers[first] || 1) * 10;
  }
  if (str.includes('十')) {
    const parts = str.split('十');
    const tens = chineseNumbers[parts[0]] || 1;
    const ones = parts[1] ? chineseNumbers[parts[1]] || 0 : 0;
    return tens * 10 + ones;
  }

  return chineseNumbers[str] ?? null;
}

function parseReferenceDate(context?: ParseDateContext): Date | null {
  if (context?.referenceDate) {
    const match = context.referenceDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1;
      const day = parseInt(match[3], 10);
      const d = new Date(year, month, day);
      if (
        d.getFullYear() === year &&
        d.getMonth() === month &&
        d.getDate() === day
      ) {
        d.setHours(0, 0, 0, 0);
        return d;
      }
    }
  }
  return null;
}

export function parseDate(text: unknown, context?: ParseDateContext): string | null {
  if (typeof text !== 'string') return null;
  const input = String(toHalfWidth(text)).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return input;
  }

  const today = parseReferenceDate(context);
  if (!today) {
    return null;
  }

  if (input === '今天' || input === '今日') {
    return formatDate(today);
  }
  if (input === '昨天' || input === '昨日') {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return formatDate(yesterday);
  }
  if (input === '明天' || input === '明日') {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return formatDate(tomorrow);
  }
  if (input === '后天') {
    const dayAfter = new Date(today);
    dayAfter.setDate(dayAfter.getDate() + 2);
    return formatDate(dayAfter);
  }

  const monthDayMatch = input.match(/(\d{1,2})[月\-/](\d{1,2})[日号]?/);
  if (monthDayMatch) {
    const month = parseInt(monthDayMatch[1], 10);
    const day = parseInt(monthDayMatch[2], 10);
    let year = today.getFullYear();
    const testDate = new Date(year, month - 1, day);
    if (testDate < today) {
      year += 1;
    }
    return formatDate(new Date(year, month - 1, day));
  }

  const chineseMonthDayMatch = input.match(/([一二三四五六七八九十\d]+)月([一二三四五六七八九十\d]+)[日号]/);
  if (chineseMonthDayMatch) {
    const month = chineseToNum(chineseMonthDayMatch[1]);
    const day = chineseToNum(chineseMonthDayMatch[2]);
    if (month && day) {
      let year = today.getFullYear();
      const testDate = new Date(year, month - 1, day);
      if (testDate < today) {
        year += 1;
      }
      return formatDate(new Date(year, month - 1, day));
    }
  }

  const weekDayMap: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
  const weekMatch = input.match(/(这|下|下下)?(周|星期)([一二三四五六日天])/);
  if (weekMatch) {
    const [, prefix, , weekDayChar] = weekMatch;
    const targetWeekDay = weekDayMap[weekDayChar];
    if (targetWeekDay !== undefined) {
      const currentWeekDay = today.getDay();
      let daysToAdd = targetWeekDay - currentWeekDay;

      if (prefix === '这' || !prefix) {
        if (daysToAdd < 0) daysToAdd += 7;
      } else if (prefix === '下') {
        daysToAdd += 7;
        if (daysToAdd <= 0) daysToAdd += 7;
      } else if (prefix === '下下') {
        daysToAdd += 14;
        if (daysToAdd <= 0) daysToAdd += 7;
      }

      const result = new Date(today);
      result.setDate(result.getDate() + daysToAdd);
      return formatDate(result);
    }
  }

  if (input.includes('周末')) {
    const prefix = input.includes('下') ? 7 : 0;
    const saturday = new Date(today);
    const currentWeekDay = today.getDay();
    let daysToSaturday = 6 - currentWeekDay;
    if (daysToSaturday < 0) daysToSaturday += 7;
    saturday.setDate(saturday.getDate() + daysToSaturday + prefix);
    return formatDate(saturday);
  }

  return null;
}

export function normalizeBudget(text: unknown): BudgetResult {
  if (typeof text !== 'string') return { interval: null, confidence: 0 };
  const input = String(toHalfWidth(text)).trim();

  const patterns = [
    { regex: /(1000\s*以下|1k\s*以下|一千以下|低于\s*1000|低于\s*1k|几百|^\s*1000\s*[元块]?\s*$)/i, interval: '1000元以下', confidence: 0.95 },
    { regex: /(1000\s*[-~到至]\s*2000|1000\s*多|1k\s*[-~到至]\s*2k|1k\s*多|一千多|1000左右|1k左右|一千几|1k几|大概?\s*一千\s*[到至-]\s*两千)/i, interval: '1000-2000元', confidence: 0.9 },
    { regex: /(2000\s*[-~到至]\s*3000|2000\s*多|2k\s*[-~到至]\s*3k|2k\s*多|两千多|两三千|2000左右|2k左右|两千几|2k几|大概?\s*两千\s*[到至-]\s*三千)/i, interval: '2000-3000元', confidence: 0.9 },
    { regex: /(3000\s*[-~到至]\s*5000|3000\s*多|3k\s*[-~到至]\s*5k|3k\s*多|三千多|三四千|3000左右|3k左右|3-5k|3到5k|三千几|3k几|大概?\s*三千\s*[到至-]\s*五千|四千左右|4k左右)/i, interval: '3000-5000元', confidence: 0.9 },
    { regex: /(5000\s*以上|5000\s*多|5k\s*以上|5k\s*多|五千多|五六千|六七千|七八千|八九千|5000左右|5k左右|5-8k|5到8k|8-10k|8到10k|1w|1万|一万|10000|w\+|1w\+|近万|大概?\s*五千\s*[到至-]\s*八千)/i, interval: '5000元以上', confidence: 0.9 },
  ];

  for (const pattern of patterns) {
    if (pattern.regex.test(input)) {
      return { interval: pattern.interval, confidence: pattern.confidence };
    }
  }

  const numMatch = input.match(/(\d+(?:\.\d+)?)\s*[kKwW]?/);
  if (numMatch) {
    let num = parseFloat(numMatch[1]);
    if (/[kK]/.test(input)) num *= 1000;
    if (num < 1000) return { interval: '1000元以下', confidence: 0.6 };
    if (num <= 2000) return { interval: '1000-2000元', confidence: 0.5 };
    if (num <= 3000) return { interval: '2000-3000元', confidence: 0.5 };
    if (num <= 5000) return { interval: '3000-5000元', confidence: 0.5 };
    return { interval: '5000元以上', confidence: 0.5 };
  }

  return { interval: null, confidence: 0 };
}

export function findMatchingStyle(input: unknown, styleSynonyms: Record<string, string[]> | null | undefined): StyleMatch | null {
  if (!input || !styleSynonyms || typeof input !== 'string') return null;

  const lowerInput = input.toLowerCase();
  for (const [style, synonyms] of Object.entries(styleSynonyms)) {
    if (style.toLowerCase().includes(lowerInput) || lowerInput.includes(style.toLowerCase())) {
      return { style, confidence: 0.9 };
    }
    for (const synonym of synonyms) {
      if (lowerInput.includes(synonym.toLowerCase())) {
        return { style, confidence: 0.85 };
      }
    }
  }
  return null;
}

export function findMatchingShootType(input: unknown, shootTypeMapping: Record<string, { synonyms?: string[]; confidence?: number; needsConfirmation?: boolean }> | null | undefined): ShootTypeMatch | null {
  if (!input || !shootTypeMapping || typeof input !== 'string') return null;

  const lowerInput = input.toLowerCase();
  for (const [type, mapping] of Object.entries(shootTypeMapping)) {
    for (const synonym of mapping.synonyms || []) {
      if (lowerInput.includes(synonym.toLowerCase())) {
        return {
          type,
          confidence: mapping.confidence ?? 0.9,
          needsConfirmation: mapping.needsConfirmation || false,
        };
      }
    }
  }
  return null;
}
