import { translate, translateServerMessage } from './i18n';

export class ApiError extends Error {
    constructor(message, status, data = {}) {
        super(message);
        this.status = status;
        this.data = data;
    }
}

// AuthContext listens for this to send the user back to the login page when a session expires.
export const SESSION_EXPIRED_EVENT = 'session-expired';

export function handleUnauthorized(path, status) {
    // Public share pages answer 401 for a missing share password, not for a lost session.
    if (status === 401 && !path.startsWith('/auth/') && !path.startsWith('/public/')) {
        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
    let response;
    try {
        response = await fetch(`/api${path}`, {
            method,
            signal,
            headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
            cache: 'no-store',
        });
    } catch (error) {
        if (error.name === 'AbortError') throw error;
        throw new ApiError(translate('Tidak dapat terhubung ke server.'), 0);
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        handleUnauthorized(path, response.status);
        const message = data.message ? translateServerMessage(data.message) : translate('Request gagal ({status}).', { status: response.status });
        throw new ApiError(message, response.status, data);
    }
    return data;
}

export function abortError() {
    return Object.assign(new Error('Upload dibatalkan.'), { name: 'AbortError' });
}

/**
 * Sends a request body with upload progress, which fetch() cannot report, so this uses
 * XMLHttpRequest. Aborting `signal` rejects with an error named "AbortError"; a network
 * failure or timeout rejects with an ApiError whose status is 0.
 */
export function uploadRequest(method, path, body, { headers = {}, onProgress, signal, timeoutMs = 0 } = {}) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(abortError());
        const xhr = new XMLHttpRequest();
        signal?.addEventListener('abort', () => xhr.abort(), { once: true });
        xhr.addEventListener('abort', () => reject(abortError()));
        xhr.open(method, `/api${path}`);
        xhr.responseType = 'json';
        xhr.timeout = timeoutMs;
        for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
        xhr.upload.addEventListener('progress', event => {
            if (event.lengthComputable) onProgress?.(event.loaded, event.total);
        });
        xhr.addEventListener('load', () => {
            const data = xhr.response || {};
            if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
            handleUnauthorized(path, xhr.status);
            reject(new ApiError(data.message ? translateServerMessage(data.message) : translate('Upload gagal ({status}).', { status: xhr.status }), xhr.status, data));
        });
        xhr.addEventListener('error', () => reject(new ApiError(translate('Koneksi ke server terputus.'), 0)));
        xhr.addEventListener('timeout', () => reject(new ApiError(translate('Koneksi ke server terputus.'), 0)));
        xhr.send(body);
    });
}

// Fired after slides were uploaded or deleted, so open slide lists (gallery, case page,
// uploads table) reload.
export const SLIDES_CHANGED_EVENT = 'slides-changed';

export function notifySlidesChanged() {
    window.dispatchEvent(new Event(SLIDES_CHANGED_EVENT));
}

// The category sidebar shows case counts; pages that create, edit or delete cases or
// categories call notifyCasesChanged() so it refreshes.
export const CASES_CHANGED_EVENT = 'cases-changed';

export function notifyCasesChanged() {
    window.dispatchEvent(new Event(CASES_CHANGED_EVENT));
}
