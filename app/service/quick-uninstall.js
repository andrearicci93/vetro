'use strict';
// Quick settings → Uninstall: a short, named list of apps that come with the TV and that some people want gone for good.
//
// Uninstall is not Disable. A disabled app (Quick settings → Disable) stays on the TV, switched off, and one switch brings it
// back. An uninstalled app is deleted: its space is freed, and Vetro cannot bring it back (most can be installed again from
// Samsung's Apps). So this list is deliberately short and every entry is checked against the TV in front of it:
//
//   - the list is by name. The TV's registry marks as "removable" its own store, the account apps and the quick panel too
//     (57 of 57 TVs in the reports), so that flag alone can never choose what to offer;
//   - an entry is offered only when the TV has it, and only the packages the TV itself allows to remove: the same check as
//     Apps and processes (component-actions.js: not protected, not a system package, marked removable). A TV where Netflix is
//     part of the firmware simply does not show Netflix here;
//   - nothing is removed here either: the route runs the uninstall of Apps and processes for each package, one at a time,
//     with its verification, its Home clean-up, Keep removed and the launcher's rebuild (main.js componentAction).
//
// Not on the list, on purpose: YouTube (its package is a few kilobytes, the player is a system package that stays, and the
// launcher keeps a tile for it: Disable is the right tool), the TV Plus services (systemd restarts them: Disable stops them),
// and Samsung's platform pieces (Gaming Hub, SmartThings, the store, the account), whose removal nobody has tried.
//
// Plain ES5, like every module the TV loads.
var actions = require('./component-actions.js');

// `apps`: the app ids whose packages are the entry; `pattern`: the same by a rule, where the id changes with the model year.
var LIST = [
    // The manual is a downloaded web package, 21 to 124 MB; its id differs per model year, its app is always "<package>.emanual".
    {id: 'emanual', label: 'e-Manual', pattern: /^[A-Za-z0-9]{10}\.emanual$/},
    {id: 'tvplus', label: 'Samsung TV Plus', apps: ['com.samsung.tv.tvplus', 'com.samsung.tv.tvPlusDeeplinker', 'w2VwCK465D.OTApp'],
        note: 'Its background services stay. Disable → Samsung TV Plus stops them.'},
    {id: 'netflix', label: 'Netflix', apps: ['org.tizen.netflix-app']},
    {id: 'primevideo', label: 'Prime Video', apps: ['org.tizen.primevideo']},
    {id: 'appletv', label: 'Apple TV', apps: ['com.samsung.tv.aria-video']},
    {id: 'disney', label: 'Disney+', apps: ['MCmYXNxgcu.DisneyPlus']},
    {id: 'spotify', label: 'Spotify', apps: ['rJeHak5zRg.Spotify']},
    {id: 'xbox', label: 'Xbox', apps: ['GHI3a0zMSx.XboxGamePass']},
    {id: 'geforce', label: 'GeForce NOW', apps: ['w0wZu3xkQq.GeForceNOW']},
    {id: 'luna', label: 'Amazon Luna', apps: ['CmeyUlnhYY.LunaWebApp']},
    {id: 'browser', label: 'Internet browser', apps: ['org.tizen.browser']},
    {id: 'gallery', label: 'Gallery', apps: ['com.samsung.tv.gallery']},
    {id: 'health', label: 'Samsung Health', apps: ['com.samsung.tv.samsung-health']}
];

function find(id) { return LIST.filter(function (e) { return e.id === id; })[0] || null; }

function matches(entry, row) {
    if (!row || typeof row.appId !== 'string') return false;
    return entry.pattern ? entry.pattern.test(row.appId) : entry.apps.indexOf(row.appId) >= 0;
}

// What this TV can uninstall from the list: [{id, label, note, appId (for the icon), size, disabled, packages: [{packageId, appId, size}]}].
// `rows` is the registry inventory (app-registry.js). An entry with no package that passes the check is left out.
function candidates(rows) {
    rows = Array.isArray(rows) ? rows : [];
    var out = [];
    LIST.forEach(function (entry) {
        var byPackage = Object.create(null), order = [];
        rows.forEach(function (row) {
            if (!matches(entry, row) || typeof row.packageId !== 'string') return;
            if (!byPackage[row.packageId]) { byPackage[row.packageId] = []; order.push(row.packageId); }
            byPackage[row.packageId].push(row);
        });
        var packages = [];
        order.forEach(function (packageId) {
            var mine = byPackage[packageId];
            // Every app of the package that the entry names must pass: one refusal keeps the whole package out.
            var allowed = mine.every(function (row) { return actions.availability(row, rows, []).uninstall.allowed; });
            if (!allowed) return;
            var shown = mine.filter(function (row) { return row.show === true; })[0] || mine[0];
            packages.push({packageId: packageId, appId: shown.appId, size: typeof shown.size === 'number' && shown.size > 0 ? shown.size : null,
                disabled: mine.every(function (row) { return row.disabled === true; })});
        });
        if (!packages.length) return;
        var size = packages.reduce(function (sum, p) { return p.size === null ? sum : sum + p.size; }, 0);
        var item = {id: entry.id, label: entry.label, appId: packages[0].appId, size: size || null,
            disabled: packages.every(function (p) { return p.disabled; }), packages: packages};
        if (entry.note) item.note = entry.note;
        out.push(item);
    });
    return out;
}

function problem(message, status) {
    var e = new Error(message);
    e.statusCode = status;
    return e;
}

// Uninstalls one entry. deps: inventory(fresh) -> Promise of {apps, registryError}, componentAction(p) -> Promise of the
// answer Apps and processes gives for one package ({ok, verified, error, apps}). Packages go one at a time; the first that is
// not confirmed gone stops the rest. Resolves {ok, id, removed: [packageId], error, items} (items: the list as it is afterwards).
function uninstall(id, deps) {
    var entry = find(id);
    if (!entry) return Promise.reject(problem('Unknown app', 400));
    return deps.inventory(true).then(function (d) {
        if (!d || d.registryError) throw problem('The TV’s app list could not be read; nothing was removed', 503);
        var item = candidates(d.apps).filter(function (i) { return i.id === id; })[0];
        if (!item) throw problem(entry.label + ' is not on this TV, or the TV does not allow removing it', 409);
        var removed = [], last = d.apps, failure = null;
        return item.packages.reduce(function (chain, pkg) {
            return chain.then(function () {
                if (failure) return null;
                return deps.componentAction({appId: pkg.appId, action: 'uninstall'}).then(function (r) {
                    if (r && Array.isArray(r.apps)) last = r.apps;
                    if (r && r.ok) removed.push(pkg.packageId);
                    else failure = (r && r.error) || 'The TV did not confirm that it was removed';
                }, function (e) { failure = (e && e.message) || String(e); });
            });
        }, Promise.resolve()).then(function () {
            return {ok: !failure, id: id, label: entry.label, removed: removed, error: failure, items: candidates(last)};
        });
    });
}

module.exports = {LIST: LIST, find: find, candidates: candidates, uninstall: uninstall};
