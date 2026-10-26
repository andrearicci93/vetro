'use strict';

// Tizen 5.5 runs the web service on Node 4.4 (V8 4.5). Three built-ins the
// service uses elsewhere are missing or narrower there. Every branch below is
// skipped on a runtime that already has the real thing, so modern Node is
// unaffected. `install` takes an optional {Promise, Buffer} for tests.

function acceptsString(BufferRef) {
    try { return BufferRef.from('a').toString() === 'a'; } catch (error) { return false; }
}

function install(env) {
    var target = env || {};
    var PromiseRef = target.Promise || Promise;
    var BufferRef = target.Buffer || Buffer;

    if (typeof PromiseRef.prototype.finally !== 'function') {
        PromiseRef.prototype.finally = function (callback) {
            var P = this.constructor || PromiseRef;
            return this.then(function (value) {
                return P.resolve(callback()).then(function () { return value; });
            }, function (reason) {
                return P.resolve(callback()).then(function () { throw reason; });
            });
        };
    }

    if (typeof BufferRef.alloc !== 'function') {
        // Only reached on a runtime without Buffer.alloc. `new Buffer` is that
        // runtime's allocator and is zero-filled there; allocUnsafe is used when
        // present so the fallback never recurses into a Buffer.alloc of its own.
        BufferRef.alloc = function (size, fill, encoding) {
            var unsafe = typeof BufferRef.allocUnsafe === 'function';
            var buffer = unsafe ? BufferRef.allocUnsafe(size) : new BufferRef(size);
            if (unsafe) buffer.fill(0);
            if (fill !== undefined) buffer.fill(fill, 0, size, encoding);
            return buffer;
        };
    }

    if (!acceptsString(BufferRef)) {
        // Here Buffer.from is the inherited TypedArray.from, which rejects
        // strings. The inherited property is not writable, so define an own one.
        var typedArrayFrom = BufferRef.from;
        Object.defineProperty(BufferRef, 'from', {
            configurable: true,
            writable: true,
            value: function (value, encoding) {
                if (typeof value !== 'string') return typedArrayFrom.apply(BufferRef, arguments);
                // Not `new Buffer(value)`: on a modern runtime that constructor
                // delegates back to Buffer.from and would recurse.
                var size = BufferRef.byteLength(value, encoding);
                var buffer = typeof BufferRef.allocUnsafe === 'function'
                    ? BufferRef.allocUnsafe(size)
                    : new BufferRef(size);
                buffer.write(value, 0, size, encoding);
                return buffer;
            }
        });
    }

    return { Promise: PromiseRef, Buffer: BufferRef };
}

module.exports = { install: install, acceptsString: acceptsString };
