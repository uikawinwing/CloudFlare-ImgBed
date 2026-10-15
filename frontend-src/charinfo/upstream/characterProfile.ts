import { isSupportedRemoteImageUrl, isSupportedRemoteMediaUrl } from './remoteMediaUrl.ts';

export interface GalleryImage {
  title: string;
  sources: string[];
  thumbnail?: string;
  viewerVisible?: boolean;
}

export interface CharacterStorySection {
  title: string;
  content: string;
}

export interface CharacterProfileMetadata {
  author?: string;
  version?: string;
  author_note?: string;
  sex?: string;
  race?: string;
  story_sections?: CharacterStorySection[];
}

/**
 * 角色展示档案。Metadata 是可选附加资料；通过 validateProfile 的有效档案必须提供
 * 至少一个角色卡可用图片来源（本地 gallery 或 remoteGalleryUrl）。
 */
export interface CharacterProfile {
  characterName: string;
  avatarUrl: string;
  coverUrl: string;
  raceColor: string;
  tierColor: string;
  entranceQuote: string;
  gallery: GalleryImage[];
  remoteGalleryUrl?: string;
  metadata?: CharacterProfileMetadata;
}

type StoredGalleryImage = {
  title?: unknown;
  sources?: unknown;
  url?: unknown;
  thumbnail?: unknown;
  viewerVisible?: unknown;
  viewer_visible?: unknown;
};

type StoredCharacterProfile = Omit<
  CharacterProfile,
  'gallery' | 'metadata' | 'coverUrl' | 'remoteGalleryUrl'
> & {
  coverUrl?: unknown;
  remoteGalleryUrl?: unknown;
  /** v2 managed blocks created before the terminology refactor used this source-only property name. */
  galleryPackUrl?: unknown;
  gallery: StoredGalleryImage[];
  metadata?: unknown;
};

export type ManagedBlockInspection =
  | { state: 'absent' }
  | { state: 'valid'; profile: CharacterProfile; start: number; end: number }
  | { state: 'malformed'; reason: string }
  | { state: 'multiple'; reason: string };

export const DEFAULT_RACE_COLOR = '#A9DBC3';
export const DEFAULT_TIER_COLOR = '#B7D9E8';
export const CHAR_INFO_PROFILE_SCHEMA_VERSION = 2;
export const MANAGED_BLOCK_START = '<%# char-info-ejs-builder:start:v2 %>';
export const MANAGED_BLOCK_END = '<%# char-info-ejs-builder:end:v2 %>';
export const STATUS_GALLERY_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.avif'] as const;

export interface StatusGalleryImage {
  title: string;
  url: string;
}

export function isStatusGalleryImageUrl(value: string): boolean {
  try {
    const pathname = new URL(value).pathname.toLowerCase();
    return STATUS_GALLERY_IMAGE_EXTENSIONS.some(extension => pathname.endsWith(extension));
  } catch {
    return false;
  }
}

export function buildStatusGalleryImages(gallery: readonly GalleryImage[]): StatusGalleryImage[] {
  return gallery.flatMap(image => {
    const url =
      image.sources.find(isStatusGalleryImageUrl) ??
      (image.thumbnail && isStatusGalleryImageUrl(image.thumbnail) ? image.thumbnail : '');
    return url ? [{ title: image.title, url }] : [];
  });
}

export function countUnsupportedStatusGalleryItems(gallery: readonly GalleryImage[]): number {
  return gallery.length - buildStatusGalleryImages(gallery).length;
}

const LEGACY_MANAGED_BLOCK_START = '<%# char-info-ejs-builder:start:v1 %>';
const LEGACY_MANAGED_BLOCK_END = '<%# char-info-ejs-builder:end:v1 %>';
const LEGACY_DATA_MARKER_PREFIX = '<%# char-info-ejs-builder:data:v1:';
const HEX_PATTERN = /^#[0-9A-F]{6}$/;
const MAX_CHARACTER_NAME_LENGTH = 80;
const RESERVED_CHARACTER_NAMES = new Set(['__proto__', 'prototype', 'constructor']);

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some(character => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

function hasEjsDelimiter(value: string): boolean {
  return value.includes('<%') || value.includes('%>');
}

function validateEjsSafeText(errors: string[], label: string, value: string): void {
  if (hasEjsDelimiter(value)) {
    errors.push(`${label}不能包含 <% 或 %> EJS 模板分隔符。`);
  }
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

export function normalizeProfileMetadata(value: unknown): CharacterProfileMetadata | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const author = normalizeOptionalText(raw.author);
  const version = normalizeOptionalText(raw.version);
  const authorNote = normalizeOptionalText(raw.author_note);
  const sex = normalizeOptionalText(raw.sex);
  const race = normalizeOptionalText(raw.race);
  const storySections = Array.isArray(raw.story_sections)
    ? raw.story_sections.reduce<CharacterStorySection[]>((sections, section) => {
        if (!section || typeof section !== 'object' || Array.isArray(section)) return sections;
        const record = section as Record<string, unknown>;
        const title = normalizeOptionalText(record.title);
        const content = normalizeOptionalText(record.content);
        if (!title || !content) return sections;
        sections.push({ title, content });
        return sections;
      }, [])
    : [];

  if (!author && !version && !authorNote && !sex && !race && storySections.length === 0) return undefined;
  return {
    ...(author ? { author } : {}),
    ...(version ? { version } : {}),
    ...(authorNote ? { author_note: authorNote } : {}),
    ...(sex ? { sex } : {}),
    ...(race ? { race } : {}),
    ...(storySections.length > 0 ? { story_sections: storySections } : {}),
  };
}

export function validateProfileMetadata(metadata?: CharacterProfileMetadata): string[] {
  if (!metadata) return [];
  const errors: string[] = [];
  if (metadata.author) validateEjsSafeText(errors, '作者', metadata.author);
  if (metadata.version) validateEjsSafeText(errors, '版本标记', metadata.version);
  if (metadata.author_note) validateEjsSafeText(errors, '作者说明', metadata.author_note);
  if (metadata.sex) validateEjsSafeText(errors, '性别', metadata.sex);
  if (metadata.race) validateEjsSafeText(errors, '种族', metadata.race);
  metadata.story_sections?.forEach((section, index) => {
    validateEjsSafeText(errors, `第 ${index + 1} 个故事栏目的标题`, section.title);
    validateEjsSafeText(errors, `第 ${index + 1} 个故事栏目的内容`, section.content);
  });
  return errors;
}

export function createEmptyProfile(characterName = ''): CharacterProfile {
  return {
    characterName,
    avatarUrl: '',
    coverUrl: '',
    raceColor: '',
    tierColor: '',
    entranceQuote: '',
    gallery: [{ title: '主立绘', sources: [''] }],
  };
}

export function isHttpsUrl(value: string): boolean {
  if (!value.trim()) return false;
  try {
    return new URL(value.trim()).protocol === 'https:';
  } catch {
    return false;
  }
}

export function normalizeHex(value: string): string {
  const normalized = value.trim().toUpperCase();
  return normalized.startsWith('#') ? normalized : `#${normalized}`;
}

export function validateProfile(profile: CharacterProfile): string[] {
  const errors: string[] = [];
  const characterName = profile.characterName.trim();
  if (!characterName) errors.push('角色姓名不能为空。');
  if (characterName.length > MAX_CHARACTER_NAME_LENGTH) {
    errors.push(`角色姓名不能超过 ${MAX_CHARACTER_NAME_LENGTH} 个字符。`);
  }
  if (hasControlCharacter(characterName)) {
    errors.push('角色姓名不能包含换行、制表符或其他控制字符。');
  }
  if (RESERVED_CHARACTER_NAMES.has(characterName)) {
    errors.push(`角色姓名“${characterName}”属于系统保留名称，请更换。`);
  }
  validateEjsSafeText(errors, '角色姓名', profile.characterName);
  validateEjsSafeText(errors, '头像 URL', profile.avatarUrl);
  validateEjsSafeText(errors, '封面 URL', profile.coverUrl);
  validateEjsSafeText(errors, '登场台词', profile.entranceQuote);
  if (profile.remoteGalleryUrl) validateEjsSafeText(errors, '远程图库 URL', profile.remoteGalleryUrl);
  if (profile.avatarUrl.trim() && !isHttpsUrl(profile.avatarUrl)) errors.push('头像必须使用有效的 HTTPS URL。');
  if (profile.coverUrl.trim() && !isHttpsUrl(profile.coverUrl)) errors.push('角色库封面必须使用有效的 HTTPS URL。');
  if (profile.remoteGalleryUrl?.trim() && !isHttpsUrl(profile.remoteGalleryUrl)) {
    errors.push('远程图库必须使用有效的 HTTPS URL。');
  }
  const hasRemoteGallery = !!profile.remoteGalleryUrl?.trim() && isHttpsUrl(profile.remoteGalleryUrl);
  if (profile.avatarUrl.trim() && isHttpsUrl(profile.avatarUrl) && !isSupportedRemoteImageUrl(profile.avatarUrl)) {
    errors.push('头像只支持 PNG / JPG / JPEG / GIF / APNG / WebP / AVIF 图片直链。');
  }
  if (profile.coverUrl.trim() && isHttpsUrl(profile.coverUrl) && !isSupportedRemoteImageUrl(profile.coverUrl)) {
    errors.push('角色库封面只支持 PNG / JPG / JPEG / GIF / APNG / WebP / AVIF 图片直链。');
  }
  if (profile.raceColor.trim() && !HEX_PATTERN.test(normalizeHex(profile.raceColor))) {
    errors.push('种族颜色必须使用 #RRGGBB 格式。');
  }
  if (profile.tierColor.trim() && !HEX_PATTERN.test(normalizeHex(profile.tierColor))) {
    errors.push('阶层颜色必须使用 #RRGGBB 格式。');
  }
  if (!hasRemoteGallery && profile.gallery.length === 0) errors.push('至少需要一张主立绘。');
  if (!hasRemoteGallery && profile.gallery.length > 0 && !profile.gallery.some(image => image.viewerVisible !== false)) {
    errors.push('至少需要一张用于角色卡的主立绘。');
  }

  profile.gallery.forEach((image, index) => {
    validateEjsSafeText(errors, `第 ${index + 1} 张立绘标题`, image.title);
    if (image.thumbnail?.trim()) {
      validateEjsSafeText(errors, `第 ${index + 1} 张立绘缩略图 URL`, image.thumbnail);
      if (!isHttpsUrl(image.thumbnail) || !isSupportedRemoteImageUrl(image.thumbnail)) {
        errors.push(`第 ${index + 1} 张立绘缩略图必须使用受支持的 HTTPS 图片直链。`);
      }
    }
    const sources = readGallerySources(image);
    if (sources.length === 0) {
      if (!hasRemoteGallery) errors.push(`第 ${index + 1} 张立绘至少需要一个有效的 HTTPS URL。`);
      return;
    }
    sources.forEach((source, sourceIndex) => {
      validateEjsSafeText(errors, `第 ${index + 1} 张立绘的第 ${sourceIndex + 1} 个 URL`, source);
      if (!isHttpsUrl(source)) {
        errors.push(`第 ${index + 1} 张立绘的第 ${sourceIndex + 1} 个 URL 必须使用有效的 HTTPS URL。`);
      } else if (!isSupportedRemoteMediaUrl(source)) {
        errors.push(
          `第 ${index + 1} 张立绘的第 ${sourceIndex + 1} 个 URL 只支持 PNG / JPG / JPEG / GIF / APNG / WebP / AVIF / MP4 / WebM 直链。`,
        );
      }
    });
  });
  errors.push(...validateProfileMetadata(profile.metadata));
  return errors;
}

function readGallerySources(image: StoredGalleryImage): string[] {
  const candidates = Array.isArray(image.sources) ? image.sources : [image.url];
  return candidates.reduce<string[]>((sources, candidate) => {
    if (typeof candidate !== 'string') return sources;
    const source = candidate.trim();
    if (source && !sources.includes(source)) sources.push(source);
    return sources;
  }, []);
}

export function normalizeProfile(
  profile: CharacterProfile | StoredCharacterProfile,
): CharacterProfile {
  const legacyGalleryPackUrl =
    'galleryPackUrl' in profile && typeof profile.galleryPackUrl === 'string' ? profile.galleryPackUrl.trim() : '';
  const remoteGalleryUrl =
    typeof profile.remoteGalleryUrl === 'string' ? profile.remoteGalleryUrl.trim() : legacyGalleryPackUrl;
  const metadata = normalizeProfileMetadata(profile.metadata);
  return {
    characterName: profile.characterName.trim(),
    avatarUrl: profile.avatarUrl.trim(),
    coverUrl: typeof profile.coverUrl === 'string' ? profile.coverUrl.trim() : '',
    raceColor: profile.raceColor.trim() ? normalizeHex(profile.raceColor) : '',
    tierColor: profile.tierColor.trim() ? normalizeHex(profile.tierColor) : '',
    entranceQuote: profile.entranceQuote.trim(),
    gallery: profile.gallery.map((image, index) => ({
      title:
        (typeof image.title === 'string' ? image.title.trim() : '') ||
        (index === 0 ? '主立绘' : `备用立绘 ${index + 1}`),
      sources: readGallerySources(image),
      ...(typeof image.thumbnail === 'string' && image.thumbnail.trim() ? { thumbnail: image.thumbnail.trim() } : {}),
      ...(image.viewerVisible === false || ('viewer_visible' in image && image.viewer_visible === false)
        ? { viewerVisible: false }
        : {}),
    })),
    ...(remoteGalleryUrl ? { remoteGalleryUrl } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function decodeLegacyProfile(value: string): StoredCharacterProfile {
  const base64 = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as StoredCharacterProfile;
}

function countOccurrences(content: string, target: string): number {
  if (!target) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = content.indexOf(target, offset)) !== -1) {
    count += 1;
    offset += target.length;
  }
  return count;
}

function extractV2Profile(block: string): StoredCharacterProfile {
  const assignment = 'const profile =';
  const assignmentStart = block.indexOf(assignment);
  if (assignmentStart === -1) {
    throw new Error('v2 区块必须包含且只包含一份 profile 配置。');
  }

  let cursor = assignmentStart + assignment.length;
  while (cursor < block.length && /\s/.test(block[cursor])) cursor += 1;
  if (block[cursor] !== '{') {
    throw new Error('v2 profile 必须是 JSON 对象。');
  }

  const objectStart = cursor;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let objectEnd = -1;

  for (; cursor < block.length; cursor += 1) {
    const character = block[cursor];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        objectEnd = cursor + 1;
        break;
      }
    }
  }

  if (objectEnd === -1 || inString || depth !== 0) {
    throw new Error('v2 profile JSON 对象没有正确闭合。');
  }
  if (countOccurrences(block.slice(0, objectStart) + block.slice(objectEnd), assignment) !== 1) {
    throw new Error('v2 区块必须包含且只包含一份 profile 配置。');
  }

  cursor = objectEnd;
  while (cursor < block.length && /\s/.test(block[cursor])) cursor += 1;
  if (block[cursor] !== ';') {
    throw new Error('v2 profile 配置末尾缺少分号。');
  }

  return JSON.parse(block.slice(objectStart, objectEnd)) as StoredCharacterProfile;
}

export function inspectManagedBlock(content: string): ManagedBlockInspection {
  const v2StartCount = countOccurrences(content, MANAGED_BLOCK_START);
  const v2EndCount = countOccurrences(content, MANAGED_BLOCK_END);
  const v1StartCount = countOccurrences(content, LEGACY_MANAGED_BLOCK_START);
  const v1EndCount = countOccurrences(content, LEGACY_MANAGED_BLOCK_END);
  const startCount = v2StartCount + v1StartCount;
  const endCount = v2EndCount + v1EndCount;

  if (startCount === 0 && endCount === 0) return { state: 'absent' };
  if (startCount !== 1 || endCount !== 1) {
    return {
      state: startCount > 1 || endCount > 1 ? 'multiple' : 'malformed',
      reason:
        startCount > 1 || endCount > 1
          ? '检测到多个自动生成区块，已停止自动编辑。'
          : '自动生成区块的开始或结束标记缺失，已停止自动编辑。',
    };
  }

  const isV2 = v2StartCount === 1;
  if ((isV2 && v2EndCount !== 1) || (!isV2 && v1EndCount !== 1)) {
    return { state: 'malformed', reason: '自动生成区块的版本标记不匹配，已停止自动编辑。' };
  }

  const startMarker = isV2 ? MANAGED_BLOCK_START : LEGACY_MANAGED_BLOCK_START;
  const endMarker = isV2 ? MANAGED_BLOCK_END : LEGACY_MANAGED_BLOCK_END;
  const start = content.indexOf(startMarker);
  const endMarkerStart = content.indexOf(endMarker);
  if (endMarkerStart < start) {
    return { state: 'malformed', reason: '自动生成区块的标记顺序错误，已停止自动编辑。' };
  }

  const end = endMarkerStart + endMarker.length;
  const block = content.slice(start, end);

  try {
    let rawProfile: StoredCharacterProfile;
    if (isV2) {
      rawProfile = extractV2Profile(block);
    } else {
      const dataPattern = new RegExp(
        `${LEGACY_DATA_MARKER_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([A-Za-z0-9_-]+)\\s*%>`,
      );
      const dataMatch = block.match(dataPattern);
      if (!dataMatch) {
        return { state: 'malformed', reason: '旧版自动生成区块缺少可编辑资料，已停止自动编辑。' };
      }
      rawProfile = decodeLegacyProfile(dataMatch[1]);
    }

    const profile = normalizeProfile(rawProfile);
    const errors = validateProfile(profile);
    if (errors.length > 0) {
      return { state: 'malformed', reason: `自动生成区块内的资料无效：${errors[0]}` };
    }
    return { state: 'valid', profile, start, end };
  } catch (error) {
    return {
      state: 'malformed',
      reason: `无法读取自动生成区块：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function hasUnmanagedVisualEjs(content: string): boolean {
  if (inspectManagedBlock(content).state !== 'absent') return false;
  return (
    content.includes('char_info.profiles') ||
    content.includes('char_info_visuals') ||
    content.includes('char_info.visual') ||
    content.includes('status.externalGalleries.partners')
  );
}

export function extractManagedEjsBlock(content: string): { profile: CharacterProfile; code: string } {
  const inspection = inspectManagedBlock(content);
  if (inspection.state !== 'valid') {
    throw new Error(
      inspection.state === 'absent'
        ? '当前条目没有 CharInfo 受管理 EJS。'
        : inspection.state === 'malformed' || inspection.state === 'multiple'
          ? inspection.reason
          : '无法读取 CharInfo 受管理 EJS。',
    );
  }

  return {
    profile: inspection.profile,
    code: content.slice(inspection.start, inspection.end),
  };
}

export function buildManagedEjsBlock(input: CharacterProfile): string {
  const profile = normalizeProfile(input);
  const errors = validateProfile(profile);
  if (errors.length > 0) throw new Error(errors[0]);

  const lines = [MANAGED_BLOCK_START, '<%_', '{'];
  const profileLines = JSON.stringify(profile, null, 2).split('\n');
  lines.push(`  const profile = ${profileLines[0]}`);
  profileLines.slice(1).forEach((line, index, remainingLines) => {
    lines.push(`  ${line}${index === remainingLines.length - 1 ? ';' : ''}`);
  });
  lines.push('', '  const npcName = profile.characterName;', '');
  lines.push(`  const statusGalleryExtensions = ${JSON.stringify(STATUS_GALLERY_IMAGE_EXTENSIONS)};`);
  lines.push('  const statusGalleryImages = profile.gallery.flatMap(image => {');
  lines.push('    const candidates = [...image.sources, ...(image.thumbnail ? [image.thumbnail] : [])];');
  lines.push('    const url = candidates.find(value => {');
  lines.push('      try {');
  lines.push('        const pathname = new URL(value).pathname.toLowerCase();');
  lines.push('        return statusGalleryExtensions.some(extension => pathname.endsWith(extension));');
  lines.push('      } catch {');
  lines.push('        return false;');
  lines.push('      }');
  lines.push("    }) ?? '';");
  lines.push('    return url ? [{ title: image.title, url }] : [];');
  lines.push('  });', '');
  lines.push('  setLocalVar(`char_info.profiles[${JSON.stringify(npcName)}]`, {');
  lines.push(`    schema_version: ${CHAR_INFO_PROFILE_SCHEMA_VERSION},`);
  lines.push('    ...(profile.remoteGalleryUrl ? { gallery_pack_url: profile.remoteGalleryUrl } : {}),');
  lines.push('    ...(profile.coverUrl ? { cover_url: profile.coverUrl } : {}),');
  lines.push('    ...(profile.raceColor ? { custom_racecolor: profile.raceColor } : {}),');
  lines.push('    ...(profile.tierColor ? { custom_tiercolor: profile.tierColor } : {}),');
  lines.push("    ...(profile.entranceQuote ? { '登场台词': profile.entranceQuote } : {}),");
  lines.push(
    '    gallery: profile.gallery.map(image => ({ title: image.title, sources: image.sources, ...(image.thumbnail ? { thumbnail: image.thumbnail } : {}), ...(image.viewerVisible === false ? { viewer_visible: false } : {}) })),',
  );
  if (profile.metadata) {
    lines.push('    metadata: profile.metadata,');
  }
  lines.push('  });', '');

  lines.push('  if (profile.avatarUrl) {');
  lines.push('    setLocalVar(');
  lines.push('      `status.externalAvatars.partners[${JSON.stringify(npcName)}].url`,');
  lines.push('      profile.avatarUrl,');
  lines.push('    );');
  lines.push('  }');
  lines.push('');
  lines.push('  setLocalVar(');
  lines.push('    `status.externalGalleries.partners[${JSON.stringify(npcName)}].images`,');
  lines.push('    statusGalleryImages,');
  lines.push('  );');

  lines.push('}');
  lines.push('_%>');
  lines.push(MANAGED_BLOCK_END);

  return lines.join('\n');
}

function detectLineEnding(content: string): '\r\n' | '\n' {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

function insertAfterDecorators(content: string, block: string, newline: string): string {
  const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
  const source = bom ? content.slice(1) : content;
  if (!source) return `${bom}${block}`;

  const lines = source.split(/\r?\n/);
  let decoratorCount = 0;
  while (decoratorCount < lines.length && /^@@\S/.test(lines[decoratorCount])) {
    decoratorCount += 1;
  }

  if (decoratorCount === 0) return `${bom}${block}${newline}${source}`;

  const decorators = lines.slice(0, decoratorCount).join(newline);
  const remainder = lines.slice(decoratorCount).join(newline);
  return `${bom}${decorators}${newline}${block}${remainder ? `${newline}${remainder}` : ''}`;
}

export function upsertManagedEjsBlock(content: string, profile: CharacterProfile): string {
  const inspection = inspectManagedBlock(content);
  if (inspection.state === 'malformed' || inspection.state === 'multiple') {
    throw new Error(inspection.reason);
  }
  if (inspection.state === 'absent' && hasUnmanagedVisualEjs(content)) {
    throw new Error('检测到未标记的旧版角色视觉 EJS。为避免重复写入，请先手动移除旧区块。');
  }

  const newline = detectLineEnding(content);
  const block = buildManagedEjsBlock(profile).replace(/\n/g, newline);
  if (inspection.state === 'valid') {
    return `${content.slice(0, inspection.start)}${block}${content.slice(inspection.end)}`;
  }
  return insertAfterDecorators(content, block, newline);
}
