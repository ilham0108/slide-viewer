const shareModel = require('../models/shareModel');
const slideModel = require('../models/slideModel');

// Public tile requests arrive by the hundreds; the share and its allowed slides are cached
// briefly. Revoking a link clears the cache so it stops working at once.
const CACHE_TTL_MS = 30 * 1000;
const cache = new Map();

function clearShareCache(token) {
    if (token) cache.delete(token);
    else cache.clear();
}

function shareState(share) {
    if (!share) return 'missing';
    if (share.revoked_at) return 'revoked';
    if (share.expires_at && new Date(share.expires_at).getTime() <= Date.now()) return 'expired';
    return 'active';
}

/** The ready slides a share gives access to (read live, so a shared case includes new slides). */
async function loadShareSlides(share) {
    switch (share.resource_type) {
        case 'slide': {
            const slide = await slideModel.getSlideDetail(share.resource_id);
            return slide && slide.status === 'ready' ? [slide] : [];
        }
        case 'case':
            return slideModel.getAvailableSlides({ caseId: share.resource_id });
        case 'category':
            return slideModel.getAvailableSlides({ categoryId: share.resource_id });
        case 'compare':
        case 'slides': {
            const ids = new Set(share.view_state?.slides || []);
            const slides = await Promise.all([...ids].map(id => slideModel.getSlideDetail(id)));
            return slides.filter(slide => slide && slide.status === 'ready');
        }
        case 'cases': {
            const perCase = await Promise.all((share.view_state?.cases || []).map(caseId => slideModel.getAvailableSlides({ caseId })));
            return perCase.flat();
        }
        default:
            return [];
    }
}

/** Share row, its state and its slides (by id and by stored name), cached per token. */
async function resolveShare(token) {
    const cached = cache.get(token);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const share = /^[A-Za-z0-9_-]{32}$/.test(token) ? await shareModel.findByToken(token) : null;
    const state = shareState(share);
    let slides = [];
    if (state === 'active') slides = await loadShareSlides(share);
    const value = {
        share,
        state,
        slides,
        slideIds: new Set(slides.map(slide => slide.id)),
        storedNames: new Set(slides.map(slide => slide.stored_name.replace(/\.dzi$/i, ''))),
    };
    cache.set(token, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
}

function isUnlocked(req, share) {
    return !share.has_password || Boolean(req.session?.unlockedShares?.includes(share.token));
}

module.exports = {
    resolveShare,
    isUnlocked,
    clearShareCache,
};
