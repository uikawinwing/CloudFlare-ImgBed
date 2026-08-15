import { buildCookie, getDiscordCallbackUrl, isDiscordAuthConfigured, makeOAuthState, sanitizeReturnTo } from '../../../utils/auth/discordIdentity.js';

export async function onRequestGet({ request, env }) {
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
    const returnTo = sanitizeReturnTo(new URL(request.url).searchParams.get('returnTo'));
    const headers = new Headers({ Location: authorizeUrl.toString() });
    headers.append('Set-Cookie', buildCookie('discord_oauth_state', state, 600));
    headers.append('Set-Cookie', buildCookie('discord_oauth_return_to', returnTo, 600));
    return new Response(null, { status: 302, headers });
}
