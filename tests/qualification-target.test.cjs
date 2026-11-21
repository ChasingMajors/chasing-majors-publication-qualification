'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const q=require('../scripts/qualification-target.cjs');
const fixture=()=>({schema_version:1,environment:'isolated-publication-qualification',qualified_resource_setup:true,repository:q.REPOSITORY,repository_id:1234567,branch:'main',origin:q.ORIGIN,production_writes_enabled:false,setup_evidence_sha256:'a'.repeat(64)});
const ctx=()=>({GITHUB_REPOSITORY:q.REPOSITORY,GITHUB_REPOSITORY_ID:'1234567',GITHUB_REF:'refs/heads/main'});
test('reviewed isolated context passes a synthetic unit fixture only',()=>assert.equal(q.validate(fixture(),ctx()).origin,q.ORIGIN));
test('unqualified bootstrap fixture rejects execution',()=>{const p={...fixture(),qualified_resource_setup:false,repository_id:null,setup_evidence_sha256:null};assert.throws(()=>q.validate(p,ctx()),/bootstrap/);});
test('checked-in policy stays isolated before and after administrator setup',()=>{const p=require('../.qualification/target.json');assert.equal(p.production_writes_enabled,false);const env={...ctx(),GITHUB_REPOSITORY_ID:String(p.repository_id)};if(p.qualified_resource_setup===true)assert.equal(q.validate(p,env),p);else assert.throws(()=>q.validate(p,env),/bootstrap/);});
for(const [name,key,value]of [['production repository','repository','ChasingMajors/chasing-majors-app'],['production host','origin','https://app.chasingmajors.com/'],['unapproved custom host','origin','https://example.com/'],['production enable flag','production_writes_enabled',true],['repository id unknown','repository_id',null],['no setup evidence','setup_evidence_sha256',null],['unqualified setup','qualified_resource_setup',false],['other branch','branch','qualification']])test('reject '+name,()=>{const p=fixture();p[key]=value;assert.throws(()=>q.validate(p,ctx()));});
test('runtime repository id and ref cannot drift',()=>{assert.throws(()=>q.validate(fixture(),{...ctx(),GITHUB_REPOSITORY_ID:'999'}));assert.throws(()=>q.validate(fixture(),{...ctx(),GITHUB_REF:'refs/heads/unreviewed'}));});
test('deploy metadata is host-pinned and readback always normalizes to HTTPS',()=>{assert.equal(q.deploymentOrigin(fixture(),q.ORIGIN),q.ORIGIN);assert.equal(q.deploymentOrigin(fixture(),'http://prv-qualification.chasingmajors.com/'),q.ORIGIN);for(const x of ['https://app.chasingmajors.com/','https://prv-qualification.chasingmajors.com/?token=not-secret','https://prv-qualification.chasingmajors.com:444/','https://chasingmajors.github.io/chasing-majors-publication-qualification/'])assert.throws(()=>q.deploymentOrigin(fixture(),x));});
test('CNAME is changed only in supplied isolated source, before assembly',()=>{const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'cm-cname-'));try{q.writeCname(tmp,fixture());assert.equal(fs.readFileSync(path.join(tmp,'CNAME'),'utf8'),'prv-qualification.chasingmajors.com\n');}finally{fs.rmSync(tmp,{recursive:true,force:true});}});
test('CNAME symlink rejected',()=>{const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'cm-cname-'));try{fs.symlinkSync('/etc/hosts',path.join(tmp,'CNAME'));assert.throws(()=>q.writeCname(tmp,fixture()),/symlink/);}finally{fs.rmSync(tmp,{recursive:true,force:true});}});
const response=(body,headers={server:'cloudflare','cf-ray':'fixture-only-ray'},status=200)=>({status,redirected:false,headers:new Headers(headers),arrayBuffer:async()=>Buffer.from(JSON.stringify(body))});
test('mock edge observation binds release and omits credentials, never claims live qualification',async()=>{
 const sha='b'.repeat(40);let request;
 const result=await q.edgeEvidence(fixture(),sha,{fetchImpl:async(url,options)=>{request={url,options};return response({release_sha:sha});}});
 assert.equal(result.release_sha,sha);assert.equal(request.options.credentials,'omit');assert.equal(request.options.redirect,'manual');assert.equal(request.options.headers,undefined);assert.match(request.url,/^https:\/\/prv-qualification\.chasingmajors\.com\//);
});
for(const [name,res]of [['wrong release',response({release_sha:'c'.repeat(40)})],['redirect',response({},undefined,302)],['not Cloudflare',response({release_sha:'b'.repeat(40)},{server:'GitHub.com'})]])test('reject mock '+name,async()=>assert.rejects(q.edgeEvidence(fixture(),'b'.repeat(40),{fetchImpl:async()=>res})));
test('case file accepts only fixed isolated probes, no command strings',()=>{const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'cm-probe-'));try{fs.mkdirSync(path.join(tmp,'data'));const p=path.join(tmp,'data/qualification-case.json');for(const mode of ['normal','validation-failure-probe','postdeploy-failure-probe']){fs.writeFileSync(p,JSON.stringify({schema_version:1,environment:'isolated-publication-qualification',mode}));assert.equal(q.probeMode(tmp),mode);}fs.writeFileSync(p,JSON.stringify({schema_version:1,environment:'isolated-publication-qualification',mode:'curl secret'}));assert.throws(()=>q.probeMode(tmp));}finally{fs.rmSync(tmp,{recursive:true,force:true});}});
test('candidate preserves the complete shared release topology and least permissions',()=>{
 const yaml=fs.readFileSync(path.join(__dirname,'../.github/workflows/vault-data.yml'),'utf8');
 for(const command of ['scripts/ensure-release-history.cjs','scripts/build-content-release.cjs','scripts/search-query/reuse.cjs key','scripts/search-query/reuse.cjs run','scripts/search-query/reuse.cjs save','node --test tests/*.test.cjs','scripts/content-release.cjs validate','scripts/content-release.cjs assemble','scripts/content-release.cjs verify','actions/upload-pages-artifact@v4','actions/deploy-pages@v4','persist-credentials: false','node-version: \'24.22.1\''])assert.ok(yaml.includes(command),command);
 assert.ok(yaml.indexOf('qualification-target.cjs cname')<yaml.indexOf('scripts/content-release.cjs assemble'));assert.ok(yaml.indexOf('qualification-target.cjs edge')<yaml.indexOf('Injected isolated post-deployment failure'));
 assert.doesNotMatch(yaml,/contents: write|actions: write|secrets\.CF|CLOUDFLARE_API_TOKEN|schedule:/);assert.match(yaml,/pages: write/);assert.match(yaml,/id-token: write/);
});

test('actual verifier sparse checkout executes normal and rollback probe modes; missing case fails closed',()=>{
 const root=path.resolve(__dirname,'..'),workflow=fs.readFileSync(path.join(root,'.github/workflows/vault-data.yml'),'utf8');
 const verify=workflow.split('\n  verify:')[1],block=verify.match(/sparse-checkout: *\|\n((?: {12}[^\n]+\n)+)/);assert.ok(block,'verifier sparse checkout');
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'cm-verifier-closure-'));
 try{
  for(const line of block[1].trim().split('\n')){const rel=line.trim().replace(/^\//,'');const target=path.join(tmp,rel);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,rel),target);}
  const caseFile=path.join(tmp,'data/qualification-case.json');assert.ok(fs.existsSync(caseFile),'case file must be in SHA-pinned verifier checkout');
  fs.writeFileSync(path.join(tmp,'.qualification/target.json'),JSON.stringify(fixture()));
  const command=()=>cp.execFileSync(process.execPath,[path.join(tmp,'scripts/qualification-target.cjs'),'probe'],{cwd:tmp,env:{...process.env,...ctx()},encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  for(const mode of ['normal','postdeploy-failure-probe']){fs.writeFileSync(caseFile,JSON.stringify({schema_version:1,environment:'isolated-publication-qualification',mode}));assert.equal(command(),mode);}
  fs.unlinkSync(caseFile);assert.throws(command,/qualification-case/);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
