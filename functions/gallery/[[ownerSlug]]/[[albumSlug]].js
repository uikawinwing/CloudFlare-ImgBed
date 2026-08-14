export async function onRequestGet({ env, params }) {
    const owner = escapeAttribute(params.ownerSlug || '');
    const album = escapeAttribute(params.albumSlug || '');
    const record = env.img_d1?.prepare ? await env.img_d1.prepare("SELECT a.name, a.description, u.username FROM albums a JOIN users u ON u.discord_id = a.owner_id WHERE u.public_handle = ? AND a.slug = ? AND a.visibility = 'public'").bind(params.ownerSlug, params.albumSlug).first() : null;
    const name = escapeAttribute(record?.name || params.albumSlug || '公开图库');
    const creator = escapeAttribute(record?.username || params.ownerSlug || '');
    const description = escapeAttribute(record?.description || '');
    return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0d1119"><meta name="description" content="${description || name}"><link rel="icon" href="/static/media/logo.png"><link rel="stylesheet" href="/gallery-app/gallery.css"><title>${name} · CloudFlare ImgBed</title></head><body data-owner="${owner}" data-album="${album}" data-name="${name}" data-creator="${creator}" data-description="${description}"><main id="gallery-app"></main><noscript>需要启用 JavaScript 才能浏览图库。</noscript><script type="module" src="/gallery-app/gallery.js"></script></body></html>`, { headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'public, max-age=60' } });
}

function escapeAttribute(value) {
    return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}
