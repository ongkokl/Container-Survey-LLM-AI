import { describe, expect, it } from "vitest";
import { CedexRepository } from "../../src/infrastructure/d1/cedexRepository";

type AiRun = { id:string; survey_id:string; finding_id:string; task_type:string };
type Prediction = { id:string; ai_run_id:string; selected_code:string|null; confidence:number|null; status:string; created_at:string };
type Decision = { finding_id:string; prediction_id:string; ai_value:string|null; final_value:string; decision:string };

class FakeStatement {
  private args: unknown[] = [];
  constructor(private readonly db: FakeD1, private readonly sql: string) {}
  bind(...args: unknown[]) { this.args = args; return this; }

  async first<T>(): Promise<T|null> {
    if (this.sql.includes("SELECT final_component_code FROM findings")) {
      return { final_component_code: this.db.finding.final_component_code } as T;
    }
    if (this.sql.includes("SELECT ap.id AS prediction_id,ap.selected_code FROM ai_predictions")) {
      const findingId = String(this.args[0]);
      const runIds = this.db.aiRuns.filter(x=>x.finding_id===findingId).map(x=>x.id);
      const p = [...this.db.predictions].reverse().find(x=>runIds.includes(x.ai_run_id));
      return (p ? { prediction_id:p.id, selected_code:p.selected_code } : null) as T|null;
    }
    return null;
  }

  async all<T>(): Promise<{results:T[]}> {
    if (this.sql.includes("FROM component_damage_rules r")) {
      const componentCode = String(this.args[1]);
      const results = componentCode===this.db.finding.final_component_code
        ? this.db.allowedDamages.map(x=>({damage_code:x.code,damage_name:x.name}) as T)
        : [];
      return {results};
    }
    return {results:[]};
  }

  async run() {
    const sql=this.sql;
    if (sql.includes("INSERT INTO ai_runs")) {
      const [id,surveyId,findingId,taskType] = this.args;
      this.db.aiRuns.push({id:String(id),survey_id:String(surveyId),finding_id:String(findingId),task_type:String(taskType)});
    } else if (sql.includes("INSERT INTO ai_predictions")) {
      const [id,runId,selectedCode,confidence,createdAt] = this.args;
      this.db.predictions.push({
        id:String(id), ai_run_id:String(runId),
        selected_code:selectedCode===null?null:String(selectedCode),
        confidence:confidence===null?null:Number(confidence),
        status:"SUGGESTED", created_at:String(createdAt)
      });
    } else if (sql.includes("INSERT INTO prediction_candidates")) {
      this.db.candidateCount++;
    } else if (sql.includes("UPDATE findings SET status='REVIEW_REQUIRED'")) {
      this.db.finding.status="REVIEW_REQUIRED";
    } else if (sql.includes("INSERT INTO surveyor_decisions")) {
      const [,findingId,predictionId,aiValue,finalValue,decision] = this.args;
      this.db.decisions.push({
        finding_id:String(findingId),
        prediction_id:String(predictionId),
        ai_value:aiValue===null?null:String(aiValue),
        final_value:String(finalValue),
        decision:String(decision)
      });
    } else if (sql.includes("UPDATE ai_predictions SET status=?")) {
      const [status,predictionId]=this.args;
      const p=this.db.predictions.find(x=>x.id===String(predictionId));
      if (p) p.status=String(status);
    } else if (sql.includes("UPDATE findings SET final_damage_code=?")) {
      const [code,status]=this.args;
      this.db.finding.final_damage_code=String(code);
      this.db.finding.status=String(status);
    }
    return {success:true};
  }
}

class FakeD1 {
  finding={final_component_code:"PAA",final_damage_code:null as string|null,status:"APPROVED"};
  allowedDamages=[
    {code:"DT",name:"Dent / Bent"},
    {code:"GD",name:"Gouged / Scratched"}
  ];
  aiRuns:AiRun[]=[];
  predictions:Prediction[]=[];
  decisions:Decision[]=[];
  candidateCount=0;

  prepare(sql:string){return new FakeStatement(this,sql);}
  async batch(statements:FakeStatement[]){
    const out=[];
    for(const s of statements) out.push(await s.run());
    return out;
  }
}

function repositoryWithFakeDb(){
  const db=new FakeD1();
  const repo=new CedexRepository(db as unknown as D1Database);
  return {db,repo};
}

describe("damage decision integration",()=>{
  it("persists a suggested damage and moves the finding back to review",async()=>{
    const {db,repo}=repositoryWithFakeDb();

    await repo.saveDamagePrediction({
      findingId:"finding-1",
      surveyId:"survey-1",
      modelName:"mock-qwen",
      selectedCode:"DT",
      confidence:0.92,
      candidates:[
        {code:"DT",confidence:0.92},
        {code:"GD",confidence:0.06}
      ],
      response:{mock:true}
    });

    expect(db.predictions).toHaveLength(1);
    expect(db.predictions[0]).toMatchObject({selected_code:"DT",confidence:0.92,status:"SUGGESTED"});
    expect(db.candidateCount).toBe(2);
    expect(db.finding.status).toBe("REVIEW_REQUIRED");
  });

  it("records APPROVED when the surveyor accepts the AI damage code",async()=>{
    const {db,repo}=repositoryWithFakeDb();

    await repo.saveDamagePrediction({
      findingId:"finding-1",surveyId:"survey-1",modelName:"mock-qwen",
      selectedCode:"DT",confidence:0.92,candidates:[{code:"DT",confidence:0.92}],response:{mock:true}
    });
    const result=await repo.decideDamage({findingId:"finding-1",finalCode:"DT"});

    expect(result.decision).toBe("APPROVED");
    expect(result.aiCode).toBe("DT");
    expect(result.finalCode).toBe("DT");
    expect(db.decisions[0]).toMatchObject({ai_value:"DT",final_value:"DT",decision:"APPROVED"});
    expect(db.predictions[0].status).toBe("APPROVED");
    expect(db.finding.final_damage_code).toBe("DT");
    expect(db.finding.status).toBe("APPROVED");
  });

  it("preserves the AI value and records CORRECTED when surveyor changes DT to GD",async()=>{
    const {db,repo}=repositoryWithFakeDb();

    await repo.saveDamagePrediction({
      findingId:"finding-1",surveyId:"survey-1",modelName:"mock-qwen",
      selectedCode:"DT",confidence:0.88,candidates:[{code:"DT",confidence:0.88},{code:"GD",confidence:0.10}],response:{mock:true}
    });
    const result=await repo.decideDamage({findingId:"finding-1",finalCode:"gd"});

    expect(result.decision).toBe("CORRECTED");
    expect(result.aiCode).toBe("DT");
    expect(result.finalCode).toBe("GD");
    expect(db.decisions[0]).toMatchObject({ai_value:"DT",final_value:"GD",decision:"CORRECTED"});
    expect(db.predictions[0].selected_code).toBe("DT");
    expect(db.predictions[0].status).toBe("CORRECTED");
    expect(db.finding.final_damage_code).toBe("GD");
    expect(db.finding.status).toBe("CORRECTED");
  });

  it("allows a surveyor correction after an AI abstention",async()=>{
    const {db,repo}=repositoryWithFakeDb();

    await repo.saveDamagePrediction({
      findingId:"finding-1",surveyId:"survey-1",modelName:"mock-qwen",
      selectedCode:null,confidence:null,candidates:[],response:{mock:true}
    });
    const result=await repo.decideDamage({findingId:"finding-1",finalCode:"DT"});

    expect(result.decision).toBe("CORRECTED");
    expect(result.aiCode).toBeNull();
    expect(db.decisions[0]).toMatchObject({ai_value:null,final_value:"DT",decision:"CORRECTED"});
    expect(db.finding.final_damage_code).toBe("DT");
  });

  it("rejects a surveyor code that is not valid for the confirmed component",async()=>{
    const {db,repo}=repositoryWithFakeDb();

    await repo.saveDamagePrediction({
      findingId:"finding-1",surveyId:"survey-1",modelName:"mock-qwen",
      selectedCode:"DT",confidence:0.90,candidates:[{code:"DT",confidence:0.90}],response:{mock:true}
    });

    await expect(repo.decideDamage({findingId:"finding-1",finalCode:"ZZ"}))
      .rejects.toThrow("Select a valid damage code for the confirmed component.");

    expect(db.decisions).toHaveLength(0);
    expect(db.finding.final_damage_code).toBeNull();
  });
});
