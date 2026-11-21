'use strict';
// Offline single-product/single-field maintenance plan. No publication capability.
const crypto=require('node:crypto');
const CODE='2026_topps_mlb_x_kaws_baseball',PATH='data/prv-calculations/kaws-2026.json';
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const sha=v=>crypto.createHash('sha256').update(canonical(v)).digest('hex');
function plan(input,claim,assessment,{source_sha,claim_sha256,assessment_sha256}={}){
 if(!/^[a-f0-9]{40}$/.test(source_sha||''))throw Error('Pinned source commit required');
 if(input.code!==CODE||input.meta?.code!==CODE||claim.product_code!==CODE||claim.kind!=='official_pack_odds'||claim.value!=='1:38'||claim.asserts_packed_count!==false)throw Error('Unapproved product or claim');
 if(claim_sha256!==sha(claim)||assessment_sha256!==sha(assessment)||assessment.claim_sha256!==claim_sha256||assessment.claim_kind!==claim.kind||assessment.state!=='Verified'||assessment.production_auto_authorized!==false)throw Error('External verified claim receipt required');
 const url='https://cdn.shopify.com/s/files/1/0662/9749/5709/files/KAWS_Odds.pdf?v=1784559267',hash='7d53f1fa1535a812520a3a4611e57da0661e3d2e26536c703d0cf3802ded2ef1';
 const row='26TNKB - BASE CARDS ORANGE PARALLEL';
 if(input.sources?.odds_url!==url||input.sources.odds_sha256!==hash||claim.primary_sources?.length!==1||claim.primary_sources[0].url!==url||claim.primary_sources[0].sha256!==hash||claim.official_field?.source_sha256!==hash||claim.official_field.value!=='1:38'||claim.official_field.page!==1||claim.official_field.row!==row+' 1:38')throw Error('Official field/source pin mismatch');
 const matches=input.odds_rows?.filter(r=>r.odds_label===row);
 if(matches?.length!==1||matches[0].odds_denominator!==38)throw Error('Existing official odds drifted; correction not authorized');
 const fact={kind:'official_pack_odds',value:'1:38',state:'Verified',scope:claim.subject_scope,source_url:url,source_sha256:hash,page:1,row,claim_sha256,assessment_sha256,asserts_actual_packed_count:false,note:'Verifies published intended-configuration odds only. Does not verify existing calculated print runs or serial assumptions.'};
 const before=sha(input),existing=input.sources.official_fact_receipts?.orange_pack_odds;
 if(existing&&sha(existing)!==sha(fact))throw Error('Conflicting existing fact receipt requires review');
 const after=structuredClone(input);after.sources.official_fact_receipts={...(after.sources.official_fact_receipts||{}),orange_pack_odds:fact};
 if(Buffer.byteLength(JSON.stringify(after))>512*1024)throw Error('Source budget exceeded');
 return {result:existing?'NOOP':'PLANNED',production_write_enabled:false,publication_authorized:false,source_sha,path:PATH,code:CODE,before_sha256:before,after_sha256:sha(after),changed_field:'sources.official_fact_receipts.orange_pack_odds',numeric_changes:0,after};
}
module.exports={plan,sha};
