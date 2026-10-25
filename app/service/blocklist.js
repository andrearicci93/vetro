'use strict';
// Candidate hostnames for the local filter and for external DNS blockers.
// "firmware" hosts are strings found in the shipped Q80A image (T-NKM2DEUC);
// "unverified" is a guess that has not been seen in the firmware or in traffic;
// "by" names the components that reference them. What blocking a host does has
// not been tested on a TV. "reported" hosts come from public reports and do not
// appear in the firmware: the ACR service receives its servers from a control
// server at run time. The hosts file matches exact names, so every entry is a
// full hostname and no apex stands in for its subdomains.
var GROUPS = [
    {id: 'ads', label: 'Advertising', evidence: 'firmware',
        note: 'Ad configuration, ad logs and interactive ads used by the ad agent, the ad framework and Samsung TV Plus.',
        hosts: [
            {host: 'rtb-config.samsungads.com', by: 'pisa-service, ad-web-framework, tvplus'},
            {host: 'tvp-ads-log.samsungads.com', by: 'pisa-service, ad-web-framework, tvplus'},
            {host: 'tvp-interactive-ad.samsungads.com', by: 'ad-web-framework, tvplus'}
        ]},
    {id: 'analytics', label: 'Analytics and KPI', evidence: 'firmware',
        note: 'Usage analytics and the KPI collector.',
        hosts: [
            {host: 'dc.di.atlas.samsung.com', by: 'samsung-analytics'},
            {host: 'regi.di.atlas.samsung.com', by: 'samsung-analytics'},
            {host: 'regi.bigdata.samsung.com', by: 'samsung-analytics'},
            {host: 'lcprd1.samsungcloudsolution.net', by: 'data-service-collector'}
        ]},
    {id: 'logs', label: 'Diagnostic logs and monitoring', evidence: 'firmware',
        note: 'Referenced by the emergency log transmitter and the health and robustness monitors. The purpose is inferred from component names, so the effect on support features is unknown.',
        hosts: [
            {host: 'fc.samsungcloud.tv', by: 'emergency log transmitter, HSMClient, RobustnessMonitor, targetLogClient'},
            {host: 'www.samsungrm.net', by: 'emergency log transmitter, HSMClient, RobustnessMonitor, targetLogClient'},
            {host: 'devicelog.samsungcloudsolution.net', by: 'smarthub-connection-test'}
        ]},
    {id: 'qbe', label: 'Samsung QBE services', evidence: 'firmware',
        note: 'Three hosts found in the firmware image. Which feature uses each one is not known, and no traffic to them has been seen yet. Check with Observe requests before relying on them.',
        hosts: [{host: 'osb.samsungqbe.com'}, {host: 'rm.samsungqbe.com'}, {host: 'scs.samsungqbe.com'}]},
    {id: 'reported', label: 'Viewing data (ACR) and ads · reported', evidence: 'reported',
        note: 'Names from public reports; none appears in the firmware. Use Observe requests to see which ones your TV really asks for.',
        hosts: [
            {host: 'samsungads.com'}, {host: 'config.samsungads.com'}, {host: 'ads.samsung.com'},
            {host: 'samsungacr.com'}, {host: 'log-config.samsungacr.com'}, {host: 'log-ingestion.samsungacr.com'},
            {host: 'acr0.samsungcloudsolution.com'}
        ]},
    {id: 'probable', label: 'Probable ACR starting point · unverified', evidence: 'unverified',
        note: 'Likely where the viewing-data service learns its servers. It is not in the firmware and nobody has confirmed it, so treat it as a guess and watch what the TV asks for.',
        hosts: [{host: 'gpm.samsungqbe.com'}]}
];
// Names the TV needs to work. The local filter refuses them and exports never include them.
var ESSENTIAL = [
    {host: 'cdn.samsungcloudsolution.com', reason: 'the TV checks its internet connection here'},
    {host: 'cdn.samsungqbe.cn', reason: 'the TV checks its internet connection here'},
    {host: 'time.samsungcloudsolution.com', reason: 'the TV sets its clock here'},
    {host: 'time.samsungcloudsolution.net', reason: 'the TV sets its clock here'},
    {host: 'time.samsungqbe.cn', reason: 'the TV sets its clock here'},
    {host: 'svdca.samsungqbe.com', reason: 'Samsung\u2019s Certificate Manager fetches the developer certificate here'}
];

function hosts(group) { return group.hosts.map(function (h) { return h.host; }); }
function all() {
    return GROUPS.reduce(function (list, g) { return list.concat(hosts(g)); }, []).filter(function (h, i, a) { return a.indexOf(h) === i; });
}
function essential(domain) {
    var d = String(domain || '').toLowerCase().trim();
    for (var i = 0; i < ESSENTIAL.length; i++) if (ESSENTIAL[i].host === d) return ESSENTIAL[i];
    return null;
}
// What the dashboard shows: no component names.
function publicGroups() {
    return GROUPS.map(function (g) { return {id: g.id, label: g.label, evidence: g.evidence, note: g.note, hosts: hosts(g)}; });
}
module.exports = {GROUPS: GROUPS, ESSENTIAL: ESSENTIAL, all: all, essential: essential, publicGroups: publicGroups};
