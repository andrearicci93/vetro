using System;
using System.Runtime.InteropServices;
class TvState {
 [DllImport("libcapi-media-sound-manager-tv.so.0",EntryPoint="sound_manager_get_master_volume")] static extern int Volume(out int value);
 [DllImport("libcapi-media-sound-manager-tv.so.0",EntryPoint="sound_manager_get_master_mute")] static extern int Mute(out int value);
 [DllImport("libvconf.so.0",EntryPoint="vconf_get_int")] static extern int Source(string key,out int value);
 static int Main(string[] args){
  int v=0,m=0,s=0,vr=-1,mr=-1,sr=-1;
  try{vr=Volume(out v);}catch{}
  try{mr=Mute(out m);}catch{}
  try{sr=Source("memory/system/source_type",out s);}catch{}
  string json = "{\"volume\":"+(vr==0&&v>=0&&v<=100?v.ToString():"null")+",\"muted\":"+(mr==0&&(m==0||m==1)?(m==1?"true":"false"):"null")+",\"sourceType\":"+(sr==0?s.ToString():"null")+"}";
  if(args.Length==1)System.IO.File.WriteAllText(args[0],json);else Console.WriteLine(json);return 0;
 }
}
