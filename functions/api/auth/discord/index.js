import { buildCookie, getDiscordCallbackUrl, isDiscordAuthConfigured, makeOAuthState } from '../../../utils/auth/discordIdentity.js';

export async function onRequestGet({ env }) {
    if (!isDiscordAuthConfigured(env)) return new Response('Discord OAuth is not configured', { status: 503 });
    const state = makeOAuthState();
    const authorizeUrl = new URL('https://discord.com/oauth2/authorize');
    authorizeUrl.search = new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        redirect_uri: getDiscordCallbackUrl(env),
        response_type: 'code',
        scope: 'identify guilds.members.read',
        state,
    }).toString();
    return new Response(null, { status: 302, headers: { Location: authorizeUrl.toString(), 'Set-Cookie': buildCookie('discord_oauth_state', state, 600) } });
}
