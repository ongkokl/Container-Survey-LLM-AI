import { execFileSync } from "node:child_process";

const DB="container-survey-db";
const wrangler=(args)=>execFileSync(process.platform==="win32"?"npx.cmd":"npx",["wrangler",...args],{encoding:"utf8",stdio:["ignore","pipe","pipe"]});
const sql=(statement)=>{
  const out=wrangler(["d1","execute",DB,"--local","--json","--command",statement]);
  return JSON.parse(out);
};
const q=(s)=>String(s).replaceAll("'","''");
const id=(prefix)=>prefix+"-"+Date.now()+"-"+Math.random().toString(16).slice(2);

console.log("Applying migrations to local D1...");
wrangler(["d1","migrations","apply",DB,"--local"]);

const gate=id("gate"), survey=id("survey"), finding=id("finding"), run=id("run"), prediction=id("prediction"), decision=id("decision");
const now=new Date().toISOString();

console.log("Seeding isolated GP/PAA damage-flow fixture...");
sql(`
INSERT INTO gate_cycles (id,container_number,gate_in_at,status,observed_container_type,created_at,updated_at)
VALUES ('${q(gate)}','TEST0000000','${now}','ACTIVE','GP','${now}','${now}');
INSERT INTO surveys (id,gate_cycle_id,status,started_at,created_at,updated_at)
VALUES ('${q(survey)}','${q(gate)}','IN_PROGRESS','${now}','${now}','${now}');
INSERT INTO findings (id,survey_id,finding_sequence,status,container_face,final_component_code,created_at,updated_at)
VALUES ('${q(finding)}','${q(survey)}',1,'REVIEW_REQUIRED','RIGHT','PAA','${now}','${now}');
`);

const rules=sql(`
SELECT d.damage_code,d.damage_name
FROM component_damage_rules r
JOIN damage_codes d ON d.damage_code=r.damage_code AND d.active=1
WHERE r.equipment_type='GP' AND r.component_code='PAA' AND r.active=1
ORDER BY d.damage_code;
`);
const rows=rules?.[0]?.results??[];
if(!rows.some(x=>x.damage_code==="DT")) throw new Error("Expected GP/PAA rule DT was not found in local D1.");
if(rows.some(x=>x.damage_code==="ZZ")) throw new Error("Invalid ZZ unexpectedly exists in GP/PAA rules.");
console.log(`✓ GP/PAA rules loaded from real D1 (${rows.length} valid damage codes; DT present)`);

sql(`
INSERT INTO ai_runs (id,survey_id,finding_id,task_type,model_name,request_context_json,response_json,started_at,completed_at,created_at)
VALUES ('${q(run)}','${q(survey)}','${q(finding)}','DAMAGE_CLASSIFICATION','mock-qwen','{}','{}','${now}','${now}','${now}');
INSERT INTO ai_predictions (id,ai_run_id,prediction_type,selected_code,confidence,status,created_at)
VALUES ('${q(prediction)}','${q(run)}','DAMAGE','DT',0.92,'SUGGESTED','${now}');
INSERT INTO prediction_candidates (id,prediction_id,candidate_code,rank,confidence,created_at)
VALUES ('${id("candidate")}','${q(prediction)}','DT',1,0.92,'${now}');
UPDATE findings SET status='REVIEW_REQUIRED',updated_at='${now}' WHERE id='${q(finding)}';
`);

let state=sql(`
SELECT f.status,f.final_component_code,f.final_damage_code,p.selected_code,p.status AS prediction_status
FROM findings f
JOIN ai_runs r ON r.finding_id=f.id
JOIN ai_predictions p ON p.ai_run_id=r.id AND p.prediction_type='DAMAGE'
WHERE f.id='${q(finding)}';
`)?.[0]?.results?.[0];
if(state?.status!=="REVIEW_REQUIRED"||state?.selected_code!=="DT"||state?.final_damage_code!==null)
  throw new Error("Unexpected state after damage suggestion: "+JSON.stringify(state));
console.log("✓ AI DT prediction persisted; finding remains REVIEW_REQUIRED; final damage is still null");

sql(`
INSERT INTO surveyor_decisions (id,finding_id,prediction_id,decision_type,ai_value,final_value,decision,decided_at,created_at)
VALUES ('${q(decision)}','${q(finding)}','${q(prediction)}','DAMAGE','DT','GD','CORRECTED','${now}','${now}');
UPDATE ai_predictions SET status='CORRECTED' WHERE id='${q(prediction)}';
UPDATE findings SET final_damage_code='GD',status='CORRECTED',updated_at='${now}' WHERE id='${q(finding)}';
`);

state=sql(`
SELECT f.status,f.final_damage_code,p.selected_code,p.status AS prediction_status,
       sd.ai_value,sd.final_value,sd.decision
FROM findings f
JOIN ai_runs r ON r.finding_id=f.id
JOIN ai_predictions p ON p.ai_run_id=r.id AND p.prediction_type='DAMAGE'
JOIN surveyor_decisions sd ON sd.prediction_id=p.id AND sd.decision_type='DAMAGE'
WHERE f.id='${q(finding)}';
`)?.[0]?.results?.[0];

if(state?.selected_code!=="DT"||state?.final_damage_code!=="GD"||state?.ai_value!=="DT"||state?.final_value!=="GD"||state?.decision!=="CORRECTED"||state?.status!=="CORRECTED")
  throw new Error("Unexpected final decision state: "+JSON.stringify(state));

console.log("✓ Surveyor correction persisted: AI=DT, final=GD, decision=CORRECTED");
console.log("PASS: real local D1 damage persistence and component-rule joins are working.");
