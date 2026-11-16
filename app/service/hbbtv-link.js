'use strict';
// Apps that are only a doorway to a broadcaster's HbbTV service (#200). SVT Play (5exPmCT0nz.svtplay) is one: its
// package declares the metadata key below, and Samsung's own Home never starts the widget itself. Started by its id,
// the widget only shows its loading wheel and goes away. Samsung's web app service (litewebappservice,
// ICAul::AulLaunchTVViewer) sends the link to the HbbTV app instead: operation default, hbbtv=<link>, plus
// tizenid=<app id>, deeplink=true and caller_process=org.tizen.litewebappservice.
// Vetro sends the operation and the link only. tizenid starts a deep-link session, and when a deep-link app ends the
// HbbTV library opens Samsung's Home (CDAEApplicationManager::m_HandleDeeplinkExit launches com.samsung.tv.csfs with
// entry_point=exit_key), which is what Vetro's launcher stands in for. Checked on an LS03B (Tizen 6.5,
// T-PTMDEUC-1720.7) on 2026-11-16: the link alone opened SVT Play from a TV channel, over Netflix and from an HDMI
// input, and leaving it with Exit went back to each of them; Samsung's full request brought up Samsung Home on exit.
// A bare start of org.tizen.hbbtv, without the link, shows nothing. The dock sends the same request natively
// (dock/src/Program.cs, SendHbbtvLaunch).
var METADATA_KEY = 'http://samsung.com/tv/metadata/hbbtv.link';
var HBBTV_APP = 'org.tizen.hbbtv';
var OPERATION_DEFAULT = 'http://tizen.org/appcontrol/operation/default';
var PKGMGR_DB = '/opt/dbspace/.pkgmgr_parser.db';
var APP_ID_RE = /^[A-Za-z0-9_.-]{1,120}$/;
// http(s) only, no spaces, quotes, backslashes or control characters. The dock applies the same rule (Catalog.cs).
var LINK_RE = /^https?:\/\/[A-Za-z0-9._~:\/?#\[\]@!$&()*+,;=%-]{1,500}$/;

function validLink(link) { return typeof link === 'string' && LINK_RE.test(link); }

// The request as app_launcher key/value arguments. __APP_SVC_OP_TYPE__ is the bundle key app_control_set_operation writes.
function launchArgs(link) {
    return ['__APP_SVC_OP_TYPE__', OPERATION_DEFAULT, 'hbbtv', link];
}

// One shell command for the root agent: an app with an HbbTV link is opened through the HbbTV app, any other
// app is started by its id as before. The link is read on the TV at launch time, so a rule or the Task manager
// needs no catalog of its own. It only ever reaches app_launcher as a quoted variable, never as shell text.
function launchCommand(appId) {
    if (!APP_ID_RE.test(String(appId || ''))) throw new Error('invalid appId');
    return 'L=$(sqlite3 -readonly ' + PKGMGR_DB + ' "SELECT md_value FROM package_app_app_metadata WHERE app_id=\'' + appId +
        '\' AND md_key=\'' + METADATA_KEY + '\' LIMIT 1;" 2>/dev/null | head -n 1); ' +
        'case "$L" in http://*|https://*) /usr/bin/app_launcher -s ' + HBBTV_APP + ' ' + launchArgs('"$L"').join(' ') + ';; ' +
        '*) /usr/bin/app_launcher -s ' + appId + ';; esac';
}

module.exports = {METADATA_KEY: METADATA_KEY, HBBTV_APP: HBBTV_APP, validLink: validLink, launchArgs: launchArgs, launchCommand: launchCommand};
