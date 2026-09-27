import type { NormalizedBox } from "./locationCode";

export type ImageSide = "LEFT" | "RIGHT";

export interface DoorEndDetection {
  visible: boolean;
  side: ImageSide | null;
  confidence: number;
  expectedSide: ImageSide | null;
  matchesSelectedFace: boolean | null;
  suggestedFace: "LEFT" | "RIGHT" | null;
  doorDominant: boolean;
  reason: string;
}

function centerX(box:NormalizedBox):number{
  return box.x+box.width/2;
}

function area(box:NormalizedBox):number{
  return Math.max(0,box.width)*Math.max(0,box.height);
}

function clamp01(v:number):number{
  return Math.max(0,Math.min(1,v));
}

export function expectedDoorImageSide(face:string):ImageSide|null{
  if(face==="RIGHT")return "LEFT";
  if(face==="LEFT")return "RIGHT";
  return null;
}

export function inferDoorEndDetection(input:{
  selectedFace:string;
  doorBox:NormalizedBox|null;
  referenceBox:NormalizedBox|null;
}):DoorEndDetection{
  const expectedSide=expectedDoorImageSide(input.selectedFace);
  if(!input.doorBox){
    return {
      visible:false,
      side:null,
      confidence:0,
      expectedSide,
      matchesSelectedFace:null,
      suggestedFace:null,
      doorDominant:false,
      reason:"Door end was not detected confidently."
    };
  }

  const doorCenter=centerX(input.doorBox);
  const referenceCenter=input.referenceBox?centerX(input.referenceBox):0.5;
  const delta=doorCenter-referenceCenter;
  const absDelta=Math.abs(delta);
  const side:ImageSide=delta<0?"LEFT":"RIGHT";
  const confidence=input.referenceBox
    ? clamp01(0.58+Math.min(absDelta,0.35)*1.15)
    : clamp01(0.45+Math.min(Math.abs(doorCenter-0.5),0.35)*0.9);
  const doorDominant=!input.referenceBox&&area(input.doorBox)>=0.28;
  const suggestedFace=input.referenceBox
    ? side==="LEFT"?"RIGHT":"LEFT"
    : null;
  const matchesSelectedFace=expectedSide&&input.referenceBox
    ? side===expectedSide
    : null;

  const reason=doorDominant
    ?"Door end is prominent but a usable side-panel reference was not detected."
    :input.referenceBox
      ?matchesSelectedFace===false
        ?`Door end appears on the ${side.toLowerCase()} side of the photo, which conflicts with the selected ${input.selectedFace} side.`
        :`Door end appears on the ${side.toLowerCase()} side of the photo.`
      :`Door end appears on the ${side.toLowerCase()} side of the photo, but side-panel geometry is not yet established.`;

  return {
    visible:true,
    side,
    confidence:Number(confidence.toFixed(2)),
    expectedSide,
    matchesSelectedFace,
    suggestedFace,
    doorDominant,
    reason
  };
}
