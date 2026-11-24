'use strict';
// Real TCP SDB-wire harness: uses Vetro's actual adb.js and vddebugmenu.js.
// It is not a FakeStream; packets are encoded/decoded as CNXN/OPEN/OKAY/WRTE/CLSE.
const assert = require('assert').strict;
const net = require('net');
const {Connection} = require('../service/adb.js');
const vd = require('../service/vddebugmenu.js');
const C = n => Buffer.from(n).readUInt32LE(0);
const N = {CNXN:C('CNXN'),OPEN:C('OPEN'),OKAY:C('OKAY'),WRTE:C('WRTE'),CLSE:C('CLSE')};
const magic = c => (c ^ 0xffffffff) >>> 0;
function sum(b){let n=0;for(const x of b)n=(n+x)>>>0;return n;}
function packet(c,a,b,p){p=Buffer.from(p||'');let q=Buffer.alloc(24+p.length);q.writeUInt32LE(c,0);q.writeUInt32LE(a,4);q.writeUInt32LE(b,8);q.writeUInt32LE(p.length,12);q.writeUInt32LE(sum(p),16);q.writeUInt32LE(magic(c),20);p.copy(q,24);return q;}
async function main(){
 let writes=[], opens=[]; const server=net.createServer(sock=>{let buf=Buffer.alloc(0), sid=900;
  sock.on('data',d=>{buf=Buffer.concat([buf,d]);while(buf.length>=24){let len=buf.readUInt32LE(12);if(buf.length<24+len)return;let c=buf.readUInt32LE(0),a=buf.readUInt32LE(4),b=buf.readUInt32LE(8),p=buf.slice(24,24+len);buf=buf.slice(24+len);
   if(c===N.CNXN){sock.write(packet(N.CNXN,0x01000000,4096,'device::'));continue;}
   if(c===N.OPEN){let s=p.toString().replace(/\0$/,'');opens.push(s);sock.write(packet(N.OKAY,sid,a));continue;}
   if(c===N.WRTE){writes.push(p.toString());sock.write(packet(N.OKAY,sid,a));
    if(writes.length===1){let done=writes[0].match(/echo (VD[0-9a-f]+);#/)[1];
      const chunks=['[VDDEBUG] run dlogd_sdb\n','VBok\n','uid=0(root)\n',done+'\n'];
      chunks.forEach(x=>sock.write(packet(N.WRTE,sid,a,x)));sock.write(packet(N.CLSE,sid,a));}
   }
  }});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const client=new Connection('127.0.0.1',server.address().port);
 const out=await vd.run(client,'cat /tmp/vetro/l.sh|/bin/sh',{timeout:3000,profile:'generic'});
 assert.deepEqual(opens,['shell:0 hyperuart_vddebugmenu']);
 assert.equal(writes.length,1);
 assert.ok(writes[0].includes('20089999\n94\n7\n1\n'));
 assert.ok(writes[0].includes('x;echo VB'));
 assert.ok(writes[0].includes(';cat /tmp/vetro/l.sh|/bin/sh;echo VE'));
 assert.ok(writes[0].includes(';echo VD'));
 assert.ok(out.includes('uid=0(root)'));
 client.close(); server.close(); console.log('PASS real SDB wire: CNXN OPEN OKAY WRTE CLSE, fragments, exact service and vddebug sequence');
}
main().catch(e=>{console.error(e.stack);process.exit(1);});
