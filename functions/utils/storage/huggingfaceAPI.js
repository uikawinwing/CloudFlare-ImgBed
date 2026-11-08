/**
 * Hugging Face dataset access used only for existing files.
 * New uploads are disabled; this class retains deletion and metadata helpers.
 */
export class HuggingFaceAPI {
    constructor(token, repo, isPrivate = false) {
        this.token = token;
        this.repo = repo;
        this.isPrivate = isPrivate;
        this.baseURL = 'https://huggingface.co';
    }

    async deleteFile(filePath, commitMessage = 'Delete file') {
        const url = `${this.baseURL}/api/datasets/${this.repo}/commit/main`;
        const body = [
            JSON.stringify({ key: 'header', value: { summary: commitMessage } }),
            JSON.stringify({ key: 'deletedFile', value: { path: filePath } }),
        ].join('\n');

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.token}`,
                'Content-Type': 'application/x-ndjson',
            },
            body,
        });

        return response.ok;
    }

    static getMetadataFileSize(metadata = {}) {
        const fileSizeBytes = Number(metadata?.FileSizeBytes);
        if (Number.isFinite(fileSizeBytes) && fileSizeBytes > 0) {
            return Math.floor(fileSizeBytes);
        }

        const fileSizeMB = Number(metadata?.FileSize);
        if (Number.isFinite(fileSizeMB) && fileSizeMB > 0) {
            return Math.floor(fileSizeMB * 1024 * 1024);
        }

        return null;
    }
}
