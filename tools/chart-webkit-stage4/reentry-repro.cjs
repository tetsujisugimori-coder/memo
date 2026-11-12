'use strict';
const {createStopController}=require(process.argv[2]),{createState}=require('./safety.cjs');
const state=createState('A');let stop,run,seen;
stop=createStopController({state,schedule:fn=>run=fn,cleanup:()=>{stop.finalize(()=>seen=state.result().failures.slice());throw Error('injected');}});
stop.request('fault');run();console.log(JSON.stringify({recorded:seen,actual:state.result().failures}));process.exitCode=seen.includes('cleanup_failed')?0:1;
