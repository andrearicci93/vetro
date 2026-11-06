'use strict';
// Close an expired channel before optionally preparing a fresh one. Renewal
// only offers a new bootstrap; acquiring root remains the caller's concern.
// Keep the returned handle and clearTimeout it from the adapter's stop().
function schedule(stop, start, options) {
    options = options || {};
    return setTimeout(function () {
        stop();
        if (options.autoRenew === true) start();
    }, options.lifetimeMs || 900000);
}

module.exports = {schedule: schedule};
