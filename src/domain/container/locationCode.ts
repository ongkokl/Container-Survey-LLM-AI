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
  verticalSegment: "H" | "T" | "B" | "G" | "L" | "R" | "X" | null;
  firstSection: string | null;
  lastSection: string | null;
  relativeDamageBox: NormalizedBox | null;
}

export interface EndFaceStructureCalibration {
  // Canonical normalized end-face x boundaries: 1|2, 2|3, 3|4.
  positionBoundariesX: [number,number,number];
  // Canonical normalized end-face y boundaries: H|T, T|B, B|G.
  verticalBoundariesY: [number,number,number];
}

export function isValidEndFaceStructureCalibration(value:unknown):value is EndFaceStructureCalibration{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const v=value as Partial<EndFaceStructureCalibration>;
  const validTriplet=(x:unknown):x is [number,number,number]=>{
    if(!Array.isArray(x)||x.length!==3||!x.every(n=>typeof n==="number"&&Number.isFinite(n)&&n>0&&n<1))return false;
    return x[0]<x[1]&&x[1]<x[2]&&
      x[1]-x[0]>=0.02&&x[2]-x[1]>=0.02;
  };
  return validTriplet(v.positionBoundariesX)&&validTriplet(v.verticalBoundariesY);
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


function longitudinalRange(lengthFt:number,box:NormalizedBox):{
  thirdFourth:string;
  first:string;
  last:string;
  boundaryNear:boolean;
}{
  const count=lengthFt<=20?5:10;
  const start=clamp01(box.x),end=clamp01(box.x+box.width);
  const spansWhole=start<=0.01&&end>=0.99;
  const firstIndex=sectionAt(start,count);
  const lastIndex=sectionAt(Math.max(start,end-1e-6),count);
  const first=spansWhole?"X":sectionCode(firstIndex);
  const last=spansWhole?"X":sectionCode(lastIndex);
  const thirdFourth=spansWhole
    ?"XX"
    :firstIndex===lastIndex
      ?sectionCode(firstIndex)+"N"
      :sectionCode(firstIndex)+sectionCode(lastIndex);
  const boundaryNear=[start,end].some(v=>{
    for(let i=1;i<count;i++)if(closeTo(v,i/count))return true;
    return false;
  });
  return {thirdFourth,first,last,boundaryNear};
}

function roofFloorSuggestion(face:"ROOF"|"FLOOR",lengthFt:number,box:NormalizedBox):LocationSuggestion{
  const lateral=box.y+box.height<=0.5?"L":box.y>=0.5?"R":"X";
  const range=longitudinalRange(lengthFt,box);
  const lateralBoundaryNear=closeTo(box.y,0.5)||closeTo(box.y+box.height,0.5);
  const reviewRequired=range.boundaryNear||lateralBoundaryNear;
  return {
    supported:true,
    code:(face==="ROOF"?"T":"B")+lateral+range.thirdFourth,
    reviewRequired,
    reason:reviewRequired
      ?"Location is close to a CEDEX roof/floor zone boundary; surveyor confirmation is required."
      :"Calculated deterministically from the calibrated fixed-camera plane.",
    face,
    verticalSegment:lateral,
    firstSection:range.first,
    lastSection:range.last,
    relativeDamageBox:box
  };
}

function endHorizontalPosition(value:number,boundaries:[number,number,number]):number{
  const safe=clamp01(value);
  if(safe<boundaries[0])return 1;
  if(safe<boundaries[1])return 2;
  if(safe<boundaries[2])return 3;
  return 4;
}

function endVerticalZoneAt(value:number,boundaries:[number,number,number]):"H"|"T"|"B"|"G"{
  const safe=clamp01(value);
  if(safe<boundaries[0])return "H";
  if(safe<boundaries[1])return "T";
  if(safe<boundaries[2])return "B";
  return "G";
}

function endFaceSuggestion(
  face:"DOOR"|"FRONT",
  box:NormalizedBox,
  structure:EndFaceStructureCalibration|null|undefined
):LocationSuggestion{
  if(!isValidEndFaceStructureCalibration(structure)){
    return {
      supported:true,
      code:null,
      reviewRequired:true,
      reason:"Physical Door/Front CEDEX structure calibration is required before automatic end-face location can be calculated.",
      face,
      verticalSegment:null,
      firstSection:null,
      lastSection:null,
      relativeDamageBox:box
    };
  }

  const x1=clamp01(box.x),x2=clamp01(box.x+box.width);
  const y1=clamp01(box.y),y2=clamp01(box.y+box.height);
  const fullWidth=x1<=0.01&&x2>=0.99;
  const firstPos=endHorizontalPosition(x1,structure.positionBoundariesX);
  const lastPos=endHorizontalPosition(Math.max(x1,x2-1e-6),structure.positionBoundariesX);
  const thirdFourth=fullWidth
    ?"XX"
    :firstPos===lastPos
      ?String(firstPos)+"N"
      :String(firstPos)+String(lastPos);

  const verticalStart=endVerticalZoneAt(y1,structure.verticalBoundariesY);
  const verticalEnd=endVerticalZoneAt(Math.max(y1,y2-1e-6),structure.verticalBoundariesY);
  const vertical=verticalStart===verticalEnd?verticalStart:"X";
  const thresholds=[...structure.positionBoundariesX,...structure.verticalBoundariesY];
  const boundaryNear=[x1,x2].some(v=>structure.positionBoundariesX.some(t=>closeTo(v,t)))||
    [y1,y2].some(v=>structure.verticalBoundariesY.some(t=>closeTo(v,t)));
  return {
    supported:true,
    code:(face==="DOOR"?"D":"F")+vertical+thirdFourth,
    reviewRequired:boundaryNear,
    reason:boundaryNear
      ?"Location is close to a calibrated physical Door/Front CEDEX structure boundary; surveyor confirmation is required."
      :"Calculated from the calibrated physical Door/Front CEDEX structure.",
    face,
    verticalSegment:vertical,
    firstSection:fullWidth?"X":String(firstPos),
    lastSection:fullWidth?"X":String(lastPos),
    relativeDamageBox:box
  };
}

export function suggestCedexLocationOnNormalizedFace(input:{
  face:SurveyFace;
  lengthFt:number;
  damageBox:NormalizedBox;
  endFaceStructure?:EndFaceStructureCalibration|null;
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
  if(input.face==="LEFT"||input.face==="RIGHT"){
    return sideSuggestionFromRearRange(input.face,input.lengthFt,box,box.x,box.x+box.width);
  }
  if(input.face==="ROOF"||input.face==="FLOOR"){
    return roofFloorSuggestion(input.face,input.lengthFt,box);
  }
  if(input.face==="DOOR"||input.face==="FRONT"){
    return endFaceSuggestion(input.face,box,input.endFaceStructure);
  }
  return {
    supported:false,
    code:null,
    reviewRequired:true,
    reason:"Automatic normalized-face location is not configured for this container face.",
    face:input.face,
    verticalSegment:null,
    firstSection:null,
    lastSection:null,
    relativeDamageBox:box
  };
}

export function suggestCedexLocationOnNormalizedSide(input:{
  face:"LEFT"|"RIGHT";
  lengthFt:number;
  damageBox:NormalizedBox;
}):LocationSuggestion{
  return suggestCedexLocationOnNormalizedFace(input);
}

export function suggestCedexLocation(input:{
  face:SurveyFace;
  lengthFt:number;
  damageBox:NormalizedBox;
  referenceBox:NormalizedBox;
  endFaceStructure?:EndFaceStructureCalibration|null;
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

  if(input.face==="LEFT"||input.face==="RIGHT"){
    return sideSuggestion(input.face,input.lengthFt,relative);
  }
  return suggestCedexLocationOnNormalizedFace({
    face:input.face,
    lengthFt:input.lengthFt,
    damageBox:relative,
    endFaceStructure:input.endFaceStructure
  });
}

export function suggestCedexLocationFromPoint(input:{
  face:SurveyFace;
  lengthFt:number;
  point:NormalizedPoint;
  referenceBox:NormalizedBox;
  endFaceStructure?:EndFaceStructureCalibration|null;
}):LocationSuggestion{
  const tiny=1e-6;
  return suggestCedexLocation({
    face:input.face,
    lengthFt:input.lengthFt,
    damageBox:{x:input.point.x-tiny/2,y:input.point.y-tiny/2,width:tiny,height:tiny},
    referenceBox:input.referenceBox,
    endFaceStructure:input.endFaceStructure
  });
}

export function normalizeLocationCode(value:string):string{
  return value.trim().toUpperCase();
}

export function isValidContainerLocationCode(value:string):boolean{
  return LOCATION_PATTERN.test(normalizeLocationCode(value));
}
