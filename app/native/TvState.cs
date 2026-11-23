using System;
using System.Runtime.InteropServices;
class TvState {
 [DllImport("libcapi-media-sound-manager-tv.so.0",EntryPoint="sound_manager_get_master_volume")] static extern int Volume(out int value);
 [DllImport("libcapi-media-sound-manager-tv.so.0",EntryPoint="sound_manager_get_master_mute")] static extern int Mute(out int value);
 [DllImport("libvconf.so.0",EntryPoint="vconf_get_int")] static extern int Source(string key,out int value);
 [DllImport("libsource-api.so", EntryPoint="connect_source")] static extern int ConnectSource(int source);
 static int Main(string[] args){
  if (args.Length > 0) {
   if (args.Length != 1 || args[0] != "select-displayport") return 2;
   const int displayPort = 33;
   ConnectSource(displayPort);
   for (int attempt = 0; attempt < 10; attempt++) {
    System.Threading.Thread.Sleep(500);
    int selected;
    if (Source("memory/system/source_type", out selected) == 0 && selected == displayPort) return 0;
   }
   Console.Error.WriteLine("DisplayPort selection was not confirmed");
   return 1;
  }
  int v=0,m=0,s=0,vr=-1,mr=-1,sr=-1;
  try{vr=Volume(out v);}catch{}
  try{mr=Mute(out m);}catch{}
  try{sr=Source("memory/system/source_type",out s);}catch{}
  Console.WriteLine("{\"volume\":"+(vr==0&&v>=0&&v<=100?v.ToString():"null")+",\"muted\":"+(mr==0&&(m==0||m==1)?(m==1?"true":"false"):"null")+",\"sourceType\":"+(sr==0?s.ToString():"null")+"}");return 0;
 }
}
