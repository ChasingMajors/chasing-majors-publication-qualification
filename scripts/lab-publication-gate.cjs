'use strict';
// Pure authorization check. No network, credentials, calculation, or mutations.
const crypto=require('node:crypto');
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(object(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
const sha=v=>crypto.createHash('sha256').update(canonical(v)).digest('hex');
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function equal(a,b,message){if(canonical(a)!==canonical(b))throw Error(message);}
function publicHttps(value){
 let url;try{url=new URL(value);}catch{throw Error('Invalid Lab result URL');}
 if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search)throw Error('Invalid Lab result URL');return url.href;
}
function evaluate(input,cvProduct,policy,context){
 if(!object(context)||!['staging','production-equivalent','production'].includes(context.environment))throw Error('Explicit publication environment required');
 if(context.environment==='production')throw Error('Autonomous production writes remain disabled');
 if(!object(policy)||policy.schema_version!==2||policy.production_writes_enabled!==false||policy.environment!==context.environment||!object(policy.products))throw Error('Unsupported scoped admission policy');
 if(!object(context.target)||!object(policy.target)||context.target.isolated!==true||policy.target.isolated!==true)throw Error('Explicit isolated target required');
 equal(context.target,policy.target,'Publication target differs from admission');
 if(!['ChasingMajors/chasing-majors-maintenance-staging','ChasingMajors/chasing-majors-publication-qualification'].includes(policy.target.repository)||!Number.isSafeInteger(policy.target.repository_id)||policy.target.repository_id<=0)throw Error('Non-staging repository denied');
 if(!Array.isArray(policy.target.served_origins)||!policy.target.served_origins.length||policy.target.served_origins.some(origin=>{
  try{const u=new URL(origin);return !['https://chasingmajors.github.io','https://prv-qualification.chasingmajors.com'].includes(origin)||u.protocol!=='https:'||u.origin!==origin||u.username||u.password;}catch{return true;}
 }))throw Error('Explicit HTTPS readback origins required');
 const p=policy.products[input.code],a=input.lab_result,l=input.lab_provenance;
 if(!object(p)||!object(a)||!object(l)||!hash(p.input_sha256)||p.input_sha256!==sha(input))throw Error('Input lacks scoped external admission');
 if(p.artifact_sha256!==sha(a)||p.cv_sha256!==sha(cvProduct)||p.cv_sha256!==l.cv_sha256||p.engine_sha256!==a.model?.engine_sha256||p.project_id!==a.project_id||p.revision_id!==a.revision_id)throw Error('External lineage or current CV payload differs');
 if(cvProduct?.meta?.code!==input.code||!Array.isArray(cvProduct.rows))throw Error('Current CV payload identity invalid');
 if(p.snapshot_hash_scheme!=='sha256-canonical-json-v1')throw Error('Explicit snapshot hash scheme required');
 for(const kind of ['checklist','odds']){
  const d=p.source_documents?.[kind],s=l.source_documents?.[kind];
  if(!object(d)||!hash(d.sha256)||d.sha256!==s?.sha256||d.url!==s?.url)throw Error('External primary-source pin differs');
 }
 if(!Array.isArray(p.allowed_result_rows)||new Set(p.allowed_result_rows).size!==p.allowed_result_rows.length)throw Error('External result row admission required');
 equal(p.allowed_result_rows,input.records?.map(r=>r.id),'Result rows differ from external admission');
 const resultUrl=publicHttps(input.sources?.estimate_url);
 if(resultUrl!==p.lab_result_url||!policy.target.served_origins.includes(new URL(resultUrl).origin))throw Error('Result URL outside isolated target');
 // This receipt is supplied by the independent confidence classifier, never the model.
 const assessment=context.scientific_assessment;
 if(!object(assessment)||!['Verified','Provisional','Insufficient Evidence'].includes(assessment.state)||assessment.claim_sha256!==p.claim_sha256||assessment.artifact_sha256!==p.artifact_sha256)throw Error('Independent confidence receipt missing or unbound');
 if(!hash(p.claim_sha256)||p.assessment_sha256!==sha(assessment))throw Error('Confidence assessment differs from admission');
 if(assessment.state==='Insufficient Evidence')throw Error('Insufficient evidence: numerical publication held');
 if(!['estimated_pack_population','estimated_copies_per_card'].includes(assessment.claim_kind)||assessment.state==='Verified')throw Error('Verified source facts cannot authorize a Lab estimate artifact');
 // Verified does not arise from fitting or leave-one-anchor-out stability alone.
 if(assessment.primary_evidence_confirmed!==true||assessment.lineage_verified!==true||assessment.eligibility_confirmed!==true||!Array.isArray(assessment.unresolved_conflicts)||assessment.unresolved_conflicts.length)throw Error('Claim lacks scientific evidence');
 if(assessment.state==='Provisional'&&p.allow_provisional_in_isolated_environment!==true)throw Error('Provisional publication not explicitly admitted');
 return {decision:'ALLOW_ISOLATED_PUBLICATION',environment:context.environment,target:policy.target,confidence_state:assessment.state,input_sha256:p.input_sha256,artifact_sha256:p.artifact_sha256,assessment_sha256:p.assessment_sha256,production_write_enabled:false};
}
module.exports={canonical,sha,evaluate,publicHttps};
