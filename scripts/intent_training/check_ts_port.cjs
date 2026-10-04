// Checks lib/intentModel.ts against golden.json written by train_intent.py.
const fs=require('fs'), path=require('path'), os=require('os');
const ROOT=path.join(__dirname,'..','..'); const ts=require(path.join(ROOT,'node_modules','typescript'));
let src=fs.readFileSync(path.join(ROOT,'lib','intentModel.ts'),'utf8').replace("'../assets/intent_model.json'",JSON.stringify(path.join(ROOT,'assets','intent_model.json')));
const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true,resolveJsonModule:true}}).outputText;
const f=path.join(os.tmpdir(),'agrios_intentModel.cjs'); fs.writeFileSync(f,js); const M=require(f);
const golden=JSON.parse(fs.readFileSync(path.join(__dirname,'golden.json'),'utf8'));
let featOk=0, maxDiff=0;
for (const g of golden){ const fts=M.features(g.text); if(JSON.stringify(fts)===JSON.stringify(g.features)) featOk++; const p=M.predictProbs(g.text); p.forEach((x,i)=>maxDiff=Math.max(maxDiff,Math.abs(x-g.probs[i]))); }
console.log(`features identical: ${featOk}/${golden.length}, max prob diff: ${maxDiff.toExponential(2)}`);
if (featOk !== golden.length || maxDiff > 1e-4) { console.error('MISMATCH'); process.exit(1); }
