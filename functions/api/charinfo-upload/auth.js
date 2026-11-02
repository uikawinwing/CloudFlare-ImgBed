import { uploadAuthAction, uploadBody, uploadFailure, uploadJson } from '../../utils/charinfoUploadAuth.js';

export async function onRequestPost(context) {
    try { return uploadJson(await uploadAuthAction(context, await uploadBody(context.request))); }
    catch (error) { return uploadFailure(error); }
}
