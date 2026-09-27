export type SurveyFace = "LEFT" | "RIGHT" | "FRONT" | "DOOR" | "ROOF" | "FLOOR";

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LocationSuggestion {
  supported: boolean;
  code: string | null;
  reviewRequired: boolean;
  reason: string;
  face: SurveyFace;
  verticalSegment: "T" | "B" | "X" | null;
  firstSection: string | null;
  lastSection: string | null;
  relativeDamageBox: NormalizedBox | null;
}

const LOCATION_PATTERN=/^[BDEFILMNRTUX][BHLGRTX][0-9NX][0-9NX]$/;

function clamp01(value:number):number{
  return Math.max(0,Math.min(1,value));
}

function finiteBox(box:NormalizedBox):boolean{
  return [box.x,box.y,box.width,box.height].every(Number.isFinite)&&box.width>=0&&box.height>=0;
}

function sectionCode(index:number):string{
  return index===10?"0":String(index);
}

function sectionAt(fraction:number,count:number):number{
  const safe=Math.min(0.999999,Math.max(0,fraction));
  return Math.floor(safe*count)+1;
}

function relativeToReference(damage:NormalizedBox,reference:NormalizedBox):NormalizedBox|null{
  if(!finiteBox(damage)||!finiteBox(reference)||reference.width<=0||reference.height<=0)return null;
  const x1=(damage.x-reference.x)/reference.width;
  const y1=(damage.y-reference.y)/reference.height;
  const x2=(damage.x+damage.width-reference.x)/reference.width;
  const y2=(damage.y+damage.height-reference.y)/reference.height;
  if(x2<0||x1>1||y2<0||y1>1)return null;
  const left=clamp01(Math.min(x1,x2));
  const top=clamp01(Math.min(y1,y2));
  const right=clamp01(Math.max(x1,x2));
  const bottom=clamp01(Math.max(y1,y2));
  return {x:left,y:top,width:Math.max(0,right-left),height:Math.max(0,bottom-top)};
}

function verticalSegment(box:NormalizedBox):"T"|"B"|"X"{
  const top=box.y;
  const bottom=box.y+box.height;
  if(bottom<=0.5)return "T";
  if(top>=0.5)return "B";
  return "X";
}

function closeTo(value:number,target:number,tolerance=0.025):boolean{
  return Math.abs(value-target)<=tolerance;
}

function sideSuggestionFromRearRange(face:"LEFT"|"RIGHT",lengthFt:number,box:NormalizedBox,rearStart:number,rearEnd:number):LocationSuggestion{
  const count=lengthFt<=20?5:10;
  rearStart=clamp01(rearStart);
  rearEnd=clamp01(rearEnd);
  if(rearEnd<rearStart)[rearStart,rearEnd]=[rearEnd,rearStart];
  const first=sectionAt(rearStart,count);
  const last=sectionAt(Math.max(rearStart,rearEnd-1e-6),count);
  const segment=verticalSegment(box);

  const spansWholeLength=rearStart<=0.01&&rearEnd>=0.99;
  const thirdFourth=spansWholeLength
    ?"XX"
    : first===last
      ? sectionCode(first)+"N"
      : sectionCode(first)+sectionCode(last);

  const sectionBoundaryNear=[
    rearStart,
    rearEnd
  ].some(v=>{
    for(let i=1;i<count;i++){
      if(closeTo(v,i/count))return true;
    }
    return false;
  });
  const verticalBoundaryNear=closeTo(box.y,0.5)||closeTo(box.y+box.height,0.5);
  const reviewRequired=sectionBoundaryNear||verticalBoundaryNear;

  return {
    supported:true,
    code:(face==="LEFT"?"L":"R")+segment+thirdFourth,
    reviewRequired,
    reason:reviewRequired
      ?"Location is close to a CEDEX zone boundary; surveyor confirmation is required."
      :"Calculated deterministically from the confirmed damage position and overview reference frame.",
    face,
    verticalSegment:segment,
    firstSection:spansWholeLength?"X":sectionCode(first),
    lastSection:spansWholeLength?"X":sectionCode(last),
    relativeDamageBox:box
  };
}

function sideSuggestion(face:"LEFT"|"RIGHT",lengthFt:number,box:NormalizedBox):LocationSuggestion{
  const x1=box.x;
  const x2=box.x+box.width;
  const rearStart=face==="RIGHT"?x1:1-x2;
  const rearEnd=face==="RIGHT"?x2:1-x1;
  return sideSuggestionFromRearRange(face,lengthFt,box,rearStart,rearEnd);
}

export function suggestCedexLocationOnNormalizedSide(input:{
  face:"LEFT"|"RIGHT";
  lengthFt:number;
  damageBox:NormalizedBox;
}):LocationSuggestion{
  const box=input.damageBox;
  if(!finiteBox(box)||box.x<0||box.y<0||box.x+box.width>1.000001||box.y+box.height>1.000001){
    return {
      supported:true,
      code:null,
      reviewRequired:true,
      reason:"Damage area is outside the normalized container face.",
      face:input.face,
      verticalSegment:null,
      firstSection:null,
      lastSection:null,
      relativeDamageBox:null
    };
  }
  return sideSuggestionFromRearRange(input.face,input.lengthFt,box,box.x,box.x+box.width);
}

export function suggestCedexLocation(input:{
  face:SurveyFace;
  lengthFt:number;
  damageBox:NormalizedBox;
  referenceBox:NormalizedBox;
}):LocationSuggestion{
  const relative=relativeToReference(input.damageBox,input.referenceBox);
  if(!relative){
    return {
      supported:["LEFT","RIGHT"].includes(input.face),
      code:null,
      reviewRequired:true,
      reason:"Damage is outside the usable overview reference frame.",
      face:input.face,
      verticalSegment:null,
      firstSection:null,
      lastSection:null,
      relativeDamageBox:null
    };
  }

  if(input.face!=="LEFT"&&input.face!=="RIGHT"){
    return {
      supported:false,
      code:null,
      reviewRequired:true,
      reason:"Automatic CEDEX location is enabled for LEFT/RIGHT side overviews in this POC. Select the location manually for this face.",
      face:input.face,
      verticalSegment:null,
      firstSection:null,
      lastSection:null,
      relativeDamageBox:relative
    };
  }

  return sideSuggestion(input.face,input.lengthFt,relative);
}

export function suggestCedexLocationFromPoint(input:{
  face:SurveyFace;
  lengthFt:number;
  point:NormalizedPoint;
  referenceBox:NormalizedBox;
}):LocationSuggestion{
  const tiny=1e-6;
  return suggestCedexLocation({
    face:input.face,
    lengthFt:input.lengthFt,
    damageBox:{x:input.point.x-tiny/2,y:input.point.y-tiny/2,width:tiny,height:tiny},
    referenceBox:input.referenceBox
  });
}

export function normalizeLocationCode(value:string):string{
  return value.trim().toUpperCase();
}

export function isValidContainerLocationCode(value:string):boolean{
  return LOCATION_PATTERN.test(normalizeLocationCode(value));
}
