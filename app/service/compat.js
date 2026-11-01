'use strict';

// Tizen 5.5 and older run the web service on Node 4.4 (V8 4.5). The built-ins
// used elsewhere that are missing or narrower there are added below. Every
// branch is skipped on a runtime that already has the real thing, so modern
// Node is unaffected. `install` takes an optional {Promise, Buffer} for tests.

var crypto = require('crypto');

function acceptsString(BufferRef) {
    try { return BufferRef.from('a').toString() === 'a'; } catch (error) { return false; }
}

function install(env) {
    var target = env || {};
    var PromiseRef = target.Promise || Promise;
    var BufferRef = target.Buffer || Buffer;
    var NumberRef = target.Number || Number;

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

    // Node 4.4 has neither crypto.timingSafeEqual nor Number.isInteger. The
    // root agent verifies HMAC frames with the former; both are numeric or
    // length-only checks, so a constant-time byte compare and a Math.floor
    // comparison are exact stand-ins.
    if (typeof crypto.timingSafeEqual !== 'function') {
        crypto.timingSafeEqual = function (a, b) {
            if (!BufferRef.isBuffer(a) || !BufferRef.isBuffer(b) || a.length !== b.length) {
                throw new TypeError('Input buffers must have the same byte length');
            }
            var difference = 0;
            for (var i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
            return difference === 0;
        };
    }

    if (typeof NumberRef.isInteger !== 'function') {
        NumberRef.isInteger = function (value) {
            return typeof value === 'number' && isFinite(value) && Math.floor(value) === value;
        };
    }

    return { Promise: PromiseRef, Buffer: BufferRef };
}

module.exports = { install: install, acceptsString: acceptsString };
