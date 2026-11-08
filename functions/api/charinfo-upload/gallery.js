import { authorizeUploadRequest, uploadBody, uploadError, uploadFailure, uploadJson } from '../../utils/charinfoUploadAuth.js';
import { prepareUploadOperation, commitUploadOperation, readUploadGallery, cancelUploadOperation } from '../../utils/charinfoUploadOperations.js';

export async function onRequestPost(context) {
    try {
        const body = await uploadBody(context.request);
        const common = ['action', 'connectionId', 'sessionId', 'requestId'];
        const fields = { prepare: [...common, 'albumId', 'characterName', 'files', 'order'],
            read: [...common, 'albumId', 'characterName'], commit: common, cancel: common }[body.action];
        if (!fields || Object.keys(body).some(key => !fields.includes(key))) throw uploadError('BAD_REQUEST');
        if (typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.requestId)) throw uploadError('BAD_REQUEST');
        const authorize = () => authorizeUploadRequest(context, body.connectionId, body.sessionId);
        const identity = await authorize();
        const manifest = { requestId: body.requestId, albumId: body.albumId, characterName: body.characterName, files: body.files, order: body.order };
        const options = { env: context.env, identity, body: manifest, requestId: body.requestId,
            albumId: body.albumId, characterName: body.characterName, requestUrl: context.request.url, authorize };
        let result;
        if (body.action === 'prepare') result = await prepareUploadOperation(options);
        else if (body.action === 'commit') result = await commitUploadOperation(options);
        else if (body.action === 'read') result = await readUploadGallery(options);
        else if (body.action === 'cancel') result = await cancelUploadOperation(options);
        else throw uploadError('BAD_REQUEST');
        return uploadJson(result);
    } catch (error) { return uploadFailure(error); }
}
