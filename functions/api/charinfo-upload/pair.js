import { registerUploadPair, uploadBody, uploadFailure, uploadJson } from '../../utils/charinfoUploadAuth.js';

export async function onRequestPost(context) {
    try { return uploadJson(await registerUploadPair(context, await uploadBody(context.request))); }
    catch (error) { return uploadFailure(error); }
}
