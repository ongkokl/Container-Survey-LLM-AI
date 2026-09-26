export interface ComponentCandidate {component_code:string;component_name:string;standard_version:string;}
export interface ComponentVisualRule {
  component_code:string;
  container_face:string;
  overview_zone:string;
  visual_definition:string;
  positive_cues:string|null;
  negative_cues:string|null;
  confusable_with:string|null;
  force_review:number;
  source_reference:string;
}
export interface DamageVisualRule {
  damage_code:string;
  component_code:string;
  visual_definition:string;
  positive_cues:string|null;
  negative_cues:string|null;
  confusable_with:string|null;
  evidence_requirement:"VISUAL"|"VISUAL_CONTEXT"|"MEASUREMENT"|"HISTORY_CONTEXT";
  force_review:number;
  source_reference:string;
}

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

  async components(equipment:"GP"|"RF",containerFace?:string|null):Promise<ComponentCandidate[]>{
    const face=containerFace?.trim().toUpperCase()||null;
    const result=await this.db.prepare(`
      WITH ranked AS (
        SELECT c.equipment_type,c.component_code,c.component_name,c.standard_version,
               ROW_NUMBER() OVER (
                 PARTITION BY c.equipment_type,c.component_code
                 ORDER BY COALESCE(c.effective_from,'0000-00-00') DESC,
                          c.standard_version DESC,
                          c.rowid DESC
               ) AS rn
        FROM component_codes c
        WHERE c.equipment_type=? AND c.active=1
      )
      SELECT c.component_code,c.component_name,c.standard_version
      FROM ranked c
      WHERE c.rn=1
        AND (
          ? IS NULL OR EXISTS (
            SELECT 1
            FROM component_face_rules f
            WHERE f.equipment_type=c.equipment_type
              AND f.component_code=c.component_code
              AND f.container_face=?
              AND f.active=1
          )
        )
      ORDER BY c.component_code`).bind(equipment,face,face).all<ComponentCandidate>();
    return result.results;
  }

  async componentVisualRules(equipment:"GP"|"RF",containerFace:string,overviewZone:string):Promise<ComponentVisualRule[]>{
    const face=containerFace.trim().toUpperCase(),zone=overviewZone.trim().toUpperCase();
    try{
      const result=await this.db.prepare(`
        WITH matching AS (
          SELECT component_code,container_face,overview_zone,visual_definition,
                 positive_cues,negative_cues,confusable_with,force_review,
                 source_reference,priority,
                 CASE WHEN container_face=? THEN 0 ELSE 1 END AS face_rank,
                 CASE WHEN overview_zone=? THEN 0 ELSE 1 END AS zone_rank
          FROM component_visual_rules
          WHERE equipment_type=? AND active=1
            AND container_face IN (?,'ANY')
            AND overview_zone IN (?,'ANY')
        )
        SELECT component_code,container_face,overview_zone,visual_definition,
               positive_cues,negative_cues,confusable_with,force_review,source_reference
        FROM matching
        ORDER BY component_code,face_rank,zone_rank,priority DESC`
      ).bind(face,zone,equipment,face,zone).all<ComponentVisualRule>();
      return result.results;
    }catch(error){
      // Keep component classification available during a staged deploy before
      // migration 0009 is applied. Other query failures still surface.
      if(error instanceof Error && /no such table.*component_visual_rules/i.test(error.message)) return [];
      throw error;
    }
  }

  async damageVisualRules(equipment:"GP"|"RF",componentCode:string):Promise<DamageVisualRule[]>{
    const component=componentCode.trim().toUpperCase();
    try{
      const result=await this.db.prepare(`
        SELECT damage_code,component_code,visual_definition,positive_cues,negative_cues,
               confusable_with,evidence_requirement,force_review,source_reference
        FROM damage_visual_rules
        WHERE equipment_type=? AND active=1 AND component_code IN (?,'ANY')
        ORDER BY damage_code,
                 CASE WHEN component_code=? THEN 0 ELSE 1 END,
                 priority DESC`
      ).bind(equipment,component,component).all<DamageVisualRule>();
      return result.results;
    }catch(error){
      // Allow staged deployment before migration 0010 is applied.
      if(error instanceof Error && /no such table.*damage_visual_rules/i.test(error.message)) return [];
      throw error;
    }
  }

  async repairCodesForFinding(findingId:string){
    const row=await this.db.prepare(`
      SELECT f.final_component_code,f.final_damage_code,gc.observed_container_type AS equipment
      FROM findings f
      JOIN surveys s ON s.id=f.survey_id
      JOIN gate_cycles gc ON gc.id=s.gate_cycle_id
      WHERE f.id=?`
    ).bind(findingId).first<{final_component_code:string|null;final_damage_code:string|null;equipment:string}>();
    if(!row?.final_component_code) throw new Error("Confirm the component before analysing repair.");
    if(!row.final_damage_code) throw new Error("Confirm the damage before analysing repair.");
    if(!["GP","RF"].includes(row.equipment)) throw new Error("Unable to determine GP/RF equipment type.");
    const equipment=row.equipment as "GP"|"RF";
    const result=await this.db.prepare(`
      WITH ranked AS (
        SELECT r.repair_code,r.repair_name,r.description,r.standard_version,
               ROW_NUMBER() OVER (
                 PARTITION BY r.repair_code
                 ORDER BY r.standard_version DESC,r.rowid DESC
               ) AS rn
        FROM repair_codes r
        WHERE r.active=1
      )
      SELECT cr.repair_code,r.repair_name,r.description,r.standard_version
      FROM component_repair_rules cr
      JOIN ranked r ON r.repair_code=cr.repair_code AND r.rn=1
      WHERE cr.equipment_type=? AND cr.component_code=? AND cr.active=1
      ORDER BY cr.repair_code`
    ).bind(equipment,row.final_component_code).all<{repair_code:string;repair_name:string;description:string|null;standard_version:string}>();
    return {
      equipment,
      componentCode:row.final_component_code,
      damageCode:row.final_damage_code,
      repairs:result.results
    };
  }

  async findingPhoto(findingId:string,role:"FACE_OVERVIEW"|"DAMAGE_CLOSEUP"){
    return this.db.prepare(`
      SELECT id,r2_key,content_type FROM survey_photos
      WHERE finding_id=? AND photo_role=? ORDER BY created_at DESC LIMIT 1`
    ).bind(findingId,role).first<{id:string;r2_key:string;content_type:string}>();
  }

  async surveyorLocationPoint(findingId:string,photoId?:string){
    const row=await this.db.prepare(`
      SELECT a.geometry_json
      FROM annotations a
      JOIN survey_photos p ON p.id=a.photo_id
      WHERE p.finding_id=? AND p.photo_role='FACE_OVERVIEW' AND (? IS NULL OR p.id=?)
        AND a.annotation_type='LOCATION_POINT' AND a.geometry_type='POINT' AND a.created_by='SURVEYOR'
      ORDER BY a.created_at DESC LIMIT 1`
    ).bind(findingId,photoId??null,photoId??null).first<{geometry_json:string}>();
    if(!row)return null;
    try{
      const g=JSON.parse(row.geometry_json) as {x?:number;y?:number};
      if(typeof g.x!=="number"||typeof g.y!=="number")return null;
      if([g.x,g.y].every(Number.isFinite)&&g.x>=0&&g.x<=1&&g.y>=0&&g.y<=1)return {x:g.x,y:g.y};
    }catch{}
    return null;
  }

  async findingContext(findingId:string){
    return this.db.prepare(`
      SELECT f.id,f.survey_id,f.container_face,gc.observed_container_type AS equipment_type,
             gc.observed_length_ft AS length_ft
      FROM findings f JOIN surveys s ON s.id=f.survey_id
      JOIN gate_cycles gc ON gc.id=s.gate_cycle_id WHERE f.id=?`
    ).bind(findingId).first<{id:string;survey_id:string;container_face:string;equipment_type:string;length_ft:number}>();
  }

  async saveComponentPrediction(input:{findingId:string;surveyId:string;modelName:string;selectedCode:string|null;confidence:number|null;candidates:Array<{code:string;confidence:number|null;reason?:string}>;response:unknown;status?:"SUGGESTED"|"REVIEW_REQUIRED"|"FAILED";requestContext?:Record<string,unknown>;}){
    const now=new Date().toISOString(),runId=crypto.randomUUID(),predictionId=crypto.randomUUID();
    await this.db.batch([
      this.db.prepare("INSERT INTO ai_runs (id,survey_id,finding_id,task_type,request_context_json,response_json,started_at,completed_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(runId,input.surveyId,input.findingId,"COMPONENT_CLASSIFICATION",JSON.stringify({model:input.modelName,...input.requestContext}),JSON.stringify(input.response),now,now),
      this.db.prepare("INSERT INTO ai_predictions (id,ai_run_id,prediction_type,selected_code,confidence,status,created_at) VALUES (?,?, 'COMPONENT',?,?,?,?)")
        .bind(predictionId,runId,input.selectedCode,input.confidence,input.status??"SUGGESTED",now),
      this.db.prepare("UPDATE findings SET status=?,updated_at=? WHERE id=?")
        .bind(input.status && input.status!=="SUGGESTED"?"REVIEW_REQUIRED":"AI_SUGGESTED",now,input.findingId)
    ]);
    for(let i=0;i<input.candidates.length;i++){
      const c=input.candidates[i];
      await this.db.prepare("INSERT INTO prediction_candidates (id,prediction_id,candidate_code,rank,confidence,evidence_json) VALUES (?,?,?,?,?,?)")
        .bind(crypto.randomUUID(),predictionId,c.code,i+1,c.confidence,JSON.stringify({reason:c.reason??null})).run();
    }
    return {predictionId};
  }


  async damageCodesForFinding(findingId:string){
    const row=await this.db.prepare("SELECT final_component_code FROM findings WHERE id=?").bind(findingId).first<{final_component_code:string|null}>();
    if(!row?.final_component_code) throw new Error("Confirm the component before analysing damage.");
    const result=await this.db.prepare(`
      SELECT d.damage_code,d.damage_name
      FROM component_damage_rules r
      JOIN damage_codes d ON d.damage_code=r.damage_code AND d.active=1
      WHERE r.equipment_type=(SELECT gc.observed_container_type FROM findings f JOIN surveys s ON s.id=f.survey_id JOIN gate_cycles gc ON gc.id=s.gate_cycle_id WHERE f.id=?)
        AND r.component_code=? AND r.active=1
      ORDER BY d.damage_code`
    ).bind(findingId,row.final_component_code).all<{damage_code:string;damage_name:string}>();
    return {componentCode:row.final_component_code,damages:result.results};
  }


  async surveyorDamageBox(findingId:string,photoId?:string){
    const row=await this.db.prepare(`
      SELECT a.geometry_json
      FROM annotations a
      JOIN survey_photos p ON p.id=a.photo_id
      WHERE p.finding_id=? AND p.photo_role='DAMAGE_CLOSEUP' AND (? IS NULL OR p.id=?)
        AND a.annotation_type='DAMAGE' AND a.geometry_type='BOX' AND a.created_by='SURVEYOR'
      ORDER BY a.created_at DESC LIMIT 1`
    ).bind(findingId,photoId??null,photoId??null).first<{geometry_json:string}>();
    if(!row)return null;
    try{
      const g=JSON.parse(row.geometry_json) as {x?:number;y?:number;width?:number;height?:number};
      if(typeof g.x!=="number"||typeof g.y!=="number"||typeof g.width!=="number"||typeof g.height!=="number")return null;
      if([g.x,g.y,g.width,g.height].every(Number.isFinite) && g.x>=0 && g.y>=0 && g.width>0 && g.height>0 && g.x+g.width<=1.000001 && g.y+g.height<=1.000001)return {x:g.x,y:g.y,width:g.width,height:g.height};
    }catch{}
    return null;
  }

  async saveDamagePrediction(input:{findingId:string;surveyId:string;modelName:string;selectedCode:string|null;confidence:number|null;candidates:Array<{code:string;confidence:number|null;reason?:string}>;response:unknown;status?:"SUGGESTED"|"REVIEW_REQUIRED"|"FAILED";requestContext?:Record<string,unknown>;}){
    const now=new Date().toISOString(),runId=crypto.randomUUID(),predictionId=crypto.randomUUID();
    const predictionStatus=input.status??"SUGGESTED";
    await this.db.batch([
      this.db.prepare("INSERT INTO ai_runs (id,survey_id,finding_id,task_type,request_context_json,response_json,started_at,completed_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(runId,input.surveyId,input.findingId,"DAMAGE_CLASSIFICATION",JSON.stringify({model:input.modelName,...input.requestContext}),JSON.stringify(input.response),now,now),
      this.db.prepare("INSERT INTO ai_predictions (id,ai_run_id,prediction_type,selected_code,confidence,status,created_at) VALUES (?,?, 'DAMAGE',?,?,?,?)")
        .bind(predictionId,runId,input.selectedCode,input.confidence,predictionStatus,now),
      this.db.prepare("UPDATE findings SET status=?,updated_at=? WHERE id=?")
        .bind(predictionStatus==="SUGGESTED"?"AI_SUGGESTED":"REVIEW_REQUIRED",now,input.findingId)
    ]);
    for(let i=0;i<input.candidates.length;i++){
      const x=input.candidates[i];
      await this.db.prepare("INSERT INTO prediction_candidates (id,prediction_id,candidate_code,rank,confidence,evidence_json) VALUES (?,?,?,?,?,?)")
        .bind(crypto.randomUUID(),predictionId,x.code,i+1,x.confidence,JSON.stringify({reason:x.reason??null})).run();
    }
    return {predictionId};
  }

  async decideDamage(input:{findingId:string;finalCode:string;}){
    const allowed=await this.damageCodesForFinding(input.findingId),finalCode=input.finalCode.trim().toUpperCase();
    if(!allowed.damages.some(x=>x.damage_code===finalCode)) throw new Error("Select a valid damage code for the confirmed component.");
    const prediction=await this.db.prepare(`
      SELECT ap.id AS prediction_id,ap.selected_code FROM ai_predictions ap
      JOIN ai_runs ar ON ar.id=ap.ai_run_id WHERE ar.finding_id=? AND ap.prediction_type='DAMAGE'
      ORDER BY ap.created_at DESC LIMIT 1`).bind(input.findingId).first<{prediction_id:string;selected_code:string|null}>();
    if(!prediction) throw new Error("Analyse the damage before confirming it.");
    const decision=prediction.selected_code===finalCode?"APPROVED":"CORRECTED",now=new Date().toISOString(),decisionId=crypto.randomUUID();
    await this.db.batch([
      this.db.prepare("INSERT INTO surveyor_decisions (id,finding_id,prediction_id,field_type,ai_value,final_value,decision,created_at) VALUES (?,?,?,'DAMAGE',?,?,?,?)")
        .bind(decisionId,input.findingId,prediction.prediction_id,prediction.selected_code,finalCode,decision,now),
      this.db.prepare("UPDATE ai_predictions SET status=? WHERE id=?").bind(decision,prediction.prediction_id),
      this.db.prepare("UPDATE findings SET final_damage_code=?,status=?,updated_at=? WHERE id=?")
        .bind(finalCode,decision==="APPROVED"?"APPROVED":"CORRECTED",now,input.findingId)
    ]);
    return {decisionId,aiCode:prediction.selected_code,finalCode,decision,componentCode:allowed.componentCode};
  }


  async saveRepairPrediction(input:{findingId:string;surveyId:string;modelName:string;selectedCode:string|null;confidence:number|null;candidates:Array<{code:string;confidence:number|null;reason?:string}>;response:unknown;status?:"REVIEW_REQUIRED"|"FAILED";requestContext?:Record<string,unknown>;}){
    const now=new Date().toISOString(),runId=crypto.randomUUID(),predictionId=crypto.randomUUID();
    const predictionStatus=input.status??"REVIEW_REQUIRED";
    await this.db.batch([
      this.db.prepare("INSERT INTO ai_runs (id,survey_id,finding_id,task_type,request_context_json,response_json,started_at,completed_at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(runId,input.surveyId,input.findingId,"REPAIR_RECOMMENDATION",JSON.stringify({model:input.modelName,...input.requestContext}),JSON.stringify(input.response),now,now),
      this.db.prepare("INSERT INTO ai_predictions (id,ai_run_id,prediction_type,selected_code,confidence,status,created_at) VALUES (?,?, 'REPAIR',?,?,?,?)")
        .bind(predictionId,runId,input.selectedCode,input.confidence,predictionStatus,now),
      this.db.prepare("UPDATE findings SET status='REVIEW_REQUIRED',updated_at=? WHERE id=?")
        .bind(now,input.findingId)
    ]);
    for(let i=0;i<input.candidates.length;i++){
      const x=input.candidates[i];
      await this.db.prepare("INSERT INTO prediction_candidates (id,prediction_id,candidate_code,rank,confidence,evidence_json) VALUES (?,?,?,?,?,?)")
        .bind(crypto.randomUUID(),predictionId,x.code,i+1,x.confidence,JSON.stringify({reason:x.reason??null})).run();
    }
    return {predictionId};
  }

  async latestRepairPrediction(findingId:string){
    return this.db.prepare(`
      SELECT ap.id AS prediction_id,ap.selected_code
      FROM ai_predictions ap
      JOIN ai_runs ar ON ar.id=ap.ai_run_id
      WHERE ar.finding_id=? AND ap.prediction_type='REPAIR'
      ORDER BY ap.created_at DESC LIMIT 1`
    ).bind(findingId).first<{prediction_id:string;selected_code:string|null}>();
  }

  async decideRepair(input:{findingId:string;finalCode:string;}){
    const allowed=await this.repairCodesForFinding(input.findingId);
    const finalCode=input.finalCode.trim().toUpperCase();
    if(!allowed.repairs.some(x=>x.repair_code===finalCode)) throw new Error("Select a verified repair method for the confirmed component.");
    const prediction=await this.latestRepairPrediction(input.findingId);
    if(!prediction) throw new Error("Analyse the repair method before confirming it.");
    const decision=prediction.selected_code===finalCode?"APPROVED":"CORRECTED";
    const now=new Date().toISOString(),decisionId=crypto.randomUUID();
    await this.db.batch([
      this.db.prepare("INSERT INTO surveyor_decisions (id,finding_id,prediction_id,field_type,ai_value,final_value,decision,created_at) VALUES (?,?,?,'REPAIR',?,?,?,?)")
        .bind(decisionId,input.findingId,prediction.prediction_id,prediction.selected_code,finalCode,decision,now),
      this.db.prepare("UPDATE ai_predictions SET status=? WHERE id=?").bind(decision,prediction.prediction_id),
      this.db.prepare("UPDATE findings SET final_repair_code=?,status=?,updated_at=? WHERE id=?")
        .bind(finalCode,decision==="APPROVED"?"APPROVED":"CORRECTED",now,input.findingId)
    ]);
    return {
      decisionId,
      predictionId:prediction.prediction_id,
      aiCode:prediction.selected_code,
      finalCode,
      decision,
      equipment:allowed.equipment,
      componentCode:allowed.componentCode,
      damageCode:allowed.damageCode
    };
  }


  async latestComponentPrediction(findingId:string){
    return this.db.prepare(`
      SELECT ap.id AS prediction_id,ap.selected_code
      FROM ai_predictions ap
      JOIN ai_runs ar ON ar.id=ap.ai_run_id
      WHERE ar.finding_id=? AND ap.prediction_type='COMPONENT'
      ORDER BY ap.created_at DESC LIMIT 1`
    ).bind(findingId).first<{prediction_id:string;selected_code:string|null}>();
  }

  async decideComponent(input:{findingId:string;finalCode:string;}){
    const context=await this.findingContext(input.findingId);
    if(!context) throw new Error("Finding not found.");
    if(!["GP","RF"].includes(context.equipment_type)) throw new Error("Unable to determine GP/RF equipment type.");
    const equipment=context.equipment_type as "GP"|"RF";
    const allowed=await this.components(equipment,context.container_face);
    const finalCode=input.finalCode.trim().toUpperCase();
    if(!allowed.some(x=>x.component_code===finalCode)) throw new Error("Select a verified component code for this equipment type and container face.");
    const prediction=await this.latestComponentPrediction(input.findingId);
    if(!prediction) throw new Error("Analyse the component before confirming it.");
    const decision=prediction.selected_code===finalCode?"APPROVED":"CORRECTED";
    const now=new Date().toISOString(),decisionId=crypto.randomUUID();
    await this.db.batch([
      this.db.prepare("INSERT INTO surveyor_decisions (id,finding_id,prediction_id,field_type,ai_value,final_value,decision,created_at) VALUES (?,?,?,'COMPONENT',?,?,?,?)")
        .bind(decisionId,input.findingId,prediction.prediction_id,prediction.selected_code,finalCode,decision,now),
      this.db.prepare("UPDATE ai_predictions SET status=? WHERE id=?").bind(decision,prediction.prediction_id),
      this.db.prepare("UPDATE findings SET final_component_code=?,status=?,updated_at=? WHERE id=?")
        .bind(finalCode,decision==="APPROVED"?"APPROVED":"CORRECTED",now,input.findingId)
    ]);
    return {decisionId,predictionId:prediction.prediction_id,aiCode:prediction.selected_code,finalCode,decision,equipment};
  }
}
