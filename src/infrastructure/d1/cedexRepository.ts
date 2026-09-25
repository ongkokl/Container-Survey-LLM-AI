export interface ComponentCandidate {component_code:string;component_name:string;standard_version:string;}

export class CedexRepository {
  constructor(private readonly db:D1Database){}

  async equipmentForFinding(findingId:string):Promise<"GP"|"RF">{
    const row=await this.db.prepare(`
      SELECT gc.observed_container_type AS equipment
      FROM findings f
      JOIN surveys s ON s.id=f.survey_id
      JOIN gate_cycles gc ON gc.id=s.gate_cycle_id
      WHERE f.id=?`).bind(findingId).first<{equipment:string}>();
    if(!row||!["GP","RF"].includes(row.equipment)) throw new Error("Unable to determine GP/RF equipment type.");
    return row.equipment as "GP"|"RF";
  }

  async components(equipment:"GP"|"RF"):Promise<ComponentCandidate[]>{
    const result=await this.db.prepare(`
      SELECT component_code,component_name,standard_version
      FROM component_codes c
      WHERE c.equipment_type=? AND c.active=1
        AND NOT EXISTS (
          SELECT 1 FROM component_codes newer
          WHERE newer.equipment_type=c.equipment_type
            AND newer.component_code=c.component_code
            AND newer.active=1
            AND COALESCE(newer.effective_from,'0000-00-00') > COALESCE(c.effective_from,'0000-00-00')
        )
      ORDER BY component_code`).bind(equipment).all<ComponentCandidate>();
    return result.results;
  }

  async findingPhoto(findingId:string,role:"FACE_OVERVIEW"|"DAMAGE_CLOSEUP"){
    return this.db.prepare(`
      SELECT id,r2_key,content_type FROM survey_photos
      WHERE finding_id=? AND photo_role=? ORDER BY created_at DESC LIMIT 1`
    ).bind(findingId,role).first<{id:string;r2_key:string;content_type:string}>();
  }

  async findingContext(findingId:string){
    return this.db.prepare(`
      SELECT f.id,f.survey_id,f.container_face,gc.observed_container_type AS equipment_type,
             gc.observed_length_ft AS length_ft
      FROM findings f JOIN surveys s ON s.id=f.survey_id
      JOIN gate_cycles gc ON gc.id=s.gate_cycle_id WHERE f.id=?`
    ).bind(findingId).first<{id:string;survey_id:string;container_face:string;equipment_type:string;length_ft:number}>();
  }

  async saveComponentPrediction(input:{findingId:string;surveyId:string;modelName:string;selectedCode:string|null;confidence:number|null;candidates:Array<{code:string;confidence:number|null;reason?:string}>;response:unknown;}){
    const now=new Date().toISOString(),runId=crypto.randomUUID(),predictionId=crypto.randomUUID();
    await this.db.batch([
      this.db.prepare("INSERT INTO ai_runs (id,survey_id,finding_id,task_type,request_context_json,response_json,started_at,completed_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(runId,input.surveyId,input.findingId,"COMPONENT_CLASSIFICATION",JSON.stringify({model:input.modelName}),JSON.stringify(input.response),now,now),
      this.db.prepare("INSERT INTO ai_predictions (id,ai_run_id,prediction_type,selected_code,confidence,status,created_at) VALUES (?,?, 'COMPONENT',?,?, 'SUGGESTED',?)")
        .bind(predictionId,runId,input.selectedCode,input.confidence,now),
      this.db.prepare("UPDATE findings SET status='AI_SUGGESTED',updated_at=? WHERE id=?").bind(now,input.findingId)
    ]);
    for(let i=0;i<input.candidates.length;i++){
      const c=input.candidates[i];
      await this.db.prepare("INSERT INTO prediction_candidates (id,prediction_id,candidate_code,rank,confidence,evidence_json) VALUES (?,?,?,?,?,?)")
        .bind(crypto.randomUUID(),predictionId,c.code,i+1,c.confidence,JSON.stringify({reason:c.reason??null})).run();
    }
    return {predictionId};
  }
}
