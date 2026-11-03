import { launchUploadAuthorization, uploadFailure } from '../../utils/charinfoUploadAuth.js';

export async function onRequestPost(context) {
    try { return await launchUploadAuthorization(context); }
    catch (error) { return uploadFailure(error); }
}
