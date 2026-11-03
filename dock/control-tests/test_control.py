"""Run the actual TV launcher CLI without a display, including Unix identities."""
import errno
import os
from pathlib import Path
import pwd
import shutil
import subprocess
import sys
import tempfile
import unittest

DOTNET, SOURCE = sys.argv[1:3]
sys.argv = sys.argv[:1]
SOURCE = Path(SOURCE).resolve()


class ControlTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shared = Path(tempfile.mkdtemp(prefix="vetro-control-bin-"))
        cls.shared.chmod(0o755)
        for suffix in (".dll", ".runtimeconfig.json", ".deps.json"):
            source = SOURCE.with_name("tvlauncher-dotnet" + suffix)
            if source.exists():
                shutil.copyfile(source, cls.shared / source.name)
                (cls.shared / source.name).chmod(0o644)
        cls.dll = cls.shared / SOURCE.name

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.shared)

    def setUp(self):
        self.directory = Path(tempfile.mkdtemp(prefix="vetro-control-pipe-"))
        self.fifo = self.directory / "tvlauncher.fifo"
        self.reader = None
        self.pid = self.directory / "tvlauncher.pid"
        self.log = self.directory / "tvlauncher.log"
        self.pid.write_text("123456")
        self.log.write_text("resident launcher history\n")

    def tearDown(self):
        if self.reader is not None:
            os.close(self.reader)
        self.assertEqual(self.pid.read_text(), "123456", "control must not acquire the launcher instance")
        self.assertEqual(self.log.read_text(), "resident launcher history\n", "control must not trim or replace the log")
        shutil.rmtree(self.directory)

    def pipe(self, reader=True):
        os.mkfifo(self.fifo, 0o666)
        self.fifo.chmod(0o666)
        if reader:
            self.reader = os.open(self.fifo, os.O_RDONLY | os.O_NONBLOCK)

    def run_control(self, command="toggle", identity=None, directory=None):
        env = dict(os.environ, DOTNET_ROLL_FORWARD="Major", DOTNET_SYSTEM_GLOBALIZATION_INVARIANT="1")
        env.pop("DISPLAY", None)
        env.pop("WAYLAND_DISPLAY", None)
        def drop_identity():
            os.setgroups([])
            os.setgid(identity.pw_gid)
            os.setuid(identity.pw_uid)
        result = subprocess.run(
            [DOTNET, str(self.dll), "--control", command, "--dir", str(directory or self.directory)],
            capture_output=True, text=True, timeout=5, env=env,
            preexec_fn=drop_identity if identity else None,
        )
        frames = [line.split("\t") for line in result.stdout.splitlines()
                  if line.startswith("VETRO_LAUNCHER_CONTROL_V1\t")]
        self.assertEqual(len(frames), 1, result.stdout + result.stderr)
        return result.returncode, frames[0][1:]

    def test_repeated_toggle_and_no_display_or_instance_changes(self):
        self.pipe()
        for command in ("toggle", "toggle", "show", "hide"):
            self.assertEqual(self.run_control(command), (0, ["sent", "ok", "0"]))
            self.assertEqual(os.read(self.reader, 64), (command + "\n").encode())

    def test_private_directory_requires_the_root_execution_identity(self):
        self.assertEqual(os.geteuid(), 0, "run this suite through sudo to exercise the identity boundary")
        self.directory.chmod(0o750)
        self.pipe()
        code, result = self.run_control(identity=pwd.getpwnam("nobody"))
        self.assertEqual((code, result), (3, ["not-sent", "open", str(errno.EACCES)]))
        self.assertEqual(self.run_control(), (0, ["sent", "ok", "0"]))
        self.assertEqual(os.read(self.reader, 64), b"toggle\n")

    def test_no_reader_returns_without_blocking(self):
        self.pipe(reader=False)
        self.assertEqual(self.run_control(), (3, ["not-sent", "open", str(errno.ENXIO)]))

    def test_missing_pipe_or_directory_is_not_created_or_redirected(self):
        self.assertEqual(self.run_control(), (3, ["not-sent", "open", str(errno.ENOENT)]))
        self.assertFalse(self.fifo.exists())
        self.assertEqual(self.run_control(directory=self.directory / "absent"),
                         (3, ["not-sent", "open", str(errno.ENOENT)]))

    def test_regular_file_and_symlink_are_never_written(self):
        self.fifo.write_text("untouched")
        self.assertEqual(self.run_control(), (3, ["not-sent", "not-fifo", "0"]))
        self.assertEqual(self.fifo.read_text(), "untouched")
        self.fifo.unlink()
        target = self.directory / "target"
        os.mkfifo(target)
        self.reader = os.open(target, os.O_RDONLY | os.O_NONBLOCK)
        self.fifo.symlink_to(target)
        self.assertEqual(self.run_control(), (3, ["not-sent", "open", str(errno.ELOOP)]))

    def test_full_pipe_is_reported_without_retry_or_blocking(self):
        self.pipe()
        writer = os.open(self.fifo, os.O_WRONLY | os.O_NONBLOCK)
        try:
            while True:
                try:
                    os.write(writer, b"x" * 4096)
                except BlockingIOError:
                    break
            self.assertEqual(self.run_control(), (3, ["not-sent", "write", str(errno.EAGAIN)]))
        finally:
            os.close(writer)

    def test_unknown_commands_are_rejected(self):
        self.pipe()
        self.assertEqual(self.run_control("launch"), (3, ["not-sent", "invalid-command", "0"]))


unittest.main(verbosity=2)
