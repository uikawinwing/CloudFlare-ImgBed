import JSON5 from 'json5';

import {
  createEmptyProfile,
  inspectManagedBlock,
  isHttpsUrl,
  normalizeHex,
  normalizeProfile,
  upsertManagedEjsBlock,
  validateProfile,
  type CharacterProfile,
} from './characterProfile.ts';

// json5 is CommonJS in the Node test runtime, so its synthetic named export is not portable here.
// eslint-disable-next-line import-x/no-named-as-default-member
const { parse: parseJson5 } = JSON5;

export type LegacyVisualRoot = 'char_info_visuals' | 'char_info.visual' | 'char_info.visuals';

export type LegacyVisualInspection =
  | { state: 'absent' }
  | {
      state: 'importable';
      sourceRoot: LegacyVisualRoot;
      characterName: string;
      profile: CharacterProfile;
      start: number;
      end: number;
      warnings: string[];
    }
  | { state: 'unsupported'; reason: string };

type ParsedLegacyAssignment = {
  sourceRoot: LegacyVisualRoot;
  characterName: string;
  value: Record<string, unknown>;
  start: number;
  end: number;
};

type ParsedCall =
  | { kind: 'ignore' }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'assignment'; assignment: ParsedLegacyAssignment };

const LEGACY_ROOTS: LegacyVisualRoot[] = ['char_info_visuals', 'char_info.visual', 'char_info.visuals'];
const LEGACY_COLOR_PATTERN = /^#[0-9A-F]{6}$/;
const KNOWN_LEGACY_KEYS = new Set(['url', 'gallery', 'custom_racecolor', 'custom_tiercolor', '登场台词']);

function mentionsLegacyRoot(value: string): boolean {
  return LEGACY_ROOTS.some(root => value.includes(root));
}

function skipTrivia(source: string, start: number): number {
  let cursor = start;
  while (cursor < source.length) {
    if (/\s/.test(source[cursor])) {
      cursor += 1;
      continue;
    }
    if (source.startsWith('//', cursor)) {
      const newline = source.indexOf('\n', cursor + 2);
      return newline === -1 ? source.length : skipTrivia(source, newline + 1);
    }
    if (source.startsWith('/*', cursor)) {
      const end = source.indexOf('*/', cursor + 2);
      return end === -1 ? source.length : skipTrivia(source, end + 2);
    }
    break;
  }
  return cursor;
}

function readQuotedLiteral(source: string, start: number): { literal: string; end: number } | null {
  const quote = source[start];
  if (quote !== '"' && quote !== "'") return null;

  let escaped = false;
  for (let cursor = start + 1; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === quote) {
      return { literal: source.slice(start, cursor + 1), end: cursor + 1 };
    }
  }
  return null;
}

function findCallEnd(source: string, openParen: number): number | null {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let cursor = openParen; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    const next = source[cursor + 1];

    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        cursor += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '/' && next === '/') {
      lineComment = true;
      cursor += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      cursor += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
      if (depth === 0) return cursor + 1;
    }
  }

  return null;
}

function readBalancedObject(source: string, start: number): { objectSource: string; end: number } | null {
  if (source[start] !== '{') return null;

  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let cursor = start; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    const next = source[cursor + 1];

    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        cursor += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '/' && next === '/') {
      lineComment = true;
      cursor += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      cursor += 1;
      continue;
    }
    if (character === '`') return null;
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return { objectSource: source.slice(start, cursor + 1), end: cursor + 1 };
      }
    }
  }

  return null;
}

function parseLegacyPath(path: string): { sourceRoot: LegacyVisualRoot; characterName: string } | null {
  const patterns: Array<{ sourceRoot: LegacyVisualRoot; pattern: RegExp }> = [
    {
      sourceRoot: 'char_info_visuals',
      pattern: /^char_info_visuals\s*\[\s*((?:"(?:\\.|[^"\\])*")|(?:'(?:\\.|[^'\\])*'))\s*\]\s*$/s,
    },
    {
      sourceRoot: 'char_info.visual',
      pattern: /^char_info\s*\.\s*visual\s*\[\s*((?:"(?:\\.|[^"\\])*")|(?:'(?:\\.|[^'\\])*'))\s*\]\s*$/s,
    },
    {
      sourceRoot: 'char_info.visuals',
      pattern: /^char_info\s*\.\s*visuals\s*\[\s*((?:"(?:\\.|[^"\\])*")|(?:'(?:\\.|[^'\\])*'))\s*\]\s*$/s,
    },
  ];

  for (const candidate of patterns) {
    const match = path.match(candidate.pattern);
    if (!match) continue;
    try {
      const characterName = parseJson5(match[1]);
      if (typeof characterName === 'string' && characterName.trim()) {
        return { sourceRoot: candidate.sourceRoot, characterName };
      }
    } catch {
      return null;
    }
  }
  return null;
}

function parseLegacySetLocalVarCall(source: string, start: number, openParen: number): ParsedCall {
  const callEnd = findCallEnd(source, openParen);
  if (callEnd === null) {
    return mentionsLegacyRoot(source.slice(start))
      ? { kind: 'unsupported', reason: '检测到未闭合的旧版 setLocalVar 调用，无法安全自动读取。' }
      : { kind: 'ignore' };
  }

  let cursor = skipTrivia(source, openParen + 1);
  const pathLiteral = readQuotedLiteral(source, cursor);
  if (!pathLiteral) {
    return mentionsLegacyRoot(source.slice(openParen + 1, callEnd - 1))
      ? { kind: 'unsupported', reason: '旧版视觉路径使用了动态表达式，无法安全自动读取。' }
      : { kind: 'ignore' };
  }

  let pathValue: unknown;
  try {
    pathValue = parseJson5(pathLiteral.literal);
  } catch {
    return { kind: 'ignore' };
  }
  if (typeof pathValue !== 'string' || !mentionsLegacyRoot(pathValue)) return { kind: 'ignore' };

  const parsedPath = parseLegacyPath(pathValue);
  if (!parsedPath) {
    return {
      kind: 'unsupported',
      reason: '旧版视觉路径不是可静态识别的 char_info_visuals / char_info.visual[姓名] 形式。',
    };
  }

  cursor = skipTrivia(source, pathLiteral.end);
  if (source[cursor] !== ',') {
    return { kind: 'unsupported', reason: '旧版视觉 setLocalVar 缺少可识别的配置对象参数。' };
  }
  cursor = skipTrivia(source, cursor + 1);
  if (source[cursor] !== '{') {
    return { kind: 'unsupported', reason: '旧档案格式使用了变量或表达式，无法安全自动读取。' };
  }

  const object = readBalancedObject(source, cursor);
  if (!object) {
    return { kind: 'unsupported', reason: '旧档案格式对象包含动态模板或没有正确闭合。' };
  }

  cursor = skipTrivia(source, object.end);
  if (source[cursor] !== ')' || cursor !== callEnd - 1) {
    return { kind: 'unsupported', reason: '旧版视觉 setLocalVar 调用包含额外动态参数，无法安全自动读取。' };
  }

  let parsed: unknown;
  try {
    parsed = parseJson5(object.objectSource);
  } catch {
    return { kind: 'unsupported', reason: '旧档案格式不是纯静态 JSON/JSON5 对象，无法安全自动读取。' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'unsupported', reason: '旧档案格式必须是静态对象。' };
  }

  let end = callEnd;
  let semicolonCursor = callEnd;
  while (semicolonCursor < source.length && (source[semicolonCursor] === ' ' || source[semicolonCursor] === '\t')) {
    semicolonCursor += 1;
  }
  if (source[semicolonCursor] === ';') end = semicolonCursor + 1;

  return {
    kind: 'assignment',
    assignment: {
      sourceRoot: parsedPath.sourceRoot,
      characterName: parsedPath.characterName,
      value: parsed as Record<string, unknown>,
      start,
      end,
    },
  };
}

function readLegacyColor(value: unknown, label: string, warnings: string[]): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') {
    warnings.push(`${label}不是字符串，已跳过。`);
    return '';
  }
  const normalized = normalizeHex(value);
  if (!LEGACY_COLOR_PATTERN.test(normalized)) {
    warnings.push(`${label}不是有效的 #RRGGBB，已跳过。`);
    return '';
  }
  return normalized;
}

function addLegacyMediaUrl(urls: string[], value: unknown, label: string, warnings: string[]): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (typeof value !== 'string' || !isHttpsUrl(value)) {
    warnings.push(`${label}不是有效的 HTTPS 媒体 URL，已跳过。`);
    return false;
  }
  const normalized = value.trim();
  if (!urls.includes(normalized)) urls.push(normalized);
  return true;
}

function mapLegacyProfile(assignment: ParsedLegacyAssignment): LegacyVisualInspection {
  const warnings: string[] = [];
  const urls: string[] = [];
  const hasValidMainUrl = addLegacyMediaUrl(urls, assignment.value.url, '旧版 url', warnings);

  const gallery = assignment.value.gallery;
  let validGalleryCount = 0;
  if (gallery !== undefined) {
    if (!Array.isArray(gallery)) {
      warnings.push('旧版 gallery 不是静态数组，已跳过。');
    } else {
      gallery.forEach((value, index) => {
        if (addLegacyMediaUrl(urls, value, `旧版 gallery 第 ${index + 1} 项`, warnings)) validGalleryCount += 1;
      });
    }
  }

  if (urls.length === 0) {
    return { state: 'unsupported', reason: '旧档案格式中没有可迁移的有效 HTTPS 立绘 URL。' };
  }

  if (!hasValidMainUrl && validGalleryCount > 1) {
    warnings.push('旧版 gallery-only 配置可能随机显示首图；迁移后将固定使用第一张有效图片作为主立绘。');
  }

  const entranceQuote = assignment.value['登场台词'];
  let normalizedEntranceQuote = '';
  if (entranceQuote !== undefined && entranceQuote !== null) {
    if (typeof entranceQuote === 'string') {
      normalizedEntranceQuote = entranceQuote.trim();
    } else {
      warnings.push('旧版登场台词不是字符串，已跳过。');
    }
  }

  const unknownKeys = Object.keys(assignment.value).filter(key => !KNOWN_LEGACY_KEYS.has(key));
  if (unknownKeys.length > 0) warnings.push(`已忽略未识别的旧版字段：${unknownKeys.join('、')}。`);

  const profile = normalizeProfile({
    ...createEmptyProfile(assignment.characterName),
    avatarUrl: '',
    raceColor: readLegacyColor(assignment.value.custom_racecolor, '旧版 custom_racecolor', warnings),
    tierColor: readLegacyColor(assignment.value.custom_tiercolor, '旧版 custom_tiercolor', warnings),
    entranceQuote: normalizedEntranceQuote,
    gallery: urls.map((url, index) => ({
      title: index === 0 ? '主立绘' : `备用立绘 ${index + 1}`,
      sources: [url],
    })),
  });

  const errors = validateProfile(profile);
  if (errors.length > 0) {
    return { state: 'unsupported', reason: `旧档案格式转换后无法安全保存：${errors[0]}` };
  }

  return {
    state: 'importable',
    sourceRoot: assignment.sourceRoot,
    characterName: assignment.characterName,
    profile,
    start: assignment.start,
    end: assignment.end,
    warnings,
  };
}

export function inspectLegacyVisualProfile(content: string, expectedCharacterName?: string): LegacyVisualInspection {
  const assignments: ParsedLegacyAssignment[] = [];
  const unsupportedReasons: string[] = [];
  const parseStandaloneCall = (start: number, end: number) => {
    const candidate = content.slice(start, end);
    const leadingWhitespace = candidate.length - candidate.trimStart().length;
    const callStart = start + leadingWhitespace;
    const match = content.slice(callStart, end).match(/^setLocalVar\s*\(/);
    if (!match) return;
    const parsed = parseLegacySetLocalVarCall(content, callStart, callStart + match[0].length - 1);
    if (parsed.kind === 'assignment' && parsed.assignment.end <= end && !content.slice(parsed.assignment.end, end).trim()) {
      assignments.push(parsed.assignment);
    } else if (parsed.kind === 'unsupported') {
      unsupportedReasons.push(parsed.reason);
    }
  };

  if (!content.includes('<%')) {
    parseStandaloneCall(0, content.length);
  } else {
    // Only standalone EJS blocks can establish an unambiguous code boundary.
    // Quoted examples, comments and mixed JavaScript remain blocked, never edited.
    const blocks = /<%([\s\S]*?)%>/g;
    for (let match = blocks.exec(content); match; match = blocks.exec(content)) {
      const lineStart = content.lastIndexOf('\n', match.index - 1) + 1;
      const afterBlock = match.index + match[0].length;
      if (!/^[ \t]*$/.test(content.slice(lineStart, match.index)) || !/^[ \t]*(?:\r?\n|$)/.test(content.slice(afterBlock))) continue;
      const start = match.index + 2 + (match[1].startsWith('_') ? 1 : 0);
      const end = afterBlock - 2 - (match[1].endsWith('_') ? 1 : 0);
      parseStandaloneCall(start, end);
    }
  }

  if (assignments.length === 1) {
    const { start, end } = assignments[0];
    if (mentionsLegacyRoot(content.slice(0, start) + content.slice(end))) {
      unsupportedReasons.push('旧版视觉配置之外仍有旧格式引用，无法安全自动迁移。');
    }
  }

  if (assignments.length === 0) {
    if (unsupportedReasons.length > 0) return { state: 'unsupported', reason: unsupportedReasons[0] };
    return mentionsLegacyRoot(content)
      ? {
          state: 'unsupported',
          reason: '检测到旧版 CharInfo 视觉变量内容，但不是可安全静态导入的直接 setLocalVar 结构。',
        }
      : { state: 'absent' };
  }

  if (assignments.length > 1 || unsupportedReasons.length > 0) {
    return { state: 'unsupported', reason: '检测到多个或混合的旧版 CharInfo 视觉变量写入，无法判断唯一安全迁移目标。' };
  }

  const assignment = assignments[0];
  const expectedName = expectedCharacterName?.trim();
  if (expectedName && assignment.characterName !== expectedName) {
    return {
      state: 'unsupported',
      reason: `旧档案格式姓名“${assignment.characterName}”与当前角色“${expectedName}”不一致，已停止自动导入。`,
    };
  }

  return mapLegacyProfile(assignment);
}

export function upsertManagedEjsBlockWithLegacyMigration(
  content: string,
  profile: CharacterProfile,
): string {
  const managedInspection = inspectManagedBlock(content);
  if (managedInspection.state !== 'absent') {
    return upsertManagedEjsBlock(content, profile);
  }

  const legacyInspection = inspectLegacyVisualProfile(content, profile.characterName);
  if (legacyInspection.state === 'unsupported') throw new Error(legacyInspection.reason);
  if (legacyInspection.state === 'absent') return upsertManagedEjsBlock(content, profile);

  const withoutLegacyStatement = `${content.slice(0, legacyInspection.start)}${content.slice(legacyInspection.end)}`;
  return upsertManagedEjsBlock(withoutLegacyStatement, profile);
}
