'use strict';
// PRV is a consumer of an admitted immutable Lab result. No odds/pack calculation here.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const model=require('../shared/vault-model.js');
const METHOD='print_run_lab_estimates_v1';
function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
const sha=v=>crypto.createHash('sha256').update(canonical(v)).digest('hex');
function admissions(){const p=path.join(__dirname,'../data/prv-lab-admissions.json');return fs.existsSync(p)?JSON.parse(fs.readFileSync(p)).products:{};}
function validateTarget(input,cv){
 const matches=cv.filter(p=>p.Code===input.code);if(matches.length!==1)throw Error('Lab result requires one exact CV identity');
 for(const [a,b]of [['code','Code'],['displayName','DisplayName'],['sport','sport'],['year','year'],['manufacturer','manufacturer'],['product','product']])if(input.meta?.[a]!==matches[0][b])throw Error('Lab CV metadata conflict: '+a);
}
function validate(input,pins=admissions()){
 if(input.schema_version!==4||input.method?.name!==METHOD||input.meta?.code!==input.code)throw Error('Unsupported Lab method or identity');
 if(!pins?.[input.code]||pins[input.code].input_sha256!==sha(input))throw Error('Lab input lacks trusted admission pin');
 const a=input.lab_result,p=input.lab_provenance,v=input.lab_validation;
 if(!a||a.schema_version!==1||a.estimate_status!=='provisional'||a.calibration_status!=='not-yet-calibrated'||a.calculation?.valid!==true||!a.calculation?.hasEstimate)throw Error('Invalid Lab frozen result');
 if(!/^prl_[a-zA-Z0-9-]{8,80}$/.test(a.project_id)||!/^[a-zA-Z0-9-]{8,80}$/.test(a.revision_id)||!Number.isFinite(Date.parse(a.published_at)))throw Error('Missing immutable Lab identity');
 if(p?.project_id!==a.project_id||p.revision_id!==a.revision_id||p.snapshot_sha256!==sha(a)||canonical(p.model)!==canonical(a.model)||p.status!=='staging-published-revision')throw Error('Lab lineage mismatch');
 if(v?.status!=='PASS'||v.artifact_sha256!==sha(a)||v.cv_sha256!==p.cv_sha256||!v.cv_sha256||v.engine_sha256!==a.model.engine_sha256||!/^[a-f0-9]{64}$/.test(a.model.engine_sha256))throw Error('Lab validation receipt mismatch');
 if(!Array.isArray(v.stability?.invalid_refits)||v.stability.invalid_refits.length!==0||v.stability.max_relative_change!==0.05||!Number.isSafeInteger(v.stability.anchors_tested)||v.stability.anchors_tested<3)throw Error('Lab stability qualification missing');
 let resultURL;try{resultURL=new URL(input.sources?.estimate_url);}catch{throw Error('Lab result source URL invalid');}
 if(resultURL.protocol!=='https:'||resultURL.username||resultURL.password||resultURL.search||resultURL.hash)throw Error('Lab result source URL invalid');
 for(const kind of ['checklist','odds']){
  const d=p.source_documents?.[kind],s=a.project.sources?.[kind];
  if(!d||d.sha256!==s?.sha256||d.url!==s?.url||!/^https:\/\/cdn\.shopify\.com\/s\/files\/1\/0662\/9749\/5709\/files\/[^/]+\.pdf$/.test(d.url)||!(/^[a-f0-9]{64}$/.test(d.sha256)))throw Error('Official source evidence mismatch');
 }
 if(['anchors','formats','odds_rows','estimated_packs'].some(k=>input[k]!==undefined)||input.method.round_estimates_to!==undefined)throw Error('PRV must not recalculate Lab values');
 if(!Array.isArray(input.records)||!input.records.length||!Array.isArray(v.admitted_rows)||canonical(input.records.map(r=>r.id))!==canonical(v.admitted_rows))throw Error('Lab admitted rows mismatch');
 const ids=new Set(),groups=new Set();
 for(const r of input.records){
  const frozen=a.calculation.results.find(x=>x.id===r.id),src=a.project.rows.find(x=>x.id===r.id),family=a.project.families.find(f=>f.id===src?.familyId);
  if(ids.has(r.id)||!frozen||!family||typeof r.name!=='string'||!r.name.trim()||r.name!==r.name.trim()||r.name.length>500||r.parallel!==undefined&&typeof r.parallel!=='string'||!['Base','Insert','Autograph'].includes(r.category)||!Number.isInteger(r.subjects)||r.subjects!==family.count||r.subjects!==frozen.count||r.kind!=='estimate'||r.serial_limit!==null||!Number.isFinite(r.estimate)||r.estimate<=0||r.estimate!==frozen.perCard||r.official_serial_limit!==src.serial)throw Error('Lab estimate differs from frozen result');
  ids.add(r.id);const key=canonical([r.category,r.name,r.parallel]);if(groups.has(key))throw Error('Duplicate Lab display identity');groups.add(key);
 }
 return input;
}
function calculate(input,pins){
 validate(input,pins);
 const p=input.lab_provenance;
 const rows=input.records.map((r,i)=>{
  const raw={code:input.code,setType:r.category==='Autograph'?'Auto':r.category,setLine:r.name,parallel:r.parallel||'',printRun:r.estimate,serial:'',subSetSize:r.subjects,
   notes:'Provisional authoritative Print Run Lab estimate; unrounded, not manufacturer-confirmed. Nominal numbered ceilings are separate evidence; checklist-wide equal-production assumption may not describe each subject.',cmURL:input.sources.estimate_url};
  const row=model.row(raw,input.code,i+1);
  row.id=input.code+':lab:'+r.id;row.serial_limit=null;
  row.measurement={value:r.estimate,kind:'estimate',unit:'cards',scope:'per_card',basis:'frozen_print_run_lab_estimate',verified:false};
  row.official_serial_limit=r.official_serial_limit;
  row.calculation={authority:'Print Run Lab',project_id:p.project_id,revision_id:p.revision_id,snapshot_sha256:p.snapshot_sha256,result_row_id:r.id,model:p.model,assumptions:input.lab_result.calculation.assumptions};
  row.source={url:input.sources.estimate_url,checklist_url:p.source_documents.checklist.url,odds_url:p.source_documents.odds.url};return row;
 });
 return {schema_version:2,meta:input.meta,rows,calculation_provenance:{...p,method:METHOD,authority:'Print Run Lab',validation_receipt:input.lab_validation,assumptions:input.lab_result.calculation.assumptions,pack_totals:input.lab_result.calculation.packTotals,independent_recalculation:false}};
}
module.exports={METHOD,canonical,sha,validate,validateTarget,calculate};
