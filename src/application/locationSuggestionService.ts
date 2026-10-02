import {
  suggestCedexLocation,
  suggestCedexLocationFromPoint,
  suggestCedexLocationOnNormalizedSide,
  type NormalizedBox,
  type NormalizedPoint,
  type SurveyFace
} from "../domain/container/locationCode";
import {
  isValidFaceQuad,
  mapBoxToFace,
  mapPointToFace,
  type DoorEndSide,
  type FaceQuad
} from "../domain/container/faceHomography";
import { inferDoorEndDetection, inferFaceVerification } from "../domain/container/doorEndOrientation";
import { CedexRepository } from "../infrastructure/d1/cedexRepository";
import { fixedCameraProfile } from "../domain/container/fixedCameraProfile";
import { MoondreamDamageMarker } from "../infrastructure/ai/moondreamDamageMarker";
import { FixedCameraCalibrationService } from "./fixedCameraCalibrationService";

type CaptureMetadata={
  source?:unknown;
  measurementQuality?:unknown;
  referenceFrame?:unknown;
  fixedCameraMode?:unknown;
  fixedCameraId?:unknown;
  fixedCameraFace?:unknown;
  fixedDoorEndInImage?:unknown;
  fixedAlignmentReferenceBox?:unknown;
  fixedAlignmentConfidence?:unknown;
  fixedAlignmentSource?:unknown;
};

function normalizedBox(value:unknown):NormalizedBox|null{
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const v=value as Record<string,unknown>;
  const box={
    x:Number(v.x),
    y:Number(v.y),
    width:Number(v.width),
    height:Number(v.height)
  };
  if(![box.x,box.y,box.width,box.height].every(Number.isFinite))return null;
  if(box.x<0||box.y<0||box.width<=0||box.height<=0||box.x+box.width>1.000001||box.y+box.height>1.000001)return null;
  return box;
}

function captureInfo(value:unknown){
  if(!value||typeof value!=="object"||Array.isArray(value)){
    return {
      source:"unknown",
      measurementQuality:"UNKNOWN",
      referenceFrame:null as NormalizedBox|null,
      fixedCameraMode:false,
      fixedCameraId:null as string|null,
      fixedAlignmentReferenceBox:null as NormalizedBox|null,
      fixedAlignmentConfidence:null as number|null,
      fixedAlignmentSource:null as string|null
    };
  }
  const meta=value as CaptureMetadata;
  const source=typeof meta.source==="string"?meta.source.toLowerCase():"unknown";
  const measurementQuality=typeof meta.measurementQuality==="string"?meta.measurementQuality.toUpperCase():"UNKNOWN";
  const referenceFrame=source==="guided_camera"?normalizedBox(meta.referenceFrame):null;
  const fixedCameraMode=meta.fixedCameraMode===true;
  const fixedCameraId=typeof meta.fixedCameraId==="string"?meta.fixedCameraId.toUpperCase():null;
  const fixedAlignmentReferenceBox=normalizedBox(meta.fixedAlignmentReferenceBox);
  const fixedAlignmentConfidence=Number.isFinite(Number(meta.fixedAlignmentConfidence))
    ?Number(meta.fixedAlignmentConfidence)
    :null;
  const fixedAlignmentSource=typeof meta.fixedAlignmentSource==="string"
    ?meta.fixedAlignmentSource
    :null;
  return {
    source,
    measurementQuality,
    referenceFrame,
    fixedCameraMode,
    fixedCameraId,
    fixedAlignmentReferenceBox,
    fixedAlignmentConfidence,
    fixedAlignmentSource
  };
}

function expectedAspect(face:string,geometry:{
  lengthMm:number|null;
  widthMm:number|null;
  heightMm:number|null;
}|null):number|null{
  if(!geometry)return null;
  const length=Number(geometry.lengthMm),width=Number(geometry.widthMm),height=Number(geometry.heightMm);
  if((face==="LEFT"||face==="RIGHT")&&length>0&&height>0)return length/height;
  if((face==="FRONT"||face==="DOOR")&&width>0&&height>0)return width/height;
  if((face==="ROOF"||face==="FLOOR")&&length>0&&width>0)return length/width;
  return null;
}

function geometryScore(reference:NormalizedBox|null,imageWidth:number,imageHeight:number,expected:number|null):number|null{
  if(!reference||!expected||imageWidth<=0||imageHeight<=0)return null;
  const observed=(reference.width*imageWidth)/(reference.height*imageHeight);
  if(!Number.isFinite(observed)||observed<=0)return null;
  return Number(Math.min(observed/expected,expected/observed).toFixed(3));
}

function contextBoxAroundPoint(point:NormalizedPoint,size=0.18):NormalizedBox{
  const width=Math.min(0.32,Math.max(0.08,size));
  const height=width;
  const x=Math.min(1-width,Math.max(0,point.x-width/2));
  const y=Math.min(1-height,Math.max(0,point.y-height/2));
  return {x,y,width,height};
}

export class LocationSuggestionService{
  constructor(
    private readonly repo:CedexRepository,
    private readonly marker:MoondreamDamageMarker
  ){}

  async analyse(input:{
    findingId:string;
    file:File;
    imageWidth:number;
    imageHeight:number;
    captureMetadata?:unknown;
    fastPointOnly?:boolean;
  }){
    const context=await this.repo.findingContext(input.findingId);
    if(!context)throw new Error("Finding not found.");
    const geometry=await this.repo.geometryForFinding(input.findingId);
    const capture=captureInfo(input.captureMetadata);
    const fixedCamera=capture.fixedCameraMode?fixedCameraProfile(capture.fixedCameraId):null;
    const fixedCameraMatches=Boolean(fixedCamera&&fixedCamera.face===context.container_face);
    if(fixedCameraMatches&&fixedCamera){
      const calibrationService=new FixedCameraCalibrationService(this.repo);
      const calibration=await calibrationService.get(input.findingId,fixedCamera.id);

      if(input.fastPointOnly){
        const fastStartedAt=Date.now();
        const alignmentReferenceBox=capture.fixedAlignmentReferenceBox;
        const alignment=alignmentReferenceBox
          ?await calibrationService.alignment(input.findingId,fixedCamera.id,alignmentReferenceBox)
          :await calibrationService.alignment(input.findingId,fixedCamera.id,null);
        const alignmentSource=alignmentReferenceBox?(capture.fixedAlignmentSource??"FIXED_GEOMETRY_EDGE"):"NONE";
        const sideFace=context.container_face==="LEFT"||context.container_face==="RIGHT";
        const fixedFaceVerification=sideFace?{
          selectedFace:context.container_face,
          detectedFace:context.container_face as "LEFT"|"RIGHT",
          confidence:1,
          status:"MATCH" as const,
          evidence:"FIXED_CAMERA_PROFILE" as const,
          reason:"Container face and orientation come from the fixed POC camera profile."
        }:{
          selectedFace:context.container_face,
          detectedFace:null,
          confidence:1,
          status:"UNVERIFIED" as const,
          evidence:null,
          reason:"Container face and orientation come from the fixed POC camera profile."
        };
        const fixedDoorEndDetection={
          visible:false,
          side:fixedCamera.doorEndInImage,
          confidence:1,
          expectedSide:fixedCamera.doorEndInImage,
          matchesSelectedFace:true,
          suggestedFace:sideFace?context.container_face as "LEFT"|"RIGHT":null,
          doorDominant:false,
          reason:fixedCamera.doorEndInImage
            ?"Longitudinal orientation comes from fixed Camera "+fixedCamera.id+"."
            :"Face orientation comes from fixed Camera "+fixedCamera.id+"."
        };

        const pointStartedAt=Date.now();
        const pointed=await this.marker.pointOverview(input.file,context.container_face);
        const moondreamPointMs=Date.now()-pointStartedAt;
        const point=pointed.found&&pointed.geometry?pointed.geometry:null;

        if(!point){
          const reason="Fast Moondream pinpoint did not find a reliable damage target. Full-overview Qwen fallback is required.";
          const prediction=await this.repo.saveLocationPrediction({
            findingId:input.findingId,
            surveyId:context.survey_id,
            modelName:pointed.model,
            selectedCode:null,
            status:"FAILED",
            response:{
              found:false,point:null,damageBox:null,localizationSource:"MOONDREAM_POINT_FAST_MISS",
              referenceBox:alignmentReferenceBox,referenceSource:"FIXED_CAMERA_CALIBRATION",
              doorEndDetection:fixedDoorEndDetection,doorBox:null,faceVerification:fixedFaceVerification,
              fixedCameraId:fixedCamera.id,fixedCameraFace:fixedCamera.face,calibration,alignment,alignmentSource,
              orientationConflict:false,autoUsable:false,
              timings:{moondreamPointMs,totalLocalizationMs:Date.now()-fastStartedAt},
              reason
            },
            requestContext:{
              face:context.container_face,lengthFt:context.length_ft,isoCode:context.observed_iso_code,
              fixedCameraId:fixedCamera.id,fixedCameraFace:fixedCamera.face,
              calibrationAvailable:Boolean(calibration.available),calibrationVersion:calibration.calibrationVersion??null,
              alignmentStatus:alignment.status,alignmentSource,
              localizationSource:"MOONDREAM_POINT_FAST_MISS",fastPointOnly:true
            }
          });
          return {
            found:false,model:pointed.model,predictionId:prediction.predictionId,
            point:null,damageBox:null,localizationSource:"MOONDREAM_POINT_FAST_MISS",
            referenceBox:alignmentReferenceBox,referenceSource:"FIXED_CAMERA_CALIBRATION",
            doorEndDetection:fixedDoorEndDetection,doorBox:null,faceVerification:fixedFaceVerification,
            fixedCameraId:fixedCamera.id,fixedCameraFace:fixedCamera.face,calibration,alignment,alignmentSource,
            orientationConflict:false,autoUsable:false,
            timings:{moondreamPointMs,totalLocalizationMs:Date.now()-fastStartedAt},
            location:{code:null,reviewRequired:true,reason}
          };
        }

        const damageBox=contextBoxAroundPoint(point);
        if(!calibration.available){
          const reason="Fixed Camera "+fixedCamera.id+" calibration is not configured for this container geometry.";
          const prediction=await this.repo.saveLocationPrediction({
            findingId:input.findingId,surveyId:context.survey_id,modelName:pointed.model,
            selectedCode:null,status:"FAILED",
            response:{
              found:true,point,damageBox,localizationSource:"MOONDREAM_POINT_FAST",
              referenceBox:alignmentReferenceBox,referenceSource:"FIXED_CAMERA_CALIBRATION",
              doorEndDetection:fixedDoorEndDetection,doorBox:null,faceVerification:fixedFaceVerification,
              fixedCameraId:fixedCamera.id,fixedCameraFace:fixedCamera.face,calibration,alignment,alignmentSource,
              orientationConflict:false,autoUsable:false,
              timings:{moondreamPointMs,totalLocalizationMs:Date.now()-fastStartedAt},reason
            },
            requestContext:{
              face:context.container_face,lengthFt:context.length_ft,isoCode:context.observed_iso_code,
              fixedCameraId:fixedCamera.id,fixedCameraFace:fixedCamera.face,
              calibrationAvailable:false,calibrationVersion:calibration.calibrationVersion??null,
              alignmentStatus:alignment.status,alignmentSource,
              localizationSource:"MOONDREAM_POINT_FAST",fastPointOnly:true
            }
          });
          return {
            found:true,model:pointed.model,predictionId:prediction.predictionId,
            point,damageBox,localizationSource:"MOONDREAM_POINT_FAST",
            referenceBox:alignmentReferenceBox,referenceSource:"FIXED_CAMERA_CALIBRATION",
            doorEndDetection:fixedDoorEndDetection,doorBox:null,faceVerification:fixedFaceVerification,
            fixedCameraId:fixedCamera.id,fixedCameraFace:fixedCamera.face,calibration,alignment,alignmentSource,
            orientationConflict:false,autoUsable:false,
            timings:{moondreamPointMs,totalLocalizationMs:Date.now()-fastStartedAt},
            location:{code:null,reviewRequired:true,reason}
          };
        }

        const calculated=await calibrationService.calculate({
          findingId:input.findingId,
          cameraId:fixedCamera.id,
          damagePoint:point,
          alignmentReferenceBox,
          requireAlignment:true
        });
        const selectedCode=calculated.code??null;
        const reviewRequired=Boolean(calculated.reviewRequired||!selectedCode);
        const reason=calculated.reason??"Calculated from fixed-camera calibration and the fast Moondream damage pinpoint.";
        const totalLocalizationMs=Date.now()-fastStartedAt;
        const response={
          found:true,point,damageBox,localizationSource:"MOONDREAM_POINT_FAST",
          referenceBox:alignmentReferenceBox,referenceSource:"FIXED_CAMERA_CALIBRATION",
          doorEndDetection:fixedDoorEndDetection,doorBox:null,faceVerification:fixedFaceVerification,
          fixedCameraId:fixedCamera.id,fixedCameraFace:fixedCamera.face,calibration,alignment,alignmentSource,
          orientationConflict:false,autoUsable:Boolean(selectedCode),
          timings:{moondreamPointMs,totalLocalizationMs},
          location:{...calculated,code:selectedCode,reviewRequired,reason}
        };
        const prediction=await this.repo.saveLocationPrediction({
          findingId:input.findingId,surveyId:context.survey_id,modelName:pointed.model,
          selectedCode,status:selectedCode?(reviewRequired?"REVIEW_REQUIRED":"SUGGESTED"):"FAILED",
          response,
          requestContext:{
            face:context.container_face,lengthFt:context.length_ft,isoCode:context.observed_iso_code,
            fixedCameraId:fixedCamera.id,fixedCameraFace:fixedCamera.face,
            calibrationAvailable:true,calibrationVersion:calibration.calibrationVersion,
            alignmentStatus:alignment.status,alignmentSource,
            localizationSource:"MOONDREAM_POINT_FAST",fastPointOnly:true,
            moondreamPointMs
          }
        });
        return {...response,model:pointed.model,predictionId:prediction.predictionId};
      }

      const located=await this.marker.locateOverview(
        input.file,
        context.container_face,
        null,
        {skipDoorDetection:true,skipReferenceDetection:!calibration.available}
      );
      const aiReferenceBox=located.referenceBox??null;
      const edgeReferenceBox=capture.fixedAlignmentReferenceBox;
      const rank=(status:string)=>status==="GREEN"?4:status==="AMBER"?3:status==="RED"?1:status==="UNVERIFIED"?0:-1;
      const aiAlignment=aiReferenceBox
        ?await calibrationService.alignment(input.findingId,fixedCamera.id,aiReferenceBox)
        :null;
      const edgeAlignment=edgeReferenceBox
        ?await calibrationService.alignment(input.findingId,fixedCamera.id,edgeReferenceBox)
        :null;
      let alignmentReferenceBox=aiReferenceBox??edgeReferenceBox??null;
      let alignment=aiAlignment??edgeAlignment??await calibrationService.alignment(input.findingId,fixedCamera.id,null);
      let alignmentSource=aiAlignment?"AI_FACE":edgeAlignment?(capture.fixedAlignmentSource??"FIXED_GEOMETRY_EDGE"):"NONE";
      if(edgeAlignment&&rank(edgeAlignment.status)>rank(alignment.status)){
        alignment=edgeAlignment;
        alignmentReferenceBox=edgeReferenceBox;
        alignmentSource=capture.fixedAlignmentSource??"FIXED_GEOMETRY_EDGE";
      }
      const sideFace=context.container_face==="LEFT"||context.container_face==="RIGHT";
      const fixedFaceVerification=sideFace
        ?{
            selectedFace:context.container_face,
            detectedFace:context.container_face as "LEFT"|"RIGHT",
            confidence:1,
            status:"MATCH" as const,
            evidence:"FIXED_CAMERA_PROFILE" as const,
            reason:"Container face and orientation come from the fixed POC camera profile."
          }
        :{
            selectedFace:context.container_face,
            detectedFace:null,
            confidence:1,
            status:"UNVERIFIED" as const,
            evidence:null,
            reason:"Container face and orientation come from the fixed POC camera profile."
          };
      const fixedDoorEndDetection={
        visible:false,
        side:fixedCamera.doorEndInImage,
        confidence:1,
        expectedSide:fixedCamera.doorEndInImage,
        matchesSelectedFace:true,
        suggestedFace:sideFace?context.container_face as "LEFT"|"RIGHT":null,
        doorDominant:false,
        reason:fixedCamera.doorEndInImage
          ?"Longitudinal orientation comes from fixed Camera "+fixedCamera.id+"."
          :"Face orientation comes from fixed Camera "+fixedCamera.id+"."
      };

      const detectedDamageCandidates=Array.isArray(located.damageCandidates)
        ?located.damageCandidates
        :located.damageBox?[located.damageBox]:[];
      let damageBox=located.damageBox??null;
      let pointFallback:NormalizedPoint|null=null;
      let localizationSource:
        "DETECT_BOX"|"QWEN_PRIMARY_BOX"|"QWEN_PRIMARY_OVERRIDE_POINT"|"POINT_FALLBACK"|"QWEN_POINT_FALLBACK"
        ="DETECT_BOX";
      let pointFallbackModel:string|null=null;
      let pointFallbackConfidence:number|null=null;
      let pointFallbackReason:string|null=null;
      let primaryReviewAttempted=false;
      let moondreamPointAttempted=false;
      let primarySelectorModel:string|null=null;
      let primarySelectorDecision:string|null=null;
      let primarySelectorConfidence:number|null=null;
      let primarySelectorPriorityClass:string|null=null;
      let primarySelectorReason:string|null=null;
      let selectedCandidateIndex:number|null=null;

      primaryReviewAttempted=true;
      try{
        const primary=await this.marker.selectPrimaryOverviewDamage(
          input.file,
          context.container_face,
          detectedDamageCandidates
        );
        primarySelectorModel=primary.model;
        primarySelectorDecision=primary.decision;
        primarySelectorConfidence=primary.confidence;
        primarySelectorPriorityClass=primary.priorityClass;
        primarySelectorReason=primary.reason||null;
        selectedCandidateIndex=primary.selectedCandidateIndex;
        if(primary.found&&primary.decision==="CANDIDATE"&&primary.geometry&&"width" in primary.geometry){
          damageBox=primary.geometry;
          localizationSource="QWEN_PRIMARY_BOX";
        }else if(primary.found&&primary.decision==="OVERRIDE_POINT"&&primary.geometry&&!("width" in primary.geometry)){
          pointFallback=primary.geometry;
          damageBox=contextBoxAroundPoint(pointFallback);
          localizationSource="QWEN_PRIMARY_OVERRIDE_POINT";
        }else{
          damageBox=null;
        }
      }catch(error){
        primarySelectorDecision="ERROR";
        primarySelectorReason=error instanceof Error?error.message:"Primary-damage selector unavailable.";
        localizationSource="DETECT_BOX";
      }

      if(!damageBox){
        const skipMoondreamPoint=primaryReviewAttempted&&primarySelectorDecision==="NONE";
        if(!skipMoondreamPoint)moondreamPointAttempted=true;
        const pointed=skipMoondreamPoint
          ?{found:false,model:located.model,geometry:null}
          :await this.marker.pointOverview(input.file,context.container_face);
        if(pointed.found&&pointed.geometry){
          pointFallback=pointed.geometry;
          damageBox=contextBoxAroundPoint(pointFallback);
          localizationSource="POINT_FALLBACK";
          pointFallbackModel=pointed.model;
        }else{
          const reasoned=await this.marker.reasonedPointOverview(input.file,context.container_face);
          pointFallbackModel=reasoned.model;
          pointFallbackConfidence=reasoned.confidence;
          pointFallbackReason=reasoned.reason||null;
          if(reasoned.found&&reasoned.geometry){
            pointFallback=reasoned.geometry;
            damageBox=contextBoxAroundPoint(pointFallback);
            localizationSource="QWEN_POINT_FALLBACK";
          }else{
          const reason=calibration.available
            ?"Fixed Camera "+fixedCamera.id+" calibration is loaded. AI could not detect, pinpoint or reason to a visible damage area, including the Qwen full-overview primary-damage search; manual marking is now the fallback."
            :"Fixed Camera "+fixedCamera.id+" calibration is not configured for this container size. Run the one-time admin calibration before automatic location.";
          const prediction=await this.repo.saveLocationPrediction({
            findingId:input.findingId,
            surveyId:context.survey_id,
            modelName:pointFallbackModel??primarySelectorModel??located.model,
            selectedCode:null,
            status:"FAILED",
            response:{
              found:false,
              damageBox:null,
              point:null,
              localizationSource:"NONE",
              detectAttempted:true,
              pointFallbackAttempted:true,
              pointFallbackFound:false,
              qwenFallbackAttempted:true,
              qwenFallbackFound:false,
              qwenFallbackModel:pointFallbackModel,
              qwenFallbackConfidence:pointFallbackConfidence,
              qwenFallbackReason:pointFallbackReason,
              damageCandidates:detectedDamageCandidates,
              primaryDamageSelection:{
                attempted:primaryReviewAttempted,
                model:primarySelectorModel,
                decision:primarySelectorDecision,
                confidence:primarySelectorConfidence,
                priorityClass:primarySelectorPriorityClass,
                reason:primarySelectorReason,
                selectedCandidateIndex
              },
              referenceBox:alignmentReferenceBox,
              referenceSource:"FIXED_CAMERA_CALIBRATION",
              geometryScore:null,
              doorEndDetection:fixedDoorEndDetection,
              doorBox:null,
              faceVerification:fixedFaceVerification,
              fixedCameraId:fixedCamera.id,
              fixedCameraFace:fixedCamera.face,
              calibration,
              alignment,
              alignmentSource,
              orientationConflict:false,
              autoUsable:false,
              reason
            },
            requestContext:{
              face:context.container_face,
              lengthFt:context.length_ft,
              isoCode:context.observed_iso_code,
              captureSource:capture.source,
              measurementQuality:capture.measurementQuality,
              referenceSource:"FIXED_CAMERA_CALIBRATION",
              fixedCameraId:fixedCamera.id,
              fixedCameraFace:fixedCamera.face,
              calibrationAvailable:Boolean(calibration.available),
              calibrationVersion:calibration.calibrationVersion??null,
              alignmentStatus:alignment.status,
              alignmentSource,
              fixedAlignmentConfidence:capture.fixedAlignmentConfidence,
              orientationConflict:false,
              localizationSource:"NONE",
              primaryReviewAttempted,
              primaryCandidateCount:detectedDamageCandidates.length,
              primarySelectorModel,
              primarySelectorDecision,
              primarySelectorConfidence,
              primarySelectorPriorityClass,
              primarySelectorReason,
              selectedCandidateIndex,
              moondreamPointAttempted,
              pointFallbackAttempted:moondreamPointAttempted,
              qwenFallbackAttempted:true
            }
          });
          return {
            found:false,
            model:pointFallbackModel??primarySelectorModel??located.model,
            predictionId:prediction.predictionId,
            point:null,
            damageBox:null,
            localizationSource:"NONE",
            pointFallbackAttempted:moondreamPointAttempted,
            pointFallbackFound:false,
            qwenFallbackAttempted:true,
            qwenFallbackFound:false,
            qwenFallbackModel:pointFallbackModel,
            qwenFallbackConfidence:pointFallbackConfidence,
            qwenFallbackReason:pointFallbackReason,
            damageCandidates:detectedDamageCandidates,
            primaryDamageSelection:{
              attempted:primaryReviewAttempted,
              model:primarySelectorModel,
              decision:primarySelectorDecision,
              confidence:primarySelectorConfidence,
              priorityClass:primarySelectorPriorityClass,
              reason:primarySelectorReason,
              selectedCandidateIndex
            },
            referenceBox:alignmentReferenceBox,
            referenceSource:"FIXED_CAMERA_CALIBRATION",
            geometryScore:null,
            doorEndDetection:fixedDoorEndDetection,
            doorBox:null,
            faceVerification:fixedFaceVerification,
            fixedCameraId:fixedCamera.id,
            fixedCameraFace:fixedCamera.face,
            calibration,
            alignment,
            alignmentSource,
            orientationConflict:false,
            autoUsable:false,
            location:{code:null,reviewRequired:true,reason}
          };
          }
        }
      }

      const resolvedDamageBox=damageBox;
      if(!resolvedDamageBox)throw new Error("Automatic damage localization did not produce a usable target.");
      const point=pointFallback??{
        x:resolvedDamageBox.x+resolvedDamageBox.width/2,
        y:resolvedDamageBox.y+resolvedDamageBox.height/2
      };
      const localizationModel=pointFallbackModel??primarySelectorModel??located.model;
      if(!calibration.available){
        const reason="Fixed Camera "+fixedCamera.id+" calibration is not configured for "+
          calibration.lengthFt+" ft / "+calibration.heightMm+" mm geometry. Run the one-time admin calibration before automatic CEDEX location.";
        const prediction=await this.repo.saveLocationPrediction({
          findingId:input.findingId,
          surveyId:context.survey_id,
          modelName:localizationModel,
          selectedCode:null,
          status:"FAILED",
          response:{
            found:true,damageBox:resolvedDamageBox,point,localizationSource,pointFallbackModel,pointFallbackConfidence,pointFallbackReason,
            damageCandidates:detectedDamageCandidates,
            primaryDamageSelection:{
              attempted:primaryReviewAttempted,model:primarySelectorModel,decision:primarySelectorDecision,
              confidence:primarySelectorConfidence,priorityClass:primarySelectorPriorityClass,
              reason:primarySelectorReason,selectedCandidateIndex
            },
            referenceBox:alignmentReferenceBox,
            referenceSource:"FIXED_CAMERA_CALIBRATION",geometryScore:null,
            doorEndDetection:fixedDoorEndDetection,doorBox:null,faceVerification:fixedFaceVerification,
            fixedCameraId:fixedCamera.id,fixedCameraFace:fixedCamera.face,calibration,
            alignment,
            alignmentSource,
            orientationConflict:false,autoUsable:false,reason
          },
          requestContext:{
            face:context.container_face,lengthFt:context.length_ft,isoCode:context.observed_iso_code,
            captureSource:capture.source,measurementQuality:capture.measurementQuality,
            referenceSource:"FIXED_CAMERA_CALIBRATION",fixedCameraId:fixedCamera.id,fixedCameraFace:fixedCamera.face,
            calibrationAvailable:false,calibrationVersion:calibration.calibrationVersion??null,alignmentStatus:alignment.status,orientationConflict:false,
            localizationSource,
            primaryReviewAttempted,
            primaryCandidateCount:detectedDamageCandidates.length,
            primarySelectorModel,
            primarySelectorDecision,
            primarySelectorConfidence,
            primarySelectorPriorityClass,
            primarySelectorReason,
            selectedCandidateIndex,
            primarySelectionUsed:["QWEN_PRIMARY_BOX","QWEN_PRIMARY_OVERRIDE_POINT"].includes(localizationSource),
            moondreamPointAttempted,
            pointFallbackUsed:localizationSource==="POINT_FALLBACK",
            qwenFallbackUsed:localizationSource==="QWEN_POINT_FALLBACK",
            pointFallbackConfidence,
            pointFallbackReason
          }
        });
        return {
          found:true,model:localizationModel,predictionId:prediction.predictionId,point,damageBox:resolvedDamageBox,localizationSource,pointFallbackModel,pointFallbackConfidence,pointFallbackReason,
          damageCandidates:detectedDamageCandidates,
          primaryDamageSelection:{
            attempted:primaryReviewAttempted,model:primarySelectorModel,decision:primarySelectorDecision,
            confidence:primarySelectorConfidence,priorityClass:primarySelectorPriorityClass,
            reason:primarySelectorReason,selectedCandidateIndex
          },
          referenceBox:alignmentReferenceBox,referenceSource:"FIXED_CAMERA_CALIBRATION",geometryScore:null,
          doorEndDetection:fixedDoorEndDetection,doorBox:null,faceVerification:fixedFaceVerification,
          fixedCameraId:fixedCamera.id,fixedCameraFace:fixedCamera.face,calibration,
            alignment,
          alignmentSource,
          orientationConflict:false,autoUsable:false,
          location:{code:null,reviewRequired:true,reason}
        };
      }

      const calculated=await calibrationService.calculate({
        findingId:input.findingId,
        cameraId:fixedCamera.id,
        damageBox:pointFallback?undefined:resolvedDamageBox,
        damagePoint:pointFallback??undefined,
        alignmentReferenceBox,
        requireAlignment:true
      });
      const selectedCode=calculated.code??null;
      const reason=calculated.reason??(
        localizationSource==="QWEN_PRIMARY_BOX"
          ?"Calculated from fixed-camera calibration after Qwen selected the primary physical damage from Moondream candidate regions."
          :localizationSource==="QWEN_PRIMARY_OVERRIDE_POINT"
            ?"Calculated from fixed-camera calibration after Qwen rejected lower-priority candidate marks and localized a stronger primary physical damage."
            :localizationSource==="POINT_FALLBACK"
              ?"Calculated from fixed-camera calibration and the automatic Moondream damage pinpoint fallback."
              :localizationSource==="QWEN_POINT_FALLBACK"
                ?"Calculated from fixed-camera calibration and the Qwen full-overview damage localization fallback."
                :"Calculated from fixed-camera calibration and the detected damage area."
      );
      const prediction=await this.repo.saveLocationPrediction({
        findingId:input.findingId,
        surveyId:context.survey_id,
        modelName:localizationModel,
        selectedCode,
        status:selectedCode?"REVIEW_REQUIRED":"FAILED",
        response:{
          found:true,damageBox:resolvedDamageBox,point,localizationSource,pointFallbackModel,pointFallbackConfidence,pointFallbackReason,
            damageCandidates:detectedDamageCandidates,
            primaryDamageSelection:{
              attempted:primaryReviewAttempted,model:primarySelectorModel,decision:primarySelectorDecision,
              confidence:primarySelectorConfidence,priorityClass:primarySelectorPriorityClass,
              reason:primarySelectorReason,selectedCandidateIndex
            },
            referenceBox:alignmentReferenceBox,
          referenceSource:"FIXED_CAMERA_CALIBRATION",geometryScore:null,
          doorEndDetection:fixedDoorEndDetection,doorBox:null,faceVerification:fixedFaceVerification,
          fixedCameraId:fixedCamera.id,fixedCameraFace:fixedCamera.face,calibration,
            alignment,
          alignmentSource,
          orientationConflict:false,autoUsable:Boolean(selectedCode),
          calculatedLocation:calculated,selectedCode,reviewRequired:true,reason
        },
        requestContext:{
          face:context.container_face,lengthFt:context.length_ft,isoCode:context.observed_iso_code,
          captureSource:capture.source,measurementQuality:capture.measurementQuality,
          referenceSource:"FIXED_CAMERA_CALIBRATION",fixedCameraId:fixedCamera.id,fixedCameraFace:fixedCamera.face,
          calibrationAvailable:true,calibrationVersion:calibration.calibrationVersion,alignmentStatus:alignment.status,orientationConflict:false,
          localizationSource,
          primaryReviewAttempted,
          primaryCandidateCount:detectedDamageCandidates.length,
          primarySelectorModel,
          primarySelectorDecision,
          primarySelectorConfidence,
          primarySelectorPriorityClass,
          primarySelectorReason,
          selectedCandidateIndex,
          primarySelectionUsed:["QWEN_PRIMARY_BOX","QWEN_PRIMARY_OVERRIDE_POINT"].includes(localizationSource),
          moondreamPointAttempted,
          pointFallbackUsed:localizationSource==="POINT_FALLBACK",
          qwenFallbackUsed:localizationSource==="QWEN_POINT_FALLBACK",
          pointFallbackConfidence,
          pointFallbackReason
        }
      });
      return {
        found:true,model:localizationModel,predictionId:prediction.predictionId,point,damageBox:resolvedDamageBox,localizationSource,pointFallbackModel,pointFallbackConfidence,pointFallbackReason,
        damageCandidates:detectedDamageCandidates,
        primaryDamageSelection:{
          attempted:primaryReviewAttempted,model:primarySelectorModel,decision:primarySelectorDecision,
          confidence:primarySelectorConfidence,priorityClass:primarySelectorPriorityClass,
          reason:primarySelectorReason,selectedCandidateIndex
        },
        referenceBox:alignmentReferenceBox,referenceSource:"FIXED_CAMERA_CALIBRATION",geometryScore:null,
        doorEndDetection:fixedDoorEndDetection,doorBox:null,faceVerification:fixedFaceVerification,
        fixedCameraId:fixedCamera.id,fixedCameraFace:fixedCamera.face,calibration,
            alignment,
        alignmentSource,
        orientationConflict:false,autoUsable:Boolean(selectedCode),
        location:{...calculated,code:selectedCode,reviewRequired:true,reason}
      };
    }

    const sideSupported=["LEFT","RIGHT"].includes(context.container_face);

    const located=await this.marker.locateOverview(
      input.file,
      context.container_face,
      capture.referenceFrame,
      {skipDoorDetection:false}
    );

    const referenceBox=located.referenceBox;
    const doorEndDetection=inferDoorEndDetection({
      selectedFace:context.container_face,
      doorBox:located.doorBox??null,
      referenceBox
    });
    const expected=expectedAspect(context.container_face,geometry);
    const score=geometryScore(referenceBox,input.imageWidth,input.imageHeight,expected);
    const guided=capture.referenceFrame!==null;
    const knownGeometryAvailable=expected!==null;
    const guidedQualityOk=!guided||["GOOD","USABLE"].includes(capture.measurementQuality);
    const galleryGeometryOk=guided||(score!==null&&score>=0.68);
    const faceVerification=fixedCameraMatches&&sideSupported
      ?{
          selectedFace:context.container_face,
          detectedFace:context.container_face as "LEFT"|"RIGHT",
          confidence:1,
          status:"MATCH" as const,
          evidence:"FIXED_CAMERA_PROFILE" as const,
          reason:"Container face and orientation come from the fixed POC camera profile."
        }
      :inferFaceVerification({
          selectedFace:context.container_face,
          door:doorEndDetection,
          hasSideReference:Boolean(referenceBox),
          geometryScore:score,
          guidedReference:guided
        });
    const orientationConflict=!fixedCameraMatches&&faceVerification.status==="MISMATCH";
    const autoUsable=Boolean(referenceBox)&&sideSupported&&knownGeometryAvailable&&guidedQualityOk&&galleryGeometryOk&&!orientationConflict;

    if(!located.found||!located.damageBox){
      const noDamageReason=!sideSupported
        ?"Automatic CEDEX location is enabled for fixed Cameras R/L in this POC. Enter the location manually for Camera "+(fixedCamera?.id??"—")+" / "+context.container_face+"."
        :orientationConflict
          ?faceVerification.reason+" Verify the camera/finding setup before calculating the location."
          :!referenceBox
            ?fixedCameraMatches
              ?"Fixed Camera "+fixedCamera!.id+" supplies face/orientation, but usable container geometry was not established from this overview."
              :doorEndDetection.doorDominant
                ?"Door end was detected, but no usable side-panel reference was found. Use a side overview with more side panel visible."
                :"Container face reference could not be established automatically."
            :!knownGeometryAvailable
              ?"Known container geometry is unavailable, so automatic CEDEX location is disabled. Enter the location manually."
              :!guidedQualityOk
                ?"Guided overview quality is too poor for automatic CEDEX location. Retake or enter the location manually."
                :!galleryGeometryOk
                  ?"Gallery overview perspective/geometry is too distorted for reliable automatic CEDEX location. Mark the four face corners or enter the location manually."
                  :"Container geometry is ready. Mark the damaged position to calculate the CEDEX location.";
      const prediction=await this.repo.saveLocationPrediction({
        findingId:input.findingId,
        surveyId:context.survey_id,
        modelName:located.model,
        selectedCode:null,
        status:"FAILED",
        response:{
          found:false,
          damageBox:null,
          referenceBox,
          referenceSource:fixedCameraMatches?(guided?"FIXED_CAMERA_GUIDED_FRAME":"FIXED_CAMERA_AI_GEOMETRY"):guided?"GUIDED_FRAME":"AI_FACE",
          geometryScore:score,
          doorEndDetection,
          doorBox:located.doorBox??null,
          faceVerification,
          fixedCameraId:fixedCamera?.id??null,
          fixedCameraFace:fixedCamera?.face??null,
          orientationConflict,
          autoUsable,
          reason:noDamageReason
        },
        requestContext:{
          face:context.container_face,
          lengthFt:context.length_ft,
          isoCode:context.observed_iso_code,
          captureSource:capture.source,
          measurementQuality:capture.measurementQuality,
          referenceSource:fixedCameraMatches?(guided?"FIXED_CAMERA_GUIDED_FRAME":"FIXED_CAMERA_AI_GEOMETRY"):guided?"GUIDED_FRAME":"AI_FACE",
          detectedDoorEnd:doorEndDetection.side,
          doorOrientationConfidence:doorEndDetection.confidence,
          aiDetectedFace:faceVerification.detectedFace,
          aiFaceConfidence:faceVerification.confidence,
          aiFaceVerificationStatus:faceVerification.status,
          fixedCameraId:fixedCamera?.id??null,
          fixedCameraFace:fixedCamera?.face??null,
          orientationConflict
        }
      });
      return {
        found:false,
        model:located.model,
        predictionId:prediction.predictionId,
        point:null,
        damageBox:null,
        referenceBox,
        referenceSource:fixedCameraMatches?(guided?"FIXED_CAMERA_GUIDED_FRAME":"FIXED_CAMERA_AI_GEOMETRY"):guided?"GUIDED_FRAME":"AI_FACE",
        geometryScore:score,
        doorEndDetection,
        doorBox:located.doorBox??null,
        faceVerification,
        fixedCameraId:fixedCamera?.id??null,
        fixedCameraFace:fixedCamera?.face??null,
        orientationConflict,
        autoUsable,
        location:{code:null,reviewRequired:true,reason:noDamageReason}
      };
    }

    const point={
      x:located.damageBox.x+located.damageBox.width/2,
      y:located.damageBox.y+located.damageBox.height/2
    };

    const calculated=referenceBox?suggestCedexLocation({
      face:context.container_face as SurveyFace,
      lengthFt:Number(context.length_ft)||40,
      damageBox:located.damageBox,
      referenceBox
    }):null;

    const selectedCode=autoUsable?calculated?.code??null:null;
    const reviewRequired=
      !autoUsable||
      faceVerification.status!=="MATCH"||
      Boolean(calculated?.reviewRequired)||
      (guided&&capture.measurementQuality!=="GOOD")||
      (!guided&&score!==null&&score<0.82);

    const reason=orientationConflict
      ?faceVerification.reason+" Verify the camera/finding setup before accepting the CEDEX location."
      :fixedCameraMatches&&referenceBox
        ?calculated?.reason??"Calculated from fixed camera face/orientation and overview geometry."
      :faceVerification.status==="UNVERIFIED"&&referenceBox&&galleryGeometryOk
        ?"AI could not independently verify the surveyed face. CEDEX location is calculated from the selected face and usable geometry; surveyor confirmation is required."
      :!referenceBox
        ?doorEndDetection.doorDominant
          ?"Door end was detected, but no usable side-panel reference was found. Use a side overview with the side panel visible, or mark the four side-face corners."
          :"Container face reference could not be established automatically. Mark the four face corners to continue automatic CEDEX location calculation."
        :!knownGeometryAvailable
          ?"Known container geometry is unavailable, so automatic CEDEX location is disabled. Enter the location manually."
          :!guidedQualityOk
            ?"Guided overview quality is too poor for automatic CEDEX location. Retake or enter the location manually."
            :!galleryGeometryOk
              ?"Gallery overview perspective/geometry is too distorted for reliable automatic CEDEX location. Mark the four face corners or enter the location manually."
              :calculated?.reason??"Automatic location is unavailable for this container face.";

    const prediction=await this.repo.saveLocationPrediction({
      findingId:input.findingId,
      surveyId:context.survey_id,
      modelName:located.model,
      selectedCode,
      status:selectedCode?"REVIEW_REQUIRED":"FAILED",
      response:{
        found:true,
        damageBox:located.damageBox,
        point,
        referenceBox,
        referenceSource:fixedCameraMatches?(guided?"FIXED_CAMERA_GUIDED_FRAME":"FIXED_CAMERA_AI_GEOMETRY"):guided?"GUIDED_FRAME":"AI_FACE",
        geometryScore:score,
        doorEndDetection,
        doorBox:located.doorBox??null,
        faceVerification,
        fixedCameraId:fixedCamera?.id??null,
        fixedCameraFace:fixedCamera?.face??null,
        orientationConflict,
        calculatedLocation:calculated,
        selectedCode,
        reviewRequired,
        reason
      },
      requestContext:{
        face:context.container_face,
        lengthFt:context.length_ft,
        isoCode:context.observed_iso_code,
        captureSource:capture.source,
        measurementQuality:capture.measurementQuality,
        referenceSource:fixedCameraMatches?(guided?"FIXED_CAMERA_GUIDED_FRAME":"FIXED_CAMERA_AI_GEOMETRY"):guided?"GUIDED_FRAME":"AI_FACE",
        detectedDoorEnd:doorEndDetection.side,
        doorOrientationConfidence:doorEndDetection.confidence,
        aiDetectedFace:faceVerification.detectedFace,
        aiFaceConfidence:faceVerification.confidence,
        aiFaceVerificationStatus:faceVerification.status,
        fixedCameraId:fixedCamera?.id??null,
        fixedCameraFace:fixedCamera?.face??null,
        orientationConflict
      }
    });

    return {
      found:true,
      model:located.model,
      predictionId:prediction.predictionId,
      point,
      damageBox:located.damageBox,
      referenceBox,
      referenceSource:fixedCameraMatches?(guided?"FIXED_CAMERA_GUIDED_FRAME":"FIXED_CAMERA_AI_GEOMETRY"):guided?"GUIDED_FRAME":"AI_FACE",
      geometryScore:score,
      doorEndDetection,
      doorBox:located.doorBox??null,
      faceVerification,
      orientationConflict,
      autoUsable,
      location:calculated?{
        ...calculated,
        code:selectedCode,
        reviewRequired,
        reason
      }:null
    };
  }

  async fromFaceQuad(input:{
    findingId:string;
    corners:FaceQuad;
    doorEnd:DoorEndSide;
    damagePoint?:NormalizedPoint|null;
    damageBox?:NormalizedBox|null;
  }){
    const context=await this.repo.findingContext(input.findingId);
    if(!context)throw new Error("Finding not found.");
    if(context.container_face!=="LEFT"&&context.container_face!=="RIGHT"){
      throw new Error("Manual four-corner face mapping is currently supported for LEFT/RIGHT side findings.");
    }
    if(input.doorEnd!=="LEFT"&&input.doorEnd!=="RIGHT")throw new Error("Select which side of the photo contains the door end.");
    const expectedDoorEnd=context.container_face==="RIGHT"?"LEFT":"RIGHT";
    if(input.doorEnd!==expectedDoorEnd){
      const suggestedFace=input.doorEnd==="LEFT"?"RIGHT":"LEFT";
      throw new Error("Door-end orientation conflicts with the selected "+context.container_face+" side. The photo orientation suggests "+suggestedFace+" side; verify the finding face before calculating CEDEX location.");
    }
    if(!Array.isArray(input.corners)||input.corners.length!==4||!isValidFaceQuad(input.corners)){
      throw new Error("Mark the four container-face corners in order: top-left, top-right, bottom-right, bottom-left.");
    }

    let normalizedDamage:NormalizedBox;
    let normalizedPoint:NormalizedPoint|null=null;
    let markType:"BOX"|"POINT";
    if(input.damageBox){
      const damage=normalizedBox(input.damageBox);
      if(!damage)throw new Error("Invalid damage area.");
      normalizedDamage=mapBoxToFace(damage,input.corners,input.doorEnd);
      normalizedPoint={
        x:normalizedDamage.x+normalizedDamage.width/2,
        y:normalizedDamage.y+normalizedDamage.height/2
      };
      markType="BOX";
    }else if(input.damagePoint){
      if(![input.damagePoint.x,input.damagePoint.y].every(Number.isFinite)||input.damagePoint.x<0||input.damagePoint.x>1||input.damagePoint.y<0||input.damagePoint.y>1){
        throw new Error("Invalid damage point.");
      }
      normalizedPoint=mapPointToFace(input.damagePoint,input.corners,input.doorEnd);
      const tiny=1e-6;
      normalizedDamage={
        x:Math.max(0,normalizedPoint.x-tiny/2),
        y:Math.max(0,normalizedPoint.y-tiny/2),
        width:tiny,
        height:tiny
      };
      markType="POINT";
    }else{
      throw new Error("Mark the damage area or damage point first.");
    }

    const result=suggestCedexLocationOnNormalizedSide({
      face:context.container_face,
      lengthFt:Number(context.length_ft)||40,
      damageBox:normalizedDamage
    });

    return {
      ...result,
      referenceSource:"SURVEYOR_FACE_QUAD",
      markType,
      doorEnd:input.doorEnd,
      normalizedDamageBox:normalizedDamage,
      normalizedPoint
    };
  }

  async fromBox(input:{
    findingId:string;
    damageBox:NormalizedBox;
    referenceBox:NormalizedBox;
  }){
    const context=await this.repo.findingContext(input.findingId);
    if(!context)throw new Error("Finding not found.");
    const damage=normalizedBox(input.damageBox);
    if(!damage)throw new Error("Invalid damage area.");
    const reference=normalizedBox(input.referenceBox);
    if(!reference)throw new Error("Invalid overview reference frame.");
    return suggestCedexLocation({
      face:context.container_face as SurveyFace,
      lengthFt:Number(context.length_ft)||40,
      damageBox:damage,
      referenceBox:reference
    });
  }

  async fromPoint(input:{
    findingId:string;
    point:NormalizedPoint;
    referenceBox:NormalizedBox;
  }){
    const context=await this.repo.findingContext(input.findingId);
    if(!context)throw new Error("Finding not found.");
    if(![input.point.x,input.point.y].every(Number.isFinite)||input.point.x<0||input.point.x>1||input.point.y<0||input.point.y>1){
      throw new Error("Invalid damage point.");
    }
    const reference=normalizedBox(input.referenceBox);
    if(!reference)throw new Error("Invalid overview reference frame.");
    return suggestCedexLocationFromPoint({
      face:context.container_face as SurveyFace,
      lengthFt:Number(context.length_ft)||40,
      point:input.point,
      referenceBox:reference
    });
  }
}
