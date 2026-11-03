"use strict";
const assert = require("assert").strict;
const fs = require("fs"), os = require("os"), path = require("path");
const load = require("./service-harness.cjs");
const {Dock} = require("../service/dock.js");
const remap = require("../service/remap.js");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vetro-launcher-remap-"));
const stateFile = path.join(directory, "state.json");
const marker = "VETRO_LAUNCHER_CONTROL_V1\t";
const frame = (state, reason, errno = 0) => marker + [state, reason, errno].join("\t") + "\n";
let response = {exit_code: 0, stdout: frame("sent", "ok")};
const commands = [];
const dock = new Dock({stateFile, dir: path.join(directory, "app's launcher")});
dock.installed = () => true;
fs.writeFileSync(stateFile, JSON.stringify({enabled: true}));
const service = load(path.resolve(__dirname, ".."), {dependencies: {
    "./dock.js": {Dock: function () { return dock; }},
    "./platform.js": {start() {}, status: () => ({agent: {connected: false}}),
        execute: (command, timeout) => {
            commands.push(command);
            if (command.includes("--control toggle")) {
                assert.equal(timeout, 5000);
                return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
            }
            assert.equal(command, "/usr/bin/input_keyevent XF86Home");
            return Promise.resolve({exit_code: 0, stdout: ""});
        }}
}});
dock.execute = service.context.agentExecute;
service.context.remapStore.rules = remap.validateRules([{id: "home",
    trigger: {type: "physical", value: "063"}, actions: [{type: "launcher"}]}]);
const event = (action, decision = "blocked") => ({action, decision, code: 63});
async function press() { service.context.physical.onEvent(event("down")); await service.context.actionQueue; }
(async () => {
    await press();
    const control = commands[0];
    assert.match(control, /^\/usr\/bin\/dotnet /);
    assert.match(control, / --control toggle --dir '\/home\/owner'$/);
    assert.ok(control.includes("app'\\''s launcher"), "package path is shell quoted");
    service.context.physical.onEvent(event("repeat"));
    service.context.physical.onEvent(event("up"));
    service.context.physical.onEvent(event("down", "native"));
    await service.context.actionQueue;
    assert.deepEqual(commands, [control], "one root control command, no Home injection or app close");
    await press();
    assert.deepEqual(commands, [control, control]);
    assert.equal(dock.lastControl.state, "sent");
    assert.equal(service.context.inputError, null);

    async function fallback(expected, reason) {
        commands.length = 0;
        await press();
        assert.deepEqual(commands, expected.concat("/usr/bin/input_keyevent XF86Home"), reason);
        assert.equal(dock.lastControl.state, "not-sent");
        assert.match(service.context.inputError, /sent Samsung Home instead/);
    }
    dock.busy = true; await fallback([], "restart fallback"); dock.busy = false;
    fs.writeFileSync(stateFile, JSON.stringify({enabled: false})); await fallback([], "disabled fallback");
    fs.writeFileSync(stateFile, JSON.stringify({enabled: true}));
    dock.installed = () => false; await fallback([], "uninstalled fallback"); dock.installed = () => true;
    response = {exit_code: 3, stdout: "runtime output\n" + frame("not-sent", "open", 13)};
    await fallback([control], "confirmed failed write is reported and falls back exactly once");
    assert.match(service.context.inputError, /errno 13/);
    let releases = 0;
    service.context.physical.stop = () => { releases++; };
    for (const unknown of [
        {exit_code: 0, timed_out: true, stdout: frame("sent", "ok")},
        {exit_code: 0, stdout: "no result"},
        {exit_code: 0, stdout: frame("sent", "ok") + frame("sent", "ok")},
        {exit_code: 1, stdout: frame("sent", "ok")},
        {exit_code: 4, stdout: frame("unknown", "partial-write")},
        new Error("root agent disconnected")
    ]) {
        response = unknown; commands.length = 0; await press();
        assert.deepEqual(commands, [control], "uncertain delivery must never replay Home or a toggle");
        assert.equal(dock.lastControl.state, "unknown");
        assert.match(service.context.inputError, /Home was not replayed/);
        assert.equal(service.context.inputPaused, true);
    }
    assert.equal(releases, 6, "uncertain operations release interception");
    response = {exit_code: 0, stdout: "runtime output\n" + frame("sent", "ok")};
    commands.length = 0; await press();
    assert.deepEqual(commands, [control]);
    assert.equal(service.context.inputError, null);
    console.log("PASS launcher root control: one command per press, typed results, visible fallback, no replay after timeout/disconnect");
})().catch(error => {console.error(error); process.exitCode = 1;}).finally(() => {
    fs.rmSync(directory, {recursive: true, force: true});
});
