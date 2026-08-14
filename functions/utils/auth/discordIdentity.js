import { createSession, validateSession } from './sessionManager.js';

export const DISCORD_OWNER_ID = '589790434960867328';
export const DISCORD_GUILD_ID = '1134557553011998840';
export const DISCORD_REQUIRED_ROLE_ID = '1335363403870502912';
export const DISCORD_CALLBACK_URL = 'https://cloudflare-imgbed-dxx.pages.dev/api/auth/discord/callback';
export const USER_QUOTA_BYTES = 200 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 95 * 1024 * 1024;
export const ALLOWED_UPLOAD_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'video/mp4']);

export function isDiscordAuthConfigured(env) {
    return Boolean(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET);
}

export function getDiscordCallbackUrl(env) {
    return env.DISCORD_CALLBACK_URL || DISCORD_CALLBACK_URL;
}

export function getCookie(request, name) {
    const value = request.headers.get('Cookie') || '';
    const match = value.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[1]) : null;
}

export function buildCookie(name, value, maxAge, secure = true) {
    return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function makeOAuthState() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function exchangeDiscordCode(env, code) {
    const body = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: getDiscordCallbackUrl(env) });
    const response = await fetch('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (!response.ok) throw new Error('Discord token exchange failed');
    return response.json();
}

export async function fetchEligibleDiscordUser(accessToken) {
    const headers = { Authorization: `Bearer ${accessToken}` };
    const [userResponse, memberResponse] = await Promise.all([
        fetch('https://discord.com/api/users/@me', { headers }),
        fetch(`https://discord.com/api/users/@me/guilds/${DISCORD_GUILD_ID}/member`, { headers }),
    ]);
    if (!userResponse.ok || !memberResponse.ok) throw new Error('Discord guild membership is required');
    const [user, member] = await Promise.all([userResponse.json(), memberResponse.json()]);
    const roles = Array.isArray(member.roles) ? member.roles : [];
    if (user.id !== DISCORD_OWNER_ID && !roles.includes(DISCORD_REQUIRED_ROLE_ID)) throw new Error('Discord role is required');
    return { user, roles };
}

export function resolveAppRole(discordId, discordRoles, env) {
    return discordId === DISCORD_OWNER_ID ? 'owner' : 'member';
}

export async function upsertDiscordUser(env, user, discordRoles) {
    if (!env.img_d1?.prepare) throw new Error('Discord identity requires D1');
    const now = Date.now();
    const existing = await env.img_d1.prepare('SELECT role, status, public_handle FROM users WHERE discord_id = ?').bind(user.id).first();
    if (existing?.status === 'suspended' && user.id !== DISCORD_OWNER_ID) throw new Error('Account is suspended');
    const role = user.id === DISCORD_OWNER_ID ? 'owner' : (existing?.role || 'member');
    const username = user.global_name || user.username;
    const avatar = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : null;
    await env.img_d1.batch([
        env.img_d1.prepare('INSERT INTO users (discord_id, username, avatar, role, status, used_bytes, last_login_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(discord_id) DO UPDATE SET username = excluded.username, avatar = excluded.avatar, role = excluded.role, last_login_at = excluded.last_login_at, updated_at = excluded.updated_at').bind(user.id, username, avatar, role, 'active', 0, now, now, now),
        env.img_d1.prepare('DELETE FROM user_roles WHERE discord_id = ?').bind(user.id),
        ...[...new Set([...discordRoles, role])].map((value) => env.img_d1.prepare('INSERT INTO user_roles (discord_id, role) VALUES (?, ?)').bind(user.id, value)),
    ]);
    return { id: user.id, username, avatar, role, publicHandle: existing?.public_handle || null };
}

export async function createDiscordSession(env, identity) {
    return createSession(env, 'user', '', { identity, maxAgeSeconds: 24 * 60 * 60, secure: true });
}

export async function getDiscordIdentity(env, request) {
    const result = await validateSession(env, request, 'user');
    if (!result.valid || !result.session.identity) return null;
    if (!env.img_d1?.prepare) return result.session.identity;
    const user = await env.img_d1.prepare('SELECT username, avatar, public_handle, role, status FROM users WHERE discord_id = ?').bind(result.session.identity.id).first();
    if (!user || (user.status === 'suspended' && result.session.identity.id !== DISCORD_OWNER_ID)) return null;
    return { id: result.session.identity.id, username: user.username, avatar: user.avatar, publicHandle: user.public_handle, role: result.session.identity.id === DISCORD_OWNER_ID ? 'owner' : user.role };
}

export async function assertUploadAllowed(env, identity, file) {
    if (!ALLOWED_UPLOAD_TYPES.has(file.type)) throw new Error('Unsupported file type');
    if (file.size > MAX_UPLOAD_BYTES) throw new Error('File exceeds the 95MB limit');
    if (!env.img_d1?.prepare) throw new Error('Discord uploads require D1');
    const result = await env.img_d1.prepare('UPDATE users SET used_bytes = used_bytes + ?, updated_at = ? WHERE discord_id = ? AND (role = ? OR used_bytes + ? <= ?)').bind(file.size, Date.now(), identity.id, 'owner', file.size, USER_QUOTA_BYTES).run();
    if (!result.meta?.changes) throw new Error('User quota exceeded');
    return file.size;
}

export async function releaseUploadReservation(env, identity, bytes) {
    if (!bytes || !env.img_d1?.prepare) return;
    await env.img_d1.prepare('UPDATE users SET used_bytes = MAX(0, used_bytes - ?), updated_at = ? WHERE discord_id = ?').bind(bytes, Date.now(), identity.id).run();
}
