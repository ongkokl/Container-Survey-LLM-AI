import { fixedCameraProfile } from "../domain/container/fixedCameraProfile";
import {
  isValidFaceQuad,
  mapBoxToFace,
  mapPointToFace,
  type FaceQuad
} from "../domain/container/faceHomography";
import {
  suggestCedexLocationOnNormalizedSide,
  type NormalizedBox,
  type NormalizedPoint
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

export class FixedCameraCalibrationService {
  constructor(private readonly repo:CedexRepository){}

  private async context(findingId:string,cameraId:string){
    const finding=await this.repo.findingContext(findingId);
    if(!finding)throw new Error("Finding not found.");
    const camera=fixedCameraProfile(cameraId);
    if(!camera)throw new Error("Select a valid fixed camera: R, L, D or T.");
    if(camera.id!=="R"&&camera.id!=="L")throw new Error("Automatic fixed-camera CEDEX side calibration is currently enabled for Cameras R/L only.");
    if(camera.face!==finding.container_face)throw new Error("Fixed camera profile does not match this finding face.");
    if(!camera.doorEndInImage)throw new Error("Fixed camera door orientation is unavailable.");
    const face=camera.face as "LEFT"|"RIGHT";
    const doorEndInImage=camera.doorEndInImage as "LEFT"|"RIGHT";
    const geometry=await this.repo.geometryForFinding(findingId);
    const lengthFt=Number(geometry?.lengthFt)||Number(finding.length_ft)||0;
    const heightMm=Number(geometry?.heightMm)||0;
    if(![20,40].includes(lengthFt)||heightMm<=0){
      throw new Error("Known container length/height geometry is required before fixed-camera calibration can be used.");
    }
    return {finding,camera,face,doorEndInImage,geometry,lengthFt,heightMm};
  }

  async get(findingId:string,cameraId:string){
    const ctx=await this.context(findingId,cameraId);
    const stored=await this.repo.fixedCameraCalibration(ctx.camera.id,ctx.lengthFt,ctx.heightMm);
    if(!stored)return {
      available:false,
      cameraId:ctx.camera.id,
      face:ctx.face,
      lengthFt:ctx.lengthFt,
      heightMm:ctx.heightMm,
      doorEndInImage:ctx.doorEndInImage,
      calibrationVersion:null,
      corners:null
    };
    const corners=asFaceQuad(stored.corners);
    if(!corners)return {
      available:false,
      cameraId:ctx.camera.id,
      face:ctx.face,
      lengthFt:ctx.lengthFt,
      heightMm:ctx.heightMm,
      doorEndInImage:ctx.doorEndInImage,
      calibrationVersion:stored.calibrationVersion,
      corners:null
    };
    return {
      available:true,
      cameraId:ctx.camera.id,
      face:ctx.face,
      lengthFt:ctx.lengthFt,
      heightMm:ctx.heightMm,
      doorEndInImage:ctx.doorEndInImage,
      calibrationVersion:stored.calibrationVersion,
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
      doorEndInImage:ctx.doorEndInImage,
      corners
    });
    return {
      available:true,
      cameraId:ctx.camera.id,
      face:ctx.face,
      lengthFt:ctx.lengthFt,
      heightMm:ctx.heightMm,
      doorEndInImage:ctx.doorEndInImage,
      calibrationVersion:stored?.calibrationVersion??1,
      corners,
      updatedAt:stored?.updatedAt??new Date().toISOString()
    };
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

    let normalizedDamage:NormalizedBox;
    let normalizedPoint:NormalizedPoint|null=null;
    let markType:"BOX"|"POINT";

    const box=validBox(input.damageBox);
    if(box){
      normalizedDamage=mapBoxToFace(box,calibration.corners,calibration.doorEndInImage);
      normalizedPoint={
        x:normalizedDamage.x+normalizedDamage.width/2,
        y:normalizedDamage.y+normalizedDamage.height/2
      };
      markType="BOX";
    }else{
      const point=validPoint(input.damagePoint);
      if(!point)throw new Error("Mark the damage area or damage point first.");
      normalizedPoint=mapPointToFace(point,calibration.corners,calibration.doorEndInImage);
      const tiny=1e-6;
      normalizedDamage={
        x:Math.max(0,normalizedPoint.x-tiny/2),
        y:Math.max(0,normalizedPoint.y-tiny/2),
        width:tiny,
        height:tiny
      };
      markType="POINT";
    }

    const result=suggestCedexLocationOnNormalizedSide({
      face:calibration.face,
      lengthFt:calibration.lengthFt,
      damageBox:normalizedDamage
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
