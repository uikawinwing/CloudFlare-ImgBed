// Legacy public WebDAV service has been removed.
// WebDAV remains available only as an administrator-managed storage backend.
export function onRequest() {
    return new Response('WebDAV service has been removed', {
        status: 410,
        headers: {
            'Content-Type': 'text/plain; charset=UTF-8',
            'Cache-Control': 'no-store',
        },
    });
}
