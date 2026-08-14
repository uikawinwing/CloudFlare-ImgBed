import { buildCookie, createDiscordSession, exchangeDiscordCode, fetchEligibleDiscordUser, getCookie, isDiscordAuthConfigured, upsertDiscordUser } from '../../../utils/auth/discordIdentity.js';

export async function onRequestGet({ request, env }) {
    const url = new URL(request.url);
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    if (!isDiscordAuthConfigured(env)) return new Response('Discord OAuth is not configured', { status: 503 });
    if (!state || state !== getCookie(request, 'discord_oauth_state') || !code) return new Response('Invalid OAuth state', { status: 400 });
    try {
        const token = await exchangeDiscordCode(env, code);
        const { user, roles } = await fetchEligibleDiscordUser(token.access_token);
        const identity = await upsertDiscordUser(env, user, roles);
        const { cookie } = await createDiscordSession(env, identity);
        const headers = new Headers({ Location: '/', 'Set-Cookie': cookie });
        headers.append('Set-Cookie', buildCookie('discord_oauth_state', '', 0));
        return new Response(null, { status: 302, headers });
    } catch (error) {
        return new Response(error.message === 'Discord role is required' || error.message === 'Discord guild membership is required' ? 'Discord eligibility is required' : 'Discord sign-in failed', { status: 403 });
    }
}
