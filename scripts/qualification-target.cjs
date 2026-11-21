'use strict';
// New isolated route only. Never accepts the production repository or hostname.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const REPOSITORY='ChasingMajors/chasing-majors-publication-qualification';
const ORIGIN='https://prv-qualification.chasingmajors.com/';
function validate(policy,env=process.env){
 if(!policy||policy.schema_version!==1||policy.environment!=='isolated-publication-qualification'||policy.production_writes_enabled!==false)throw Error('Invalid isolated publication policy');
 if(policy.repository!==REPOSITORY||policy.branch!=='main'||policy.origin!==ORIGIN)throw Error('Unapproved repository, branch or origin');
 if(policy.qualified_resource_setup!==true||!Number.isSafeInteger(policy.repository_id)||policy.repository_id<1||!(/^[a-f0-9]{64}$/.test(policy.setup_evidence_sha256||'')))throw Error('Isolated resource bootstrap not qualified');
 if(env.GITHUB_REPOSITORY!==REPOSITORY||String(policy.repository_id)!==env.GITHUB_REPOSITORY_ID||env.GITHUB_REF!=='refs/heads/main')throw Error('Runtime repository identity mismatch');
 return policy;
}
function deploymentOrigin(policy,pageUrl){
 let u;try{u=new URL(pageUrl);}catch{throw Error('Invalid Pages deployment metadata');}
 // Like production-verification-url.cjs: GitHub may report HTTP in deployment
 // metadata. Never request it; readback is always the fixed HTTPS origin.
 if(policy.origin!==ORIGIN||!['http:','https:'].includes(u.protocol)||u.hostname!=='prv-qualification.chasingmajors.com'||u.port||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Pages deployment does not identify the isolated Cloudflare custom origin');
 return ORIGIN;
}
function writeCname(root,policy){
 const target=path.resolve(root,'CNAME');if(fs.existsSync(target)&&fs.lstatSync(target).isSymbolicLink())throw Error('CNAME symlink rejected');
 fs.writeFileSync(target,new URL(policy.origin).hostname+'\n');return target;
}
function probeMode(root){
 const p=JSON.parse(fs.readFileSync(path.join(root,'data/qualification-case.json')));
 if(Object.keys(p).sort().join(',')!=='environment,mode,schema_version'||p.schema_version!==1||p.environment!=='isolated-publication-qualification'||!['normal','validation-failure-probe','postdeploy-failure-probe'].includes(p.mode))throw Error('Invalid isolated failure-probe case');
 return p.mode;
}
async function edgeEvidence(policy,releaseSha,{fetchImpl=fetch}={}){
 if(!/^[a-f0-9]{40}$/.test(releaseSha))throw Error('Immutable release identity required');
 const url=policy.origin+'data/publish-release.json?qualification='+releaseSha+'&probe='+Date.now();
 const response=await fetchImpl(url,{redirect:'manual',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(response.status!==200||response.redirected)throw Error('Isolated edge HTTP or redirect check failed');
 const server=response.headers.get('server'),ray=response.headers.get('cf-ray');
 if(server?.toLowerCase()!=='cloudflare'||!ray||ray.length>100)throw Error('Cloudflare edge evidence missing');
 const body=Buffer.from(await response.arrayBuffer());if(body.length>8*1024*1024)throw Error('Manifest budget exceeded');
 const manifest=JSON.parse(body.toString('utf8'));if(manifest.release_sha!==releaseSha)throw Error('Edge serves another release');
 return {origin:policy.origin,http_status:200,server,cf_ray:ray,cache_status:response.headers.get('cf-cache-status'),release_sha:releaseSha,manifest_sha256:crypto.createHash('sha256').update(body).digest('hex'),proves:'public Cloudflare-edge traversal and release identity; full manifest/content checks run separately'};
}
module.exports={validate,deploymentOrigin,writeCname,probeMode,edgeEvidence,REPOSITORY,ORIGIN};
if(require.main===module)(async()=>{
 try{
  const [mode,...args]=process.argv.slice(2),root=path.resolve(__dirname,'..'),policy=validate(JSON.parse(fs.readFileSync(path.join(root,'.qualification/target.json'))));
  if(mode==='check')console.log(JSON.stringify({result:'PASS',repository:policy.repository,origin:policy.origin,production_writes_enabled:false}));
  else if(mode==='origin')console.log(deploymentOrigin(policy,args[0]));
  else if(mode==='cname')writeCname(root,policy);
  else if(mode==='probe')console.log(probeMode(root));
  else if(mode==='edge'){
   const receipt=await edgeEvidence(policy,process.env.GITHUB_SHA);fs.writeFileSync(args[0],JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
  }else throw Error('Unknown qualification command');
 }catch(e){console.error(e.message);process.exitCode=1;}
})();
