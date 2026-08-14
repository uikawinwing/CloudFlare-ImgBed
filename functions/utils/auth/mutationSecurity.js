export function rejectCrossSiteMutation(request) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return null;
    const expectedOrigin = new URL(request.url).origin;
    const origin = request.headers.get('Origin');
    const fetchSite = request.headers.get('Sec-Fetch-Site');
    if ((origin && origin !== expectedOrigin) || (fetchSite && !['same-origin', 'none'].includes(fetchSite))) {
        return new Response(JSON.stringify({ error: 'Cross-site request rejected' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
    }
    return null;
}
