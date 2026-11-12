'use strict';
// Public synthetic evidence: no stack paths, environment, or process output.
module.exports=async function* (source){for await(const e of source){if(e.type==='test:pass'||e.type==='test:fail'){const error=e.data.details?.error;yield JSON.stringify({type:e.type,name:e.data.name,...(error?{code:error.code,actual:error.cause?.actual,expected:error.cause?.expected}: {})})+'\n';}else if(e.type==='test:summary')yield JSON.stringify({type:e.type,counts:e.data.counts})+'\n';}};
