import { authorizeUploadRequest, uploadError, uploadFailure, uploadJson } from '../../utils/charinfoUploadAuth.js';
import { stageUploadOperationFile } from '../../utils/charinfoUploadOperations.js';

export async function onRequestPost(context) {
    try {
        const url = new URL(context.request.url);
        const keys = ['connection_id', 'request_id', 'upload_id'];
        if ([...url.searchParams.keys()].some(key => !keys.includes(key)) || keys.some(key => url.searchParams.getAll(key).length !== 1)) throw uploadError('BAD_REQUEST');
        const connectionId = url.searchParams.get('connection_id');
        const requestId = url.searchParams.get('request_id');
        const uploadId = url.searchParams.get('upload_id');
        if (![requestId, uploadId].every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id))) throw uploadError('BAD_REQUEST');
        const sessionId = context.request.headers.get('X-CharInfo-Session');
        const authorize = () => authorizeUploadRequest(context, connectionId, sessionId);
        const identity = await authorize();
        const length = Number(context.request.headers.get('Content-Length') || 0);
        const file = { type: context.request.headers.get('Content-Type') || '', size: length || undefined,
            stream: () => context.request.body };
        return uploadJson(await stageUploadOperationFile({ env: context.env, identity, requestId, uploadId, file, authorize }));
    } catch (error) { return uploadFailure(error); }
}
