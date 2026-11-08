const DISABLED_MESSAGE = 'Hugging Face direct uploads are disabled';

export async function onRequestPost() {
    return new Response(JSON.stringify({ error: DISABLED_MESSAGE }), {
        status: 410,
        headers: { 'Content-Type': 'application/json' },
    });
}
