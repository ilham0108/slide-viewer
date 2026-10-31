import { ApiError, abortError, api, uploadRequest } from '../api';
import { translate } from '../i18n';

// Waits before retrying after a dropped connection; after the last one the upload stops
// and the user can continue it from the upload tray.
const RETRY_DELAYS_MS = [1000, 3000, 5000, 10000, 20000, 30000];
const CHUNK_TIMEOUT_MS = 2 * 60 * 1000;
// Remembers the server session of a file, so choosing the same file again (after a
// reload or a closed tab) continues the upload instead of starting over.
const RESUME_PREFIX = 'upload-resume:';

const resumeKey = (target, file) => {
    const destination = target.caseId ? `case-${target.caseId}` : `category-${target.categoryId}`;
    return `${RESUME_PREFIX}${destination}:${file.name}:${file.size}:${file.lastModified}`;
};

function readResumeId(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeResumeId(key, id) {
    try {
        if (id) localStorage.setItem(key, id);
        else localStorage.removeItem(key);
    } catch {
        // Storage blocked: the upload still works, it just cannot be resumed after a reload.
    }
}

function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal.aborted) return reject(abortError());
        const timer = setTimeout(resolve, ms);
        signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(abortError());
        }, { once: true });
    });
}

async function openSession(target, file, key, signal) {
    const savedId = readResumeId(key);
    if (savedId) {
        try {
            const session = await api(`/uploads/${savedId}`, { signal });
            if (session.size === file.size) return session;
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            // Gone (finished, cancelled or expired): start a new one.
        }
    }
    const session = await api('/uploads', { method: 'POST', body: { fileName: file.name, size: file.size, ...target }, signal });
    writeResumeId(key, session.id);
    return session;
}

// Client errors other than these mean retrying the same chunk cannot help.
const isRetryable = error => error.status === 0 || error.status >= 500 || error.status === 408 || error.status === 429;

/**
 * Uploads a slide file in chunks and resolves with the server's answer for the finished
 * upload ({ status, id, dzi, message }). A dropped connection is retried and continues
 * where it stopped.
 *
 * target: { caseId } for a case, or { categoryId } for a category without a case.
 * onProgress(sentBytes, totalBytes)
 * onStatus({ sessionId })    the server session this file is sent to
 * onStatus({ resumedFrom })  the upload continued an earlier session from this byte
 * onStatus({ retrying })     connection lost; retry attempt number (0 once it works again)
 *
 * Aborting `signal` with the reason "cancel" also deletes the session on the server; any
 * other abort (logout, leaving the app) keeps it so the file can be resumed later.
 */
export async function uploadSlideResumable(target, file, { onProgress, onStatus, signal }) {
    const key = resumeKey(target, file);
    let session;
    try {
        session = await openSession(target, file, key, signal);
        onStatus?.({ sessionId: session.id });
        if (session.offset > 0) onStatus?.({ resumedFrom: session.offset });

        let { offset } = session;
        let attempt = 0;
        // Once the last chunk was sent, a missing session most likely means the server
        // finished the upload but its answer was lost with the connection.
        let lastChunkSent = false;
        const probablyFinished = () => {
            writeResumeId(key, null);
            return { complete: true, status: 'unknown', message: 'Upload kemungkinan sudah selesai, tetapi jawaban server terputus. Periksa daftar slide di case.' };
        };
        onProgress?.(offset, file.size);
        while (true) {
            const end = Math.min(offset + session.chunkSize, file.size);
            if (end === file.size) lastChunkSent = true;
            try {
                const result = await uploadRequest('PATCH', `/uploads/${session.id}`, file.slice(offset, end), {
                    headers: { 'Upload-Offset': String(offset), 'Content-Type': 'application/offset+octet-stream' },
                    onProgress: loaded => onProgress?.(offset + loaded, file.size),
                    signal,
                    timeoutMs: CHUNK_TIMEOUT_MS,
                });
                if (attempt) onStatus?.({ retrying: 0 });
                attempt = 0;
                offset = result.offset;
                onProgress?.(offset, file.size);
                if (result.complete) {
                    writeResumeId(key, null);
                    return result;
                }
            } catch (error) {
                if (error.name === 'AbortError') throw error;
                // The server has a different offset (e.g. part of a chunk arrived): continue from there.
                if (error.status === 409 && Number.isSafeInteger(error.data?.offset)) {
                    offset = error.data.offset;
                    // The server may still be finishing the interrupted chunk; give it a moment.
                    await sleep(500, signal);
                    continue;
                }
                if (!isRetryable(error)) {
                    if (error.status === 404 && lastChunkSent && error.data?.code !== 'case_deleted') return probablyFinished();
                    // The session is finished with (rejected file, deleted case) or gone.
                    if (error.status === 400 || error.status === 404) writeResumeId(key, null);
                    throw error;
                }
                if (attempt >= RETRY_DELAYS_MS.length) {
                    throw new ApiError(translate('Koneksi ke server terputus. Klik coba lagi untuk melanjutkan.'), 0);
                }
                onStatus?.({ retrying: attempt + 1 });
                await sleep(RETRY_DELAYS_MS[attempt], signal);
                attempt += 1;
                // Ask where the server got to; on failure the next chunk's 409 tells us instead.
                try {
                    offset = (await api(`/uploads/${session.id}`, { signal })).offset;
                } catch (statusError) {
                    if (statusError.name === 'AbortError') throw statusError;
                    if (statusError.status === 404) {
                        if (lastChunkSent) return probablyFinished();
                        writeResumeId(key, null);
                        throw statusError;
                    }
                }
            }
        }
    } catch (error) {
        if (error.name === 'AbortError' && signal.reason === 'cancel' && session) {
            writeResumeId(key, null);
            api(`/uploads/${session.id}`, { method: 'DELETE' }).catch(() => {});
        }
        throw error;
    }
}
