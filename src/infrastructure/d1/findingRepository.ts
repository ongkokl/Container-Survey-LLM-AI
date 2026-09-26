export type ContainerFace = "LEFT" | "RIGHT" | "FRONT" | "DOOR" | "ROOF" | "FLOOR";

export interface FindingSummary {
  id: string;
  survey_id: string;
  finding_sequence: number;
  status: string;
  container_face: ContainerFace | null;
  created_at: string;
}

export class FindingRepository {
  constructor(private readonly db: D1Database) {}

  async assertActiveSurvey(surveyId: string): Promise<void> {
    const row = await this.db.prepare(
      "SELECT id FROM surveys WHERE id = ? AND status IN ('IDENTIFIED','SURVEYING','REVIEW_REQUIRED')"
    ).bind(surveyId).first<{id:string}>();
    if (!row) throw new Error("Survey is not active.");
  }

  async create(surveyId: string, containerFace: ContainerFace): Promise<FindingSummary> {
    await this.assertActiveSurvey(surveyId);
    const next = await this.db.prepare(
      "SELECT COALESCE(MAX(finding_sequence),0)+1 AS n FROM findings WHERE survey_id = ?"
    ).bind(surveyId).first<{n:number}>();
    const id=crypto.randomUUID(), now=new Date().toISOString(), sequence=next?.n ?? 1;
    await this.db.batch([
      this.db.prepare(
        "INSERT INTO findings (id,survey_id,finding_sequence,status,container_face,created_at,updated_at) VALUES (?,?,?,'CAPTURED',?,?,?)"
      ).bind(id,surveyId,sequence,containerFace,now,now),
      this.db.prepare("UPDATE surveys SET status='SURVEYING',updated_at=? WHERE id=?").bind(now,surveyId),
      this.db.prepare("UPDATE gate_cycles SET status='SURVEYING' WHERE id=(SELECT gate_cycle_id FROM surveys WHERE id=?)").bind(surveyId)
    ]);
    return {id,survey_id:surveyId,finding_sequence:sequence,status:"CAPTURED",container_face:containerFace,created_at:now};
  }

  async list(surveyId: string): Promise<FindingSummary[]> {
    const result=await this.db.prepare(
      "SELECT id,survey_id,finding_sequence,status,container_face,created_at FROM findings WHERE survey_id=? AND status<>'CANCELLED' ORDER BY finding_sequence"
    ).bind(surveyId).all<FindingSummary>();
    return result.results;
  }

  async belongsToSurvey(findingId:string,surveyId:string):Promise<boolean>{
    return Boolean(await this.db.prepare("SELECT id FROM findings WHERE id=? AND survey_id=?").bind(findingId,surveyId).first());
  }

  async addPhoto(input:{
    photoId:string;
    surveyId:string;
    findingId:string;
    role:"FACE_OVERVIEW"|"COMPONENT_CLOSEUP"|"DAMAGE_CLOSEUP";
    r2Key:string;
    contentType:string;
    width?:number|null;
    height?:number|null;
    captureSource?:"CAMERA"|"GALLERY"|null;
    measurementRole?:"REFERENCE_GEOMETRY"|"DETAIL_SEGMENTATION"|null;
  }):Promise<string>{
    if(!(await this.belongsToSurvey(input.findingId,input.surveyId))) throw new Error("Finding does not belong to this survey.");
    const id=input.photoId,now=new Date().toISOString();
    await this.db.prepare(
      "INSERT INTO survey_photos (id,survey_id,finding_id,photo_role,r2_key,width,height,content_type,capture_source,measurement_role,captured_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(
      id,input.surveyId,input.findingId,input.role,input.r2Key,
      input.width??null,input.height??null,input.contentType,
      input.captureSource??null,input.measurementRole??null,now,now
    ).run();
    return id;
  }

  async addAnnotation(input:{photoId:string;type:"CONTAINER_FACE"|"COMPONENT"|"DAMAGE"|"LOCATION_POINT";geometryType:"POINT"|"BOX"|"POLYGON"|"LINE";geometry:unknown;createdBy?:"AI"|"SURVEYOR";}):Promise<string>{
    const id=crypto.randomUUID(),now=new Date().toISOString();
    await this.db.prepare(
      "INSERT INTO annotations (id,photo_id,annotation_type,geometry_type,geometry_json,created_by,created_at) VALUES (?,?,?,?,?,?,?)"
    ).bind(id,input.photoId,input.type,input.geometryType,JSON.stringify(input.geometry),input.createdBy??"SURVEYOR",now).run();
    return id;
  }
}
