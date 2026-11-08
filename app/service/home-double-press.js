'use strict';
var APP_ID = /^[A-Za-z0-9_.-]{1,120}$/;
function normalize(value) {
    if (value == null) return {enabled: false, mode: 'shortcut', appId: null};
    if (!value || typeof value.enabled !== 'boolean' || ['shortcut', 'app'].indexOf(value.mode) < 0 ||
        (value.mode === 'app' && (typeof value.appId !== 'string' || !APP_ID.test(value.appId)))) throw Error('Choose a double-press destination');
    return {enabled: value.enabled, mode: value.mode, appId: value.mode === 'app' ? value.appId : null};
}
module.exports = {normalize: normalize};
