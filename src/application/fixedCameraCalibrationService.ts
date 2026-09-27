import { fixedCameraProfile } from "../domain/container/fixedCameraProfile";
import {
  isValidFaceQuad,
  mapBoxToCalibratedFace,
  mapPointToCalibratedFace,
  type FaceQuad
} from "../domain/container/faceHomography";
import {
  isValidEndFaceStructureCalibration,
  suggestCedexLocationOnNormalizedFace,
  type EndFaceStructureCalibration,
  type NormalizedBox,
  type NormalizedPoint,
  type SurveyFace
} from "../domain/container/locationCode";
import { CedexRepository } from "../infrastructure/d1/cedexRepository";

function asFaceQuad(value:unknown):FaceQuad|null{
  if(!Array.isArray(value)||value.length!==4)return null;
  const points=value.map(v=>({
    x:Number((v as {x?:unknown})?.x),
    y:Number((v as {y?:unknown})?.y)
  })) as FaceQuad;
  return isValidFaceQuad(points)?points:null;
}

function validBox(value:unknown):NormalizedBox|null{
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const v=value as Record<string,unknown>;
  const box={x:Number(v.x),y:Number(v.y),width:Number(v.width),height:Number(v.height)};
  if(![box.x,box.y,box.width,box.height].every(Number.isFinite))return null;
  if(box.x<0||box.y<0||box.width<=0||box.height<=0||box.x+box.width>1.000001||box.y+box.height>1.000001)return null;
  return box;
}

function validPoint(value:unknown):NormalizedPoint|null{
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const v=value as Record<string,unknown>,point={x:Number(v.x),y:Number(v.y)};
  if(![point.x,point.y].every(Number.isFinite)||point.x<0||point.x>1||point.y<0||point.y>1)return null;
  return point;
}

function pointTriplet(value:unknown,label:string):[NormalizedPoint,NormalizedPoint,NormalizedPoint]{
  if(!Array.isArray(value)||value.length!==3)throw new Error(label+" requires exactly three guide points.");
  const points=value.map(validPoint);
  if(points.some(x=>!x))throw new Error(label+" contains an invalid guide point.");
  return points as [NormalizedPoint,NormalizedPoint,NormalizedPoint];
}

export class FixedCameraCalibrationService {
  constructor(private readonly repo:CedexRepository){}

  private async context(findingId:string,cameraId:string){
    const finding=await this.repo.findingContext(findingId);
    if(!finding)throw new Error("Finding not found.");
    const camera=fixedCameraProfile(cameraId);
    if(!camera)throw new Error("Select a valid fixed camera: R, L, D, F, T or B.");
    if(camera.face!==finding.container_face)throw new Error("Fixed camera profile does not match this finding face.");
    const face=camera.face as SurveyFace;
    const equipment=String(finding.equipment_type??"").toUpperCase();
    if(!["GP","RF"].includes(equipment))throw new Error("Unable to determine GP/RF equipment type.");
    const geometry=await this.repo.geometryForFinding(findingId);
    const lengthFt=Number(geometry?.lengthFt)||Number(finding.length_ft)||0;
    const heightMm=Number(geometry?.heightMm)||0;
    if(![20,40].includes(lengthFt)||heightMm<=0){
      throw new Error("Known container length/height geometry is required before fixed-camera calibration can be used.");
    }
    return {finding,camera,face,equipment:equipment as "GP"|"RF",geometry,lengthFt,heightMm};
  }

  async get(findingId:string,cameraId:string){
    const ctx=await this.context(findingId,cameraId);
    let stored=await this.repo.fixedCameraCalibration(ctx.camera.id,ctx.lengthFt,ctx.heightMm);
    if(!stored&&(ctx.camera.id==="D"||ctx.camera.id==="F")){
      stored=await this.repo.fixedCameraCalibrationByHeight(ctx.camera.id,ctx.heightMm);
    }

    const requiresEndStructure=ctx.face==="DOOR"||ctx.face==="FRONT";
    const structureRow=requiresEndStructure
      ?await this.repo.fixedCameraEndStructureCalibration(ctx.camera.id,ctx.equipment,ctx.heightMm)
      :null;
    const candidateStructure:EndFaceStructureCalibration|null=structureRow?{
      positionBoundariesX:structureRow.positionBoundariesX as [number,number,number],
      verticalBoundariesY:structureRow.verticalBoundariesY as [number,number,number]
    }:null;
    const endFaceStructure=requiresEndStructure
      ?{
          required:true,
          available:isValidEndFaceStructureCalibration(candidateStructure),
          equipmentType:ctx.equipment,
          heightMm:ctx.heightMm,
          calibrationVersion:structureRow?.calibrationVersion??null,
          positionBoundariesX:isValidEndFaceStructureCalibration(candidateStructure)?candidateStructure.positionBoundariesX:null,
          verticalBoundariesY:isValidEndFaceStructureCalibration(candidateStructure)?candidateStructure.verticalBoundariesY:null,
          updatedAt:structureRow?.updatedAt??null
        }
      :{
          required:false,
          available:false,
          equipmentType:ctx.equipment,
          heightMm:ctx.heightMm,
          calibrationVersion:null,
          positionBoundariesX:null,
          verticalBoundariesY:null,
          updatedAt:null
        };

    const common={
      cameraId:ctx.camera.id,
      face:ctx.face,
      equipmentType:ctx.equipment,
      lengthFt:ctx.lengthFt,
      heightMm:ctx.heightMm,
      doorEndInImage:ctx.camera.doorEndInImage,
      canonicalFlipX:ctx.camera.canonicalFlipX,
      canonicalFlipY:ctx.camera.canonicalFlipY,
      endFaceStructure
    };
    if(!stored)return {
      ...common,
      available:false,
      calibrationVersion:null,
      calibrationSourceLengthFt:null,
      reusedAcrossLength:false,
      corners:null
    };
    const corners=asFaceQuad(stored.corners);
    if(!corners)return {
      ...common,
      available:false,
      calibrationVersion:stored.calibrationVersion,
      calibrationSourceLengthFt:stored.lengthFt,
      reusedAcrossLength:stored.lengthFt!==ctx.lengthFt,
      corners:null
    };
    return {
      ...common,
      available:true,
      calibrationVersion:stored.calibrationVersion,
      calibrationSourceLengthFt:stored.lengthFt,
      reusedAcrossLength:stored.lengthFt!==ctx.lengthFt,
      corners,
      updatedAt:stored.updatedAt
    };
  }

  async save(input:{findingId:string;cameraId:string;corners:unknown}){
    const ctx=await this.context(input.findingId,input.cameraId);
    const corners=asFaceQuad(input.corners);
    if(!corners)throw new Error("Mark the four container-face corners in order: top-left, top-right, bottom-right, bottom-left.");
    const stored=await this.repo.upsertFixedCameraCalibration({
      cameraId:ctx.camera.id,
      containerFace:ctx.face,
      lengthFt:ctx.lengthFt,
      heightMm:ctx.heightMm,
      doorEndInImage:ctx.camera.doorEndInImage,
      corners
    });
    return this.get(input.findingId,input.cameraId).then(result=>({
      ...result,
      calibrationVersion:stored?.calibrationVersion??result.calibrationVersion??1,
      corners
    }));
  }

  async saveEndStructure(input:{
    findingId:string;
    cameraId:string;
    positionGuides:unknown;
    verticalGuides:unknown;
  }){
    const ctx=await this.context(input.findingId,input.cameraId);
    if(ctx.camera.id!=="D"&&ctx.camera.id!=="F"){
      throw new Error("Physical end-face structure calibration is only used for fixed Cameras D and F.");
    }
    const calibration=await this.get(input.findingId,input.cameraId);
    if(!calibration.available||!calibration.corners){
      throw new Error("Complete the four-corner fixed-camera calibration before calibrating Door/Front structure.");
    }

    const positionGuides=pointTriplet(input.positionGuides,"Door/Front position calibration");
    const verticalGuides=pointTriplet(input.verticalGuides,"Door/Front vertical-zone calibration");
    const orientation={flipX:calibration.canonicalFlipX,flipY:calibration.canonicalFlipY};
    const positionBoundariesX=positionGuides
      .map(p=>mapPointToCalibratedFace(p,calibration.corners!,orientation).x)
      .sort((a,b)=>a-b) as [number,number,number];
    const verticalBoundariesY=verticalGuides
      .map(p=>mapPointToCalibratedFace(p,calibration.corners!,orientation).y)
      .sort((a,b)=>a-b) as [number,number,number];

    const structure:EndFaceStructureCalibration={positionBoundariesX,verticalBoundariesY};
    if(!isValidEndFaceStructureCalibration(structure)){
      throw new Error("The marked structural boundaries overlap or are too close. Mark 1|2, 2|3, 3|4 from left to right and H|T, T|B, B|G from top to bottom.");
    }

    await this.repo.upsertFixedCameraEndStructureCalibration({
      cameraId:ctx.camera.id,
      containerFace:ctx.face as "DOOR"|"FRONT",
      equipmentType:ctx.equipment,
      heightMm:ctx.heightMm,
      positionBoundariesX,
      verticalBoundariesY
    });
    return this.get(input.findingId,input.cameraId);
  }

  async calculate(input:{
    findingId:string;
    cameraId:string;
    damageBox?:unknown;
    damagePoint?:unknown;
  }){
    const calibration=await this.get(input.findingId,input.cameraId);
    if(!calibration.available||!calibration.corners){
      throw new Error(
        "Fixed Camera "+calibration.cameraId+" calibration is not configured for "+
        calibration.lengthFt+" ft / "+calibration.heightMm+" mm container geometry."
      );
    }

    const orientation={
      flipX:calibration.canonicalFlipX,
      flipY:calibration.canonicalFlipY
    };
    let normalizedDamage:NormalizedBox;
    let normalizedPoint:NormalizedPoint|null=null;
    let markType:"BOX"|"POINT";

    const box=validBox(input.damageBox);
    if(box){
      normalizedDamage=mapBoxToCalibratedFace(box,calibration.corners,orientation);
      normalizedPoint={
        x:normalizedDamage.x+normalizedDamage.width/2,
        y:normalizedDamage.y+normalizedDamage.height/2
      };
      markType="BOX";
    }else{
      const point=validPoint(input.damagePoint);
      if(!point)throw new Error("Mark the damage area or damage point first.");
      normalizedPoint=mapPointToCalibratedFace(point,calibration.corners,orientation);
      const tiny=1e-6;
      normalizedDamage={
        x:Math.max(0,normalizedPoint.x-tiny/2),
        y:Math.max(0,normalizedPoint.y-tiny/2),
        width:tiny,
        height:tiny
      };
      markType="POINT";
    }

    const structure:EndFaceStructureCalibration|null=calibration.endFaceStructure.available
      ?{
          positionBoundariesX:calibration.endFaceStructure.positionBoundariesX!,
          verticalBoundariesY:calibration.endFaceStructure.verticalBoundariesY!
        }
      :null;
    const result=suggestCedexLocationOnNormalizedFace({
      face:calibration.face,
      lengthFt:calibration.lengthFt,
      damageBox:normalizedDamage,
      endFaceStructure:structure
    });
    return {
      ...result,
      referenceSource:"FIXED_CAMERA_CALIBRATION",
      markType,
      calibration,
      normalizedDamageBox:normalizedDamage,
      normalizedPoint
    };
  }
}
