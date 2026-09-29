import { fixedCameraProfile } from "../domain/container/fixedCameraProfile";
import {
  isValidFaceQuad,
  mapBoxToCalibratedFace,
  mapPointToCalibratedFace,
  type FaceQuad
} from "../domain/container/faceHomography";
import {
  alignedCalibrationCorners,
  assessFixedCameraAlignment
} from "../domain/container/fixedCameraAlignment";
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

function facePhysicalAxes(face:SurveyFace,geometry:{
  lengthMm:number|null;
  widthMm:number|null;
  heightMm:number|null;
}):{xMm:number;yMm:number;xLabel:string;yLabel:string}|null{
  const lengthMm=Number(geometry.lengthMm);
  const widthMm=Number(geometry.widthMm);
  const heightMm=Number(geometry.heightMm);
  if(face==="LEFT"||face==="RIGHT"){
    if(lengthMm>0&&heightMm>0)return {xMm:lengthMm,yMm:heightMm,xLabel:"LONGITUDINAL",yLabel:"VERTICAL"};
  }
  if(face==="DOOR"||face==="FRONT"){
    if(widthMm>0&&heightMm>0)return {xMm:widthMm,yMm:heightMm,xLabel:"HORIZONTAL",yLabel:"VERTICAL"};
  }
  if(face==="ROOF"||face==="FLOOR"){
    if(lengthMm>0&&widthMm>0)return {xMm:lengthMm,yMm:widthMm,xLabel:"LONGITUDINAL",yLabel:"TRANSVERSE"};
  }
  return null;
}

function distanceMm(a:NormalizedPoint,b:NormalizedPoint,xMm:number,yMm:number):number{
  const dx=(b.x-a.x)*xMm,dy=(b.y-a.y)*yMm;
  return Math.hypot(dx,dy);
}

function measurePhysicalDamage(input:{
  box:NormalizedBox;
  corners:FaceQuad;
  orientation:{flipX:boolean;flipY:boolean};
  face:SurveyFace;
  geometry:{lengthMm:number|null;widthMm:number|null;heightMm:number|null};
}){
  const axes=facePhysicalAxes(input.face,input.geometry);
  if(!axes)return null;
  const sourceCorners=[
    {x:input.box.x,y:input.box.y},
    {x:input.box.x+input.box.width,y:input.box.y},
    {x:input.box.x+input.box.width,y:input.box.y+input.box.height},
    {x:input.box.x,y:input.box.y+input.box.height}
  ] as const;
  const mapped=sourceCorners.map(p=>mapPointToCalibratedFace(p,input.corners,input.orientation));
  const top=distanceMm(mapped[0],mapped[1],axes.xMm,axes.yMm);
  const bottom=distanceMm(mapped[3],mapped[2],axes.xMm,axes.yMm);
  const left=distanceMm(mapped[0],mapped[3],axes.xMm,axes.yMm);
  const right=distanceMm(mapped[1],mapped[2],axes.xMm,axes.yMm);
  const spanXmm=(top+bottom)/2;
  const spanYmm=(left+right)/2;
  const majorMm=Math.max(spanXmm,spanYmm);
  const minorMm=Math.min(spanXmm,spanYmm);
  const round1=(v:number)=>Math.round(v*10)/10;
  return {
    method:"FIXED_CAMERA_HOMOGRAPHY",
    planeProjected:true,
    xAxis:axes.xLabel,
    yAxis:axes.yLabel,
    spanXmm:round1(spanXmm),
    spanYmm:round1(spanYmm),
    majorMm:round1(majorMm),
    minorMm:round1(minorMm),
    majorCm:round1(majorMm/10),
    minorCm:round1(minorMm/10),
    source:"OVERVIEW_DAMAGE_BOX",
    requiresSurveyorVerification:true
  };
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

  async alignment(findingId:string,cameraId:string,referenceBox:unknown){
    const calibration=await this.get(findingId,cameraId);
    if(!calibration.available||!calibration.corners){
      return {
        status:"UNAVAILABLE" as const,
        verified:false,
        compensationAllowed:false,
        reason:"Fixed Camera "+calibration.cameraId+" calibration is not configured for this container geometry."
      };
    }
    const detectedBox=validBox(referenceBox);
    if(!detectedBox){
      return {
        status:"RED" as const,
        verified:false,
        compensationAllowed:false,
        reason:"Container alignment could not be verified from this overview. Reposition/retake the overview before automatic CEDEX location."
      };
    }
    return assessFixedCameraAlignment(calibration.corners,detectedBox);
  }

  async calculate(input:{
    findingId:string;
    cameraId:string;
    damageBox?:unknown;
    damagePoint?:unknown;
    alignmentReferenceBox?:unknown;
    requireAlignment?:boolean;
  }){
    const calibration=await this.get(input.findingId,input.cameraId);
    if(!calibration.available||!calibration.corners){
      throw new Error(
        "Fixed Camera "+calibration.cameraId+" calibration is not configured for "+
        calibration.lengthFt+" ft / "+calibration.heightMm+" mm container geometry."
      );
    }

    const alignment=(input.alignmentReferenceBox!==undefined&&input.alignmentReferenceBox!==null)||input.requireAlignment
      ?await this.alignment(input.findingId,input.cameraId,input.alignmentReferenceBox)
      :null;
    if(alignment&&(alignment.status==="RED"||(input.requireAlignment&&alignment.status==="UNAVAILABLE"))){
      return {
        code:null,
        reviewRequired:true,
        reason:alignment.reason,
        referenceSource:"FIXED_CAMERA_CALIBRATION",
        markType:null,
        calibration,
        alignment,
        normalizedDamageBox:null,
        normalizedPoint:null,
        physicalMeasurement:null
      };
    }
    const alignedBox=validBox(input.alignmentReferenceBox);
    const activeCorners=
      alignment&&alignment.status!=="UNAVAILABLE"&&alignment.compensationAllowed&&alignedBox
        ?alignedCalibrationCorners(calibration.corners,alignedBox)
        :calibration.corners;

    const orientation={
      flipX:calibration.canonicalFlipX,
      flipY:calibration.canonicalFlipY
    };
    let normalizedDamage:NormalizedBox;
    let normalizedPoint:NormalizedPoint|null=null;
    let markType:"BOX"|"POINT";

    const box=validBox(input.damageBox);
    let physicalMeasurement:null|ReturnType<typeof measurePhysicalDamage>=null;
    if(box){
      normalizedDamage=mapBoxToCalibratedFace(box,activeCorners,orientation);
      normalizedPoint={
        x:normalizedDamage.x+normalizedDamage.width/2,
        y:normalizedDamage.y+normalizedDamage.height/2
      };
      const ctx=await this.context(input.findingId,input.cameraId);
      physicalMeasurement=ctx.geometry?measurePhysicalDamage({
        box,
        corners:activeCorners,
        orientation,
        face:calibration.face,
        geometry:{
          lengthMm:ctx.geometry.lengthMm??null,
          widthMm:ctx.geometry.widthMm??null,
          heightMm:ctx.geometry.heightMm??null
        }
      }):null;
      markType="BOX";
    }else{
      const point=validPoint(input.damagePoint);
      if(!point)throw new Error("Mark the damage area or damage point first.");
      normalizedPoint=mapPointToCalibratedFace(point,activeCorners,orientation);
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
    const alignmentReview=alignment?.status==="AMBER";
    return {
      ...result,
      reviewRequired:Boolean(result.reviewRequired)||alignmentReview,
      reason:alignmentReview
        ?(result.reason?result.reason+" ":"")+alignment.reason
        :result.reason,
      referenceSource:"FIXED_CAMERA_CALIBRATION",
      markType,
      calibration,
      alignment,
      normalizedDamageBox:normalizedDamage,
      normalizedPoint,
      physicalMeasurement
    };
  }
}
