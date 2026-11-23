using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Launcher.Core;
using Launcher.Native;

internal static class Program
{
    private static void Check(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
    }

    private static void Reject(Action action, string expected)
    {
        try { action(); }
        catch (Exception error)
        {
            Check(error.Message.Contains(expected, StringComparison.Ordinal), error.ToString());
            return;
        }
        throw new Exception("Expected failure: " + expected);
    }

    private static int Serve(string dir, string file)
    {
        int pid = Libc.getpid();
        File.WriteAllText(Path.Combine(dir,"tvlauncher.pid"),pid.ToString());
        Check(Libc.mkfifo(Path.Combine(dir,"tvlauncher.fifo"),384) == 0,"create FIFO");
        int fd = Libc.open(Path.Combine(dir,"tvlauncher.fifo"),Libc.O_RDWR | Libc.O_NONBLOCK);
        Check(fd >= 0,"open FIFO");
        File.WriteAllText(Path.Combine(dir,"ready"),"ready");
        var apps = new [] {new AppEntry("samsunghome","Samsung Home","Samsung.Home",null)};
        var buffer = new byte[128];
        while (true)
        {
            int n = (int)Libc.read(fd,buffer,(UIntPtr)buffer.Length);
            if (n > 0 && !File.Exists(Path.Combine(dir,"ignore")))
            {
                Check(Encoding.ASCII.GetString(buffer,0,n) == "reload-double-home\n","fixed command only");
                DoubleHomeSettings.ApplyFile(file,pid,apps,
                    target=>File.WriteAllText(Path.Combine(dir,"target"),target == null ? "off" : target.AppId),
                    ack=>Check(Libc.chmod(ack,384) == 0,"private acknowledgement"));
            }
            Thread.Sleep(10);
        }
    }

    private static string Request(int pid, string mode, string app = "")
    {
        return "v1\t"+Guid.NewGuid().ToString("N")+"\t"+pid+"\t"+mode+"\t"+app+"\n";
    }

    private static string Encoded(string request) { return Convert.ToBase64String(Encoding.ASCII.GetBytes(request)); }

    private static int Main(string[] args)
    {
        if (args.Length == 4 && args[0] == "--serve") return Serve(args[1],args[3]);
        Check(Libc.getuid() == 0,"Run with sudo to exercise the root/app permission boundary");
        string dir = Path.Combine(Path.GetTempPath(),"vetro-settings-"+Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        Check(Libc.chmod(dir,448) == 0,"private runtime directory");
        string file = Path.Combine(dir,"tvlauncher-double-home.tsv"), fifo = Path.Combine(dir,"tvlauncher.fifo");
        Process server = null;
        try
        {
            var start = new ProcessStartInfo(Environment.ProcessPath) {UseShellExecute=false};
            foreach (string arg in new [] {Assembly.GetExecutingAssembly().Location,"--serve",dir,"--double-home-settings",file})
                start.ArgumentList.Add(arg);
            server = Process.Start(start);
            var ready = Stopwatch.StartNew();
            while (!File.Exists(Path.Combine(dir,"ready")) && !server.HasExited && ready.ElapsedMilliseconds < 5000) Thread.Sleep(10);
            Check(!server.HasExited && File.Exists(Path.Combine(dir,"ready")),"resident ready");

            // Reproduce the service-side access denial with a genuinely unprivileged process.
            var denied = new ProcessStartInfo("node") {UseShellExecute=false,RedirectStandardOutput=true,RedirectStandardError=true};
            denied.ArgumentList.Add("-e");
            denied.ArgumentList.Add("process.setgid(65534);process.setuid(65534);try{require('fs').openSync(process.argv[1],'w');process.exitCode=1;}catch(e){console.log(e.code);process.exitCode=e.code==='EACCES'?0:2;}");
            denied.ArgumentList.Add(fifo);
            using (var app = Process.Start(denied))
            {
                Check(app.WaitForExit(3000),"permission check bounded");
                Check(app.ExitCode == 0 && app.StandardOutput.ReadToEnd().Trim() == "EACCES","unprivileged service is denied");
            }

            Action<string,string,string> apply = (mode,app,target) => {
                string request = Request(server.Id,mode,app);
                Check(DoubleHomeClient.Apply(Encoded(request),dir,file) == "double-home-applied "+request.Split('\t')[1],"exact nonce acknowledgement");
                Check(File.ReadAllText(file+".applied") == request,"exact request applied");
                Check(File.ReadAllText(Path.Combine(dir,"target")) == target,"runtime target updated");
                Check(!server.HasExited && File.ReadAllText(Path.Combine(dir,"tvlauncher.pid")) == server.Id.ToString(),"same running process");
                Check(!File.Exists(file),"request consumed");
            };
            apply("app","GlassHome1.Home","GlassHome1.Home");
            apply("app","GlassHome1.Home","GlassHome1.Home");
            apply("app","Other.Home","Other.Home");
            apply("shortcut","","Samsung.Home");
            apply("off","","off");
            Reject(()=>DoubleHomeClient.Apply(Encoded(Request(server.Id+1,"off")),dir,file),"running launcher changed");
            Reject(()=>DoubleHomeClient.Apply(Encoded(Request(server.Id,"off")),dir,file+"wrong"),"settings location");
            Reject(()=>DoubleHomeClient.Apply(Encoded("bad"),dir,file),"Invalid settings request");

            File.WriteAllText(Path.Combine(dir,"ignore"),"");
            string unconfirmed = Request(server.Id,"app","Ignored.Home");
            Reject(()=>DoubleHomeClient.Apply(Encoded(unconfirmed),dir,file,120),"did not acknowledge");
            Check(!File.Exists(file),"timed out request removed");
            Check(File.ReadAllText(Path.Combine(dir,"target")) == "off","stale acknowledgement rejected");
            File.Delete(Path.Combine(dir,"ignore"));

            File.Delete(fifo);
            File.WriteAllText(fifo,"unchanged");
            Reject(()=>DoubleHomeClient.Apply(Encoded(Request(server.Id,"off")),dir,file),"not a pipe");
            Check(File.ReadAllText(fifo) == "unchanged","ordinary file untouched");
            File.Delete(fifo);
            File.CreateSymbolicLink(fifo,Path.Combine(dir,"target"));
            Reject(()=>DoubleHomeClient.Apply(Encoded(Request(server.Id,"off")),dir,file),"Cannot open");
            File.Delete(fifo);
            Check(Libc.mkfifo(fifo,384) == 0,"create readerless FIFO");
            var bounded = Stopwatch.StartNew();
            Reject(()=>DoubleHomeClient.Apply(Encoded(Request(server.Id,"off")),dir,file),"Cannot open");
            Check(bounded.ElapsedMilliseconds < 1000,"absent reader never blocks");
            Check(DoubleHomeClient.NoFollowFlag(Architecture.Arm) == 32768,"ARM32 no-follow flag");
            Check(DoubleHomeClient.NoFollowFlag(Architecture.X64) == 131072,"x64 no-follow flag");
            Console.WriteLine("PASS root/app EACCES boundary, same-process live settings, private acknowledgements, timeout and FIFO validation");
            return 0;
        }
        finally
        {
            if (server != null) { if (!server.HasExited) server.Kill(); server.WaitForExit(3000); server.Dispose(); }
            Directory.Delete(dir,true);
        }
    }
}
