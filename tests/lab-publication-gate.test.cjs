'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const gate=require('../scripts/lab-publication-gate.cjs'),consumer=require('../scripts/calculate-prv-lab-results.cjs');
const dir=process.env.CM_LAB_REVIEW_FIXTURE||path.join(__dirname,'fixtures/lab-result');
const input=JSON.parse(fs.readFileSync(path.join(dir,'prv-input.json'))),cv=JSON.parse(fs.readFileSync(path.join(dir,'cv-product.json')));
// Contract fixtures below test authorization logic; they do NOT classify Bowman scientifically.
function fixture(){
 const i=structuredClone(input),c=structuredClone(cv),a=i.lab_result;
 const target={isolated:true,repository:'ChasingMajors/chasing-majors-maintenance-staging',repository_id:1465635186,served_origins:['https://chasingmajors.github.io']};
 const assessment={state:'Provisional',claim_kind:'estimated_pack_population',claim_sha256:gate.sha({fixture:'test-only claim'}),artifact_sha256:gate.sha(a),primary_evidence_confirmed:true,lineage_verified:true,eligibility_confirmed:true,unresolved_conflicts:[]};
 const admission={input_sha256:gate.sha(i),artifact_sha256:gate.sha(a),cv_sha256:gate.sha(c),engine_sha256:a.model.engine_sha256,project_id:a.project_id,revision_id:a.revision_id,snapshot_hash_scheme:'sha256-canonical-json-v1',source_documents:Object.fromEntries(['checklist','odds'].map(k=>[k,{url:i.lab_provenance.source_documents[k].url,sha256:i.lab_provenance.source_documents[k].sha256}])),allowed_result_rows:i.records.map(r=>r.id),lab_result_url:i.sources.estimate_url,claim_sha256:assessment.claim_sha256,assessment_sha256:gate.sha(assessment),allow_provisional_in_isolated_environment:true};
 const policy={schema_version:2,environment:'staging',production_writes_enabled:false,target,products:{[i.code]:admission}};
 const context={environment:'staging',target:structuredClone(target),scientific_assessment:assessment};return {i,c,policy,context,admission,assessment};
}
test('scoped staging authorization carries bound evidence without enabling production',()=>{const x=fixture(),r=gate.evaluate(x.i,x.c,x.policy,x.context);assert.equal(r.decision,'ALLOW_ISOLATED_PUBLICATION');assert.equal(r.production_write_enabled,false);assert.equal(r.confidence_state,'Provisional');});
test('production-equivalent requires its own explicit environment admission',()=>{const x=fixture();x.context.environment='production-equivalent';assert.throws(()=>gate.evaluate(x.i,x.c,x.policy,x.context),/admission policy/);x.policy.environment='production-equivalent';assert.equal(gate.evaluate(x.i,x.c,x.policy,x.context).environment,'production-equivalent');});
for(const [name,change]of [
 ['production',x=>{x.context.environment='production';x.policy.environment='production';}],
 ['legacy unscoped input digest',x=>{x.policy={products:x.policy.products};}],
 ['enabled production policy',x=>x.policy.production_writes_enabled=true],
 ['changed current CV payload',x=>x.c.rows[0].player='Different subject'],
 ['changed source input',x=>x.i.records[0].estimate++],
 ['changed independent engine pin',x=>x.admission.engine_sha256='0'.repeat(64)],
 ['changed independent snapshot pin',x=>x.admission.artifact_sha256='0'.repeat(64)],
 ['changed external revision pin',x=>x.admission.revision_id='different-revision'],
 ['changed external document pin',x=>x.admission.source_documents.odds.sha256='0'.repeat(64)],
 ['missing current CV identity',x=>x.c.meta.code='other-product'],
 ['missing explicit hash scheme',x=>delete x.admission.snapshot_hash_scheme],
 ['changed row set',x=>x.admission.allowed_result_rows.pop()],
 ['different repository target',x=>x.context.target.repository='ChasingMajors/chasing-majors-app'],
 ['non-isolated target',x=>x.context.target.isolated=false],
 ['production repository disguised as isolated',x=>{x.context.target.repository='ChasingMajors/chasing-majors-app';x.policy.target.repository=x.context.target.repository;}],
 ['missing scientific assessment',x=>delete x.context.scientific_assessment],
 ['unbound scientific assessment',x=>x.assessment.artifact_sha256='0'.repeat(64)],
 ['confidence label changed without receipt pin',x=>x.assessment.state='Verified'],
 ['provisional not explicitly admitted',x=>x.admission.allow_provisional_in_isolated_environment=false]
])test('hold '+name,()=>{const x=fixture();change(x);assert.throws(()=>gate.evaluate(x.i,x.c,x.policy,x.context));});
test('Insufficient Evidence stays held even with re-pinned assessment',()=>{const x=fixture();x.assessment.state='Insufficient Evidence';x.admission.assessment_sha256=gate.sha(x.assessment);assert.throws(()=>gate.evaluate(x.i,x.c,x.policy,x.context),/Insufficient evidence/);});
test('Provisional cannot hide an unresolved conflict behind a new receipt pin',()=>{const x=fixture();x.assessment.unresolved_conflicts=['unknown signer eligibility'];x.admission.assessment_sha256=gate.sha(x.assessment);assert.throws(()=>gate.evaluate(x.i,x.c,x.policy,x.context),/scientific evidence/);});
test('a new policy pin cannot authorize the production readback origin',()=>{const x=fixture();x.policy.target.served_origins=['https://app.chasingmajors.com'];x.context.target=structuredClone(x.policy.target);assert.throws(()=>gate.evaluate(x.i,x.c,x.policy,x.context),/origins/);});
test('Verified label cannot promote a frozen estimated artifact',()=>{const x=fixture();x.assessment.state='Verified';x.admission.assessment_sha256=gate.sha(x.assessment);assert.throws(()=>gate.evaluate(x.i,x.c,x.policy,x.context),/cannot authorize/);});
test('Verified official source fact cannot authorize dependent numerical Lab results',()=>{const x=fixture();Object.assign(x.assessment,{state:'Verified',claim_kind:'official_nominal_serial_limit'});x.admission.assessment_sha256=gate.sha(x.assessment);assert.throws(()=>gate.evaluate(x.i,x.c,x.policy,x.context),/cannot authorize/);x.context.environment='production';assert.throws(()=>gate.evaluate(x.i,x.c,x.policy,x.context),/remain disabled/);});
for(const [name,change]of [
 ['javascript source URL',i=>i.sources.estimate_url='javascript:alert(1)'],
 ['credential-bearing source URL',i=>i.sources.estimate_url='https://token@example.com/lab.json'],
 ['source URL query',i=>i.sources.estimate_url+='?token=not-a-secret'],
 ['non-numeric anchor count',i=>i.lab_validation.stability.anchors_tested='not-a-number'],
 ['string invalid-refits',i=>i.lab_validation.stability.invalid_refits=''],
 ['non-string parallel',i=>i.records[0].parallel={bad:true}]
])test('consumer rejects '+name+' despite new input digest',()=>{const i=structuredClone(input);change(i);assert.throws(()=>consumer.calculate(i,{[i.code]:{input_sha256:consumer.sha(i)}}));});
test('consumer provenance cannot override declared calculation authority',()=>{const i=structuredClone(input);i.lab_provenance.authority='Secondary source';i.lab_provenance.method='creator-estimate';const p=consumer.calculate(i,{[i.code]:{input_sha256:consumer.sha(i)}});assert.equal(p.calculation_provenance.authority,'Print Run Lab');assert.equal(p.calculation_provenance.method,'print_run_lab_estimates_v1');assert.equal(p.rows[0].measurement.verified,false);});
