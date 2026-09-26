import { ContainerFace, FindingRepository } from "../infrastructure/d1/findingRepository";
import { PhotoStore } from "../infrastructure/r2/photoStore";

const FACES=new Set<ContainerFace>(["LEFT","RIGHT","FRONT","DOOR","ROOF","FLOOR"]);
const ROLES=new Set(["FACE_OVERVIEW","COMPONENT_CLOSEUP","DAMAGE_CLOSEUP"]);
const TYPES=new Set(["image/jpeg","image/png","image/webp","image/heic","image/heif"]);
const MAX=8*1024*1024;

export class FindingCaptureService {
  constructor(private readonly repo:FindingRepository,private readonly photos:PhotoStore){}

  async create(surveyId:string,face:string){
    const normalized=face.toUpperCase() as ContainerFace;
    if(!surveyId||!FACES.has(normalized)) throw new Error("Select a valid container face.");
    return this.repo.create(surveyId,normalized);
  }

  async list(surveyId:string){ return this.repo.list(surveyId); }

  async upload(input:{
    surveyId:string;
    findingId:string;
    role:string;
    file:File;
    width?:number|null;
    height?:number|null;
    captureSource?:string|null;
    measurementRole?:string|null;
  }){
    if(!ROLES.has(input.role)) throw new Error("Invalid photo role.");
    if(!input.file||input.file.size===0) throw new Error("A photo is required.");
    if(input.file.size>MAX) throw new Error("Photo must be below 8 MB.");
    const contentType=(input.file.type||"image/jpeg").toLowerCase();
    if(!TYPES.has(contentType)) throw new Error("Unsupported image type.");
    if(!(await this.repo.belongsToSurvey(input.findingId,input.surveyId))) throw new Error("Finding does not belong to this survey.");

    const captureSource=input.captureSource?.trim().toUpperCase()||null;
    const measurementRole=input.measurementRole?.trim().toUpperCase()||null;
    if(captureSource&&!["CAMERA","GALLERY"].includes(captureSource)) throw new Error("Invalid capture source.");
    if(measurementRole&&!["REFERENCE_GEOMETRY","DETAIL_SEGMENTATION"].includes(measurementRole)) throw new Error("Invalid measurement role.");
    if(input.role==="FACE_OVERVIEW"&&measurementRole&&measurementRole!=="REFERENCE_GEOMETRY") throw new Error("Overview photo must use reference geometry role.");
    if(input.role==="DAMAGE_CLOSEUP"&&measurementRole&&measurementRole!=="DETAIL_SEGMENTATION") throw new Error("Damage close-up must use detail segmentation role.");

    const photoId=crypto.randomUUID(), bytes=await input.file.arrayBuffer();
    const stored=await this.photos.saveFindingPhoto({
      surveyId:input.surveyId,findingId:input.findingId,photoId,
      role:input.role as "FACE_OVERVIEW"|"COMPONENT_CLOSEUP"|"DAMAGE_CLOSEUP",
      bytes,contentType
    });

    await this.repo.addPhoto({
      photoId,
      surveyId:input.surveyId,findingId:input.findingId,
      role:input.role as "FACE_OVERVIEW"|"COMPONENT_CLOSEUP"|"DAMAGE_CLOSEUP",
      r2Key:stored.key,contentType,width:input.width,height:input.height,
      captureSource:captureSource as "CAMERA"|"GALLERY"|null,
      measurementRole:measurementRole as "REFERENCE_GEOMETRY"|"DETAIL_SEGMENTATION"|null
    });
    return {photoId,r2Key:stored.key,role:input.role,captureSource,measurementRole};
  }

  async annotate(input:{photoId:string;annotationType:string;geometryType:string;geometry:unknown;createdBy?:"AI"|"SURVEYOR";}){
    const types=new Set(["CONTAINER_FACE","COMPONENT","DAMAGE","LOCATION_POINT"]);
    const geometries=new Set(["POINT","BOX","POLYGON","LINE"]);
    if(!types.has(input.annotationType)||!geometries.has(input.geometryType)) throw new Error("Invalid annotation.");
    if(input.createdBy!==undefined&&!["AI","SURVEYOR"].includes(input.createdBy)) throw new Error("Invalid annotation provenance.");
    return {annotationId:await this.repo.addAnnotation({
      photoId:input.photoId,
      type:input.annotationType as "CONTAINER_FACE"|"COMPONENT"|"DAMAGE"|"LOCATION_POINT",
      geometryType:input.geometryType as "POINT"|"BOX"|"POLYGON"|"LINE",
      geometry:input.geometry,
      createdBy:input.createdBy??"SURVEYOR"
    })};
  }
}
