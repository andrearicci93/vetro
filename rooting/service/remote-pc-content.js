'use strict';
function quote(value) {
    if (typeof value !== 'string' || value.indexOf('\x00') !== -1) throw new Error('Invalid shell argument');
    return "'" + value.replace(/'/g, "'\\''") + "'";
}

// UEP checks loading a script by path, including nested helper launches.
// Keep the signed shell as the executable and supply the helper as content.
// The caller owns backgrounding, standard streams and worker-PID tracking.
function helperCommand(script, name, args) {
    if (typeof script !== 'string' || script.charAt(0) !== '/') throw new Error('Expected an absolute helper path');
    if (!Array.isArray(args)) throw new Error('Expected helper arguments');
    return 'setsid /bin/sh -c "$(cat ' + quote(script) + ')" ' + quote(name) +
        args.map(function (arg) { return ' ' + quote(arg); }).join('');
}

module.exports = {helperCommand: helperCommand};
