'use strict';
// Standalone dummy. Self-terminates even if the harness disappears.
const timer=setTimeout(()=>process.exit(0),1200);
process.on('message',m=>{if(m&&m.type==='finish'){clearTimeout(timer);process.exit(0);}});
if(process.send)process.send({type:'ready',pid:process.pid});
