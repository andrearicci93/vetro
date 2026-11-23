using System;
using System.Runtime.InteropServices;
class TvState {
 [DllImport("libcapi-media-sound-manager-tv.so.0",EntryPoint="sound_manager_get_master_volume")] static extern int Volume(out int value);
 [DllImport("libcapi-media-sound-manager-tv.so.0",EntryPoint="sound_manager_get_master_mute")] static extern int Mute(out int value);
 [DllImport("libvconf.so.0",EntryPoint="vconf_get_int")] static extern int Source(string key,out int value);
 [DllImport("libdeviced.so.1", EntryPoint="device_power_get_state")] static extern int PowerState();
 [DllImport("libdeviced.so.1", EntryPoint="device_get_screen_state")] static extern int ScreenState();

 static string ReadState(Func<int> getter) {
  try {
   int value = getter();
   return value >= 0 ? value.ToString() : "null";
  } catch (DllNotFoundException) {
   return "null";
  } catch (EntryPointNotFoundException) {
   return "null";
  }
 }

 static int Main(){
  int v=0,m=0,s=0,vr=-1,mr=-1,sr=-1;
  try{vr=Volume(out v);}catch{}
  try{mr=Mute(out m);}catch{}
  try{sr=Source("memory/system/source_type",out s);}catch{}
  Console.WriteLine("{\"volume\":"+(vr==0&&v>=0&&v<=100?v.ToString():"null")+",\"muted\":"+(mr==0&&(m==0||m==1)?(m==1?"true":"false"):"null")+",\"sourceType\":"+(sr==0?s.ToString():"null")+",\"nativePowerState\":"+ReadState(PowerState)+",\"nativeScreenState\":"+ReadState(ScreenState)+"}");return 0;
 }
}
