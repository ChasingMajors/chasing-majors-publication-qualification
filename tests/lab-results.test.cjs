'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const consumer=require('../scripts/calculate-prv-lab-results.cjs');
// The trusted official-document producer supplies this isolated test input.
const fixture=process.env.CM_LAB_TEST_CANDIDATE||path.join(__dirname,'fixtures/lab-result');
if(!fixture){test('authoritative consumer defaults closed without admission',()=>assert.throws(()=>consumer.calculate({schema_version:4,code:'not-admitted',meta:{code:'not-admitted'},method:{name:consumer.METHOD}}),/admission/));}
else{
 const original=JSON.parse(fs.readFileSync(path.join(fixture,'prv-input.json'))),cv=JSON.parse(fs.readFileSync(path.join(fixture,'cv-product.json')));
 const clone=()=>structuredClone(original),pins=i=>({[i.code]:{input_sha256:consumer.sha(i)}});
 test('authoritative method consumes all thirteen frozen estimates exactly, without rounding',()=>{
  const p=consumer.calculate(original,pins(original));assert.equal(p.rows.length,13);assert.equal(p.calculation_provenance.independent_recalculation,false);
  for(const r of p.rows){assert.equal(r.measurement.value,original.lab_result.calculation.results.find(x=>x.id===r.calculation.result_row_id).perCard);assert.equal(r.serial_limit,null);assert.equal(r.measurement.kind,'estimate');}
  assert.equal(p.rows[6].measurement.value,201.42857142857144);assert.equal(p.rows[6].official_serial_limit,null);assert.equal(p.rows[0].official_serial_limit,55);
 });
 test('lineage and assumptions preserved',()=>{const p=consumer.calculate(original,pins(original));assert.equal(p.calculation_provenance.project_id,original.lab_result.project_id);assert.equal(p.calculation_provenance.revision_id,original.lab_result.revision_id);assert.deepEqual(p.calculation_provenance.model,original.lab_result.model);assert.equal(p.calculation_provenance.assumptions,original.lab_result.calculation.assumptions);});
 test('external admission required, tampering cannot self-authorize',()=>{assert.throws(()=>consumer.calculate(original,{}),/admission/);const i=clone();i.records[0].estimate++;assert.throws(()=>consumer.calculate(i,pins(original)),/admission/);});
 for(const [name,change]of [
  ['unsupported method',i=>i.method.name='invented_v1'],['null revision',i=>i.lab_provenance.revision_id=null],
  ['snapshot hash',i=>i.lab_provenance.snapshot_sha256='0'.repeat(64)],['engine hash',i=>i.lab_provenance.model.engine_sha256='0'.repeat(64)],
  ['record value',i=>i.records[0].estimate++],['subject count',i=>i.records[0].subjects++],['invented serial',i=>i.records[6].serial_limit=199],
  ['official serial mismatch',i=>i.records[0].official_serial_limit=999],['recalculation anchors',i=>i.anchors=[]],['rounding',i=>i.method.round_estimates_to=5],
  ['missing validation',i=>i.lab_validation.status='PENDING'],['failed stability',i=>i.lab_validation.stability.invalid_refits=[{id:'x'}]],
  ['stability weakened',i=>i.lab_validation.stability.max_relative_change=1],['too few anchors',i=>i.lab_validation.stability.anchors_tested=1],
  ['duplicate records',i=>i.records.push(i.records[0])],['missing admitted record',i=>i.records.pop()],['SlabSquatch substituted',i=>i.lab_provenance.source_documents.odds.url='https://slabsquatch.com/estimate.pdf'],
  ['source hash drift',i=>i.lab_provenance.source_documents.checklist.sha256='1'.repeat(64)],['CV receipt drift',i=>i.lab_validation.cv_sha256='0'.repeat(64)]
 ])test('reject '+name+' even with a new input pin',()=>{const i=clone();change(i);assert.throws(()=>consumer.calculate(i,pins(i)));});
 test('CV identity metadata must match exact canonical index',()=>{const i=clone();const entry={Code:cv.meta.code,DisplayName:cv.meta.displayName,sport:cv.meta.sport,year:cv.meta.year,manufacturer:cv.meta.manufacturer,product:cv.meta.product};consumer.validateTarget(i,[entry]);assert.throws(()=>consumer.validateTarget(i,[{...entry,Code:'alias'}]));assert.throws(()=>consumer.validateTarget(i,[entry,entry]));assert.throws(()=>consumer.validateTarget(i,[{...entry,year:'2024'}]));});
 test('consumer has no Lab engine import, pack arithmetic, or creator calculator',()=>{const source=fs.readFileSync(path.join(__dirname,'../scripts/calculate-prv-lab-results.cjs'),'utf8');assert.doesNotMatch(source,/require\([^\n]*(?:engine\.js|calculate-prv-odds|reviewed-estimates)/);assert.doesNotMatch(source,/Math\.(?:round|floor|ceil)|odds_denominator|parseRatio/);});
 test('discrepancy is explicit and reproduced by Lab ablations',()=>{const d=JSON.parse(fs.readFileSync(path.join(fixture,'discrepancy.json')));assert.deepEqual(d.historical_lab.pack_totals,[81490]);assert.equal(d.legacy_prv.packs,82500);assert.deepEqual(d.current_lab_ablation.official_only_packs,[81780]);assert.deepEqual(d.current_lab_ablation.with_unconfirmed_199_weight_0_1,[81490]);assert.deepEqual(d.current_lab_ablation.five_base_serial_gt_1_packs,[82500]);});
}
