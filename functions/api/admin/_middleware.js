import { rejectCrossSiteMutation } from '../../utils/auth/mutationSecurity.js';

export async function onRequest(context) {
    return rejectCrossSiteMutation(context.request) || context.next();
}
