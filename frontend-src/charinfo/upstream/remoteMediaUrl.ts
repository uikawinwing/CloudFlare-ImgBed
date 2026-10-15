export type RemoteMediaKind = 'image' | 'video';

const REMOTE_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.apng', '.webp', '.avif'] as const;
const REMOTE_VIDEO_EXTENSIONS = ['.mp4', '.webm'] as const;

function parseRemoteUrl(value: string): URL | null {
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

export function remoteMediaKindFromUrl(value: string): RemoteMediaKind | null {
  const parsed = parseRemoteUrl(value);
  if (!parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;

  const pathname = parsed.pathname.toLowerCase();
  if (REMOTE_VIDEO_EXTENSIONS.some(extension => pathname.endsWith(extension))) return 'video';
  if (REMOTE_IMAGE_EXTENSIONS.some(extension => pathname.endsWith(extension))) return 'image';
  return null;
}

export function isSupportedRemoteMediaUrl(value: string): boolean {
  return remoteMediaKindFromUrl(value) !== null;
}

export function isSupportedRemoteImageUrl(value: string): boolean {
  return remoteMediaKindFromUrl(value) === 'image';
}
