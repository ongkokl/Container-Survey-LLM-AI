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

type CaptureMetadata={
  source?:unknown;
  measurementQuality?:unknown;
  referenceFrame?:unknown;
  fixedCameraMode?:unknown;
  fixedCameraId?:unknown;
  fixedCameraFace?:unknown;
  fixedDoorEndInImage?:unknown;
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
    return {source:"unknown",measurementQuality:"UNKNOWN",referenceFrame:null as NormalizedBox|null,fixedCameraMode:false,fixedCameraId:null as string|null};
  }
  const meta=value as CaptureMetadata;
  const source=typeof meta.source==="string"?meta.source.toLowerCase():"unknown";
  const measurementQuality=typeof meta.measurementQuality==="string"?meta.measurementQuality.toUpperCase():"UNKNOWN";
  const referenceFrame=source==="guided_camera"?normalizedBox(meta.referenceFrame):null;
  const fixedCameraMode=meta.fixedCameraMode===true;
  const fixedCameraId=typeof meta.fixedCameraId==="string"?meta.fixedCameraId.toUpperCase():null;
  return {source,measurementQuality,referenceFrame,fixedCameraMode,fixedCameraId};
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
  }){
    const context=await this.repo.findingContext(input.findingId);
    if(!context)throw new Error("Finding not found.");
    const geometry=await this.repo.geometryForFinding(input.findingId);
    const capture=captureInfo(input.captureMetadata);
    const fixedCamera=capture.fixedCameraMode?fixedCameraProfile(capture.fixedCameraId):null;
    const fixedCameraMatches=Boolean(fixedCamera&&fixedCamera.face===context.container_face);
    const located=await this.marker.locateOverview(
      input.file,
      context.container_face,
      capture.referenceFrame,
      {skipDoorDetection:fixedCameraMatches}
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
    const sideSupported=["LEFT","RIGHT"].includes(context.container_face);
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
          referenceSource:fixedCameraMatches?"FIXED_CAMERA":guided?"GUIDED_FRAME":"AI_FACE",
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
          referenceSource:fixedCameraMatches?"FIXED_CAMERA":guided?"GUIDED_FRAME":"AI_FACE",
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
        referenceSource:fixedCameraMatches?"FIXED_CAMERA":guided?"GUIDED_FRAME":"AI_FACE",
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
        referenceSource:fixedCameraMatches?"FIXED_CAMERA":guided?"GUIDED_FRAME":"AI_FACE",
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
        referenceSource:fixedCameraMatches?"FIXED_CAMERA":guided?"GUIDED_FRAME":"AI_FACE",
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
      referenceSource:fixedCameraMatches?"FIXED_CAMERA":guided?"GUIDED_FRAME":"AI_FACE",
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
