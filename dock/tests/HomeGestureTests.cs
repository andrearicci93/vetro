using System;
using System.Collections.Generic;
using Launcher.Core;
namespace Launcher.Tests
{
    internal static class HomeGestureTests
    {
        public static void Run()
        {
            T.Run("Home double press: distinct down/up/down and immediate single", () => {
                var g = new HomeGesture();
                T.Eq(g.Feed(1,1,10),HomeGestureAction.Press,"first is immediate");
                T.Eq(g.Feed(1,1,10.01),HomeGestureAction.None,"duplicate down");
                g.Feed(1,0,10.06);
                T.Eq(g.Feed(1,1,10.2),HomeGestureAction.Double,"distinct second down");
                g.Feed(1,0,10.25);
                T.Eq(g.Feed(1,1,10.3),HomeGestureAction.None,"third quick tap consumed");
                g.Feed(1,0,10.4);
                T.Eq(g.Feed(1,1,11),HomeGestureAction.Press,"next separate gesture");
            });
            T.Run("Home double press: buffered time, repeats, navigation and reconnect", () => {
                var g = new HomeGesture();g.Feed(1,1,10);g.Feed(1,0,10.1);
                T.Eq(g.Feed(1,1,11),HomeGestureAction.Press,"buffered slow presses are not a pair");
                g.Feed(1,2,11.1);g.Feed(1,0,11.15);
                T.Eq(g.Feed(1,1,11.2),HomeGestureAction.Press,"held key cancelled pair");
                g.Feed(1,0,11.22);g.Reset();
                T.Eq(g.Feed(1,1,11.25),HomeGestureAction.Press,"navigation cancels pair");
                g.Feed(1,0,11.26);
                T.Eq(g.Feed(2,1,11.3),HomeGestureAction.Press,"different input node cannot finish pair");
            });
            T.Run("evdev Home events: timestamps, release, repeat and split records on 32/64 bit", () => {
                foreach (int size in new[] {16,24}) {
                    var bytes = new byte[size*3];
                    for(int i=0;i<3;i++) {
                        int o=i*size,t=o+size-8;
                        if(size==16){Array.Copy(BitConverter.GetBytes(10),0,bytes,o,4);Array.Copy(BitConverter.GetBytes(i*100000),0,bytes,o+4,4);}
                        else {Array.Copy(BitConverter.GetBytes(10L),0,bytes,o,8);Array.Copy(BitConverter.GetBytes((long)i*100000),0,bytes,o+8,8);}
                        bytes[t]=1;bytes[t+2]=63;bytes[t+4]=(byte)(i==0?1:i==1?0:2);
                    }
                    var reader=new EvdevReader(size);var events=new List<InputKeyEvent>();
                    reader.FeedEvents(bytes,size-1,e=>events.Add(e));
                    T.Eq(events.Count,0,"partial record held");
                    var tail=new byte[bytes.Length-size+1];Array.Copy(bytes,size-1,tail,0,tail.Length);
                    reader.FeedEvents(tail,tail.Length,e=>events.Add(e));
                    T.Eq(events.Count,3,"all transitions retained");T.Eq(events[1].Value,0,"release");
                    T.Eq(events[2].Time,10.2,"kernel event time retained");
                }
            });
        }
    }
}
