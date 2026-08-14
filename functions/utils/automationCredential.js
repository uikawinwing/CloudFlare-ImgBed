export function hasExplicitAutomationCredential(request, url) {
    if (request.headers.get('Authorization') || request.headers.get('authCode') || url.searchParams.get('authCode')) return true;
    const referer = request.headers.get('Referer');
    if (referer) {
        try {
            if (new URL(referer).searchParams.get('authCode')) return true;
        } catch {}
    }
    return /(?:^|;\s*)authCode=/.test(request.headers.get('Cookie') || '');
}
