// The WebDAV service and storage backend have been retired.
export function onRequest() {
    return new Response('WebDAV service has been removed', {
        status: 410,
        headers: {
            'Content-Type': 'text/plain; charset=UTF-8',
            'Cache-Control': 'no-store',
        },
    });
}
