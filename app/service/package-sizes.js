'use strict';

// Package sizes, measured by the service through tizen.package (the TV screen runs about once, at install). totalSize
// is a blocking call (29 to 341 ms each on a Samsung S90C), so one is read per timer tick.

// tick(fn) runs fn on a later turn of the event loop; tests pass their own.
function Sizes(tick) {
    this.tick = tick || function (fn) { setTimeout(fn, 0); };
    this.sizes = {};
    this.running = false;
    this.again = false;
}

// Bytes, or null when unknown. Tizen gives -1 when it can't measure a package.
Sizes.prototype.sizeOf = function (packageId) {
    var size = this.sizes[packageId];
    return typeof size === 'number' && size >= 0 ? size : null;
};

// packageApi: tizen.package. A call during a pass runs one more pass after it.
Sizes.prototype.measure = function (packageApi) {
    var self = this;
    if (this.running) {
        this.again = true;
        return;
    }
    this.running = true;
    function finish() {
        self.running = false;
        if (self.again) {
            self.again = false;
            self.measure(packageApi);
        }
    }
    try {
        packageApi.getPackagesInfo(function (packages) {
            var sizes = {};
            var i = 0;
            (function readOne() {
                if (i === packages.length) {
                    self.sizes = sizes;
                    return finish();
                }
                var pkg = packages[i++];
                try { sizes[pkg.id] = pkg.totalSize; } catch (e) {}
                self.tick(readOne);
            })();
        }, finish);
    } catch (e) {
        finish();
    }
};

module.exports = {Sizes: Sizes};
