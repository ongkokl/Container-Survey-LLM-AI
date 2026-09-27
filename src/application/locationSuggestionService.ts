import {
  suggestCedexLocation,
  suggestCedexLocationFromPoint,
  type NormalizedBox,
  type NormalizedPoint,
  type SurveyFace
} from "../domain/container/locationCode";
import { CedexRepository } from "../infrastructure/d1/cedexRepository";
import { MoondreamDamageMarker } from "../infrastructure/ai/moondreamDamageMarker";

type CaptureMetadata={
  source?:unknown;
  measurementQuality?:unknown;
  referenceFrame?:unknown;
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
    return {source:"unknown",measurementQuality:"UNKNOWN",referenceFrame:null as NormalizedBox|null};
  }
  const meta=value as CaptureMetadata;
  const source=typeof meta.source==="string"?meta.source.toLowerCase():"unknown";
  const measurementQuality=typeof meta.measurementQuality==="string"?meta.measurementQuality.toUpperCase():"UNKNOWN";
  const referenceFrame=source==="guided_camera"?normalizedBox(meta.referenceFrame):null;
  return {source,measurementQuality,referenceFrame};
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
    const located=await this.marker.locateOverview(
      input.file,
      context.container_face,
      capture.referenceFrame
    );

    const referenceBox=located.referenceBox;
    const expected=expectedAspect(context.container_face,geometry);
    const score=geometryScore(referenceBox,input.imageWidth,input.imageHeight,expected);
    const guided=capture.referenceFrame!==null;
    const sideSupported=["LEFT","RIGHT"].includes(context.container_face);
    const knownGeometryAvailable=expected!==null;
    const guidedQualityOk=!guided||["GOOD","USABLE"].includes(capture.measurementQuality);
    const galleryGeometryOk=guided||(score!==null&&score>=0.68);
    const autoUsable=Boolean(referenceBox)&&sideSupported&&knownGeometryAvailable&&guidedQualityOk&&galleryGeometryOk;

    if(!located.found||!located.damageBox){
      const noDamageReason=!sideSupported
        ?"Automatic CEDEX location is enabled for LEFT/RIGHT side overviews in this POC. Enter the location manually for this face."
        :!referenceBox
          ?"Container face reference could not be established. Mark the damage and enter the CEDEX location manually."
          :!knownGeometryAvailable
            ?"Known container geometry is unavailable, so automatic CEDEX location is disabled. Enter the location manually."
            :!guidedQualityOk
              ?"Guided overview quality is too poor for automatic CEDEX location. Retake or enter the location manually."
              :!galleryGeometryOk
                ?"Gallery overview perspective/geometry is too distorted for reliable automatic CEDEX location. Enter the location manually."
                :"Container geometry is ready. Tap the damaged position to calculate the CEDEX location.";
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
          referenceSource:guided?"GUIDED_FRAME":"AI_FACE",
          geometryScore:score,
          autoUsable,
          reason:noDamageReason
        },
        requestContext:{
          face:context.container_face,
          lengthFt:context.length_ft,
          isoCode:context.observed_iso_code,
          captureSource:capture.source,
          measurementQuality:capture.measurementQuality,
          referenceSource:guided?"GUIDED_FRAME":"AI_FACE"
        }
      });
      return {
        found:false,
        model:located.model,
        predictionId:prediction.predictionId,
        point:null,
        damageBox:null,
        referenceBox,
        referenceSource:guided?"GUIDED_FRAME":"AI_FACE",
        geometryScore:score,
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
      Boolean(calculated?.reviewRequired)||
      (guided&&capture.measurementQuality!=="GOOD")||
      (!guided&&score!==null&&score<0.82);

    const reason=!referenceBox
      ?"Container face reference could not be established. Mark the damage and enter the CEDEX location manually."
      :!knownGeometryAvailable
        ?"Known container geometry is unavailable, so automatic CEDEX location is disabled. Enter the location manually."
        :!guidedQualityOk
          ?"Guided overview quality is too poor for automatic CEDEX location. Retake or enter the location manually."
          :!galleryGeometryOk
            ?"Gallery overview perspective/geometry is too distorted for reliable automatic CEDEX location. Enter the location manually."
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
        referenceSource:guided?"GUIDED_FRAME":"AI_FACE",
        geometryScore:score,
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
        referenceSource:guided?"GUIDED_FRAME":"AI_FACE"
      }
    });

    return {
      found:true,
      model:located.model,
      predictionId:prediction.predictionId,
      point,
      damageBox:located.damageBox,
      referenceBox,
      referenceSource:guided?"GUIDED_FRAME":"AI_FACE",
      geometryScore:score,
      autoUsable,
      location:calculated?{
        ...calculated,
        code:selectedCode,
        reviewRequired,
        reason
      }:null
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
