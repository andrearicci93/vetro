'use strict';

// Tizen 5.5 and older run the web service on Node 4.4 (V8 4.5). The built-ins
// used elsewhere that are missing or narrower there are added below. Every
// branch is skipped on a runtime that already has the real thing, so modern
// Node is unaffected. `install` takes an optional {Promise, Buffer} for tests.

var crypto = require('crypto');
var fs = require('fs');

function acceptsString(BufferRef) {
    try { return BufferRef.from('a').toString() === 'a'; } catch (error) { return false; }
}

function install(env) {
    var target = env || {};
    var PromiseRef = target.Promise || Promise;
    var BufferRef = target.Buffer || Buffer;
    var NumberRef = target.Number || Number;
    var FsRef = target.fs || fs;

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
        // Only reached on a runtime without Buffer.alloc. On Node 4.4 neither
        // Buffer.alloc nor Buffer.allocUnsafe exists, and `new Buffer(size)`
        // returns uninitialized memory, so always zero-fill when `fill` is omitted.
        BufferRef.alloc = function (size, fill, encoding) {
            var buffer = typeof BufferRef.allocUnsafe === 'function' ? BufferRef.allocUnsafe(size) : new BufferRef(size);
            if (fill !== undefined) buffer.fill(fill, 0, size, encoding);
            else buffer.fill(0);
            return buffer;
        };
    }

    if (!acceptsString(BufferRef)) {
        // Here Buffer.from is the inherited TypedArray.from. On Node 4.4 (V8 4.5) it
        // refuses to build a Buffer at all ("this is not a typed array": Buffer's
        // prototype has no BYTES_PER_ELEMENT of its own), for strings and for arrays
        // alike, so both are built here. The MQTT client makes every packet with
        // Buffer.from([...]): left to the inherited function it ended the service as
        // soon as a broker was configured (#77). The inherited property is not
        // writable, so define an own one.
        var typedArrayFrom = BufferRef.from;
        Object.defineProperty(BufferRef, 'from', {
            configurable: true,
            writable: true,
            value: function (value, encoding) {
                if (typeof value !== 'string') {
                    // Arrays, Buffers and typed arrays: a copy, byte by byte.
                    if (value && typeof value.length === 'number' && !(value instanceof ArrayBuffer)) {
                        var count = value.length >>> 0;
                        var copy = typeof BufferRef.allocUnsafe === 'function' ? BufferRef.allocUnsafe(count) : new BufferRef(count);
                        for (var i = 0; i < count; i++) copy[i] = value[i] & 255;
                        return copy;
                    }
                    return typedArrayFrom.apply(BufferRef, arguments);
                }
                // Not `new Buffer(value)`: on a modern runtime that constructor
                // delegates back to Buffer.from and would recurse.
                if (encoding === 'latin1') encoding = 'binary';
                var size = BufferRef.byteLength(value, encoding);
                var buffer = typeof BufferRef.allocUnsafe === 'function'
                    ? BufferRef.allocUnsafe(size)
                    : new BufferRef(size);
                var written = buffer.write(value, 0, size, encoding);
                return written < size ? buffer.slice(0, written) : buffer;
            }
        });
    }

    if (typeof BufferRef.isEncoding !== 'function' || !BufferRef.isEncoding('latin1')) {
        var origToString = BufferRef.prototype.toString;
        BufferRef.prototype.toString = function (encoding, start, end) {
            if (encoding === 'latin1') encoding = 'binary';
            return origToString.call(this, encoding, start, end);
        };
        var origByteLength = BufferRef.byteLength;
        BufferRef.byteLength = function (string, encoding) {
            if (encoding === 'latin1') encoding = 'binary';
            return origByteLength.call(BufferRef, string, encoding);
        };
        if (typeof BufferRef.isEncoding === 'function') {
            var origIsEncoding = BufferRef.isEncoding;
            BufferRef.isEncoding = function (encoding) {
                if (encoding === 'latin1') return true;
                return origIsEncoding.call(BufferRef, encoding);
            };
        }
    }

    if (!FsRef.constants) {
        var base = {};
        try { base = require('constants') || {}; } catch (e) {}
        FsRef.constants = Object.assign({}, base);
    }
    if (typeof FsRef.constants.O_WRONLY !== 'number') FsRef.constants.O_WRONLY = 1;
    if (typeof FsRef.constants.O_NONBLOCK !== 'number') FsRef.constants.O_NONBLOCK = 2048;
    if (typeof FsRef.constants.R_OK !== 'number') FsRef.constants.R_OK = typeof FsRef.R_OK === 'number' ? FsRef.R_OK : 4;

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

    if (typeof NumberRef.isSafeInteger !== 'function') {
        NumberRef.isSafeInteger = function (value) {
            return typeof value === 'number' && isFinite(value) && Math.floor(value) === value && Math.abs(value) <= 9007199254740991;
        };
    }

    // Node 4.4 has no stream.Transform.prototype.destroy (added in Node 8.0);
    // zlib streams (such as package-info.js inflate) expose close() there.
    var TransformRef = target.Transform || require('stream').Transform;
    if (TransformRef && TransformRef.prototype && typeof TransformRef.prototype.destroy !== 'function') {
        TransformRef.prototype.destroy = function () {
            if (typeof this.close === 'function') this.close();
        };
    }
    var ZlibRef = target.zlib || require('zlib');
    if (ZlibRef && ZlibRef.InflateRaw && ZlibRef.InflateRaw.prototype && typeof ZlibRef.InflateRaw.prototype.destroy !== 'function') {
        ZlibRef.InflateRaw.prototype.destroy = function () {
            if (typeof this.close === 'function') this.close();
        };
    }

    return { Promise: PromiseRef, Buffer: BufferRef, fs: FsRef, zlib: ZlibRef };
}

module.exports = { install: install, acceptsString: acceptsString };
