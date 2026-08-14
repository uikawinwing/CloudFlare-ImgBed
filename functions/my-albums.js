export async function onRequestGet() {
    return new Response(null, { status: 302, headers: { Location: '/account/?view=albums' } });
}
