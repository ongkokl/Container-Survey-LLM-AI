import type { FaceQuad } from "./faceHomography";
import type { NormalizedBox } from "./locationCode";

export type FixedCameraAlignmentStatus="GREEN"|"AMBER"|"RED";

export interface FixedCameraAlignmentResult {
  status:FixedCameraAlignmentStatus;
  verified:true;
  expectedBox:NormalizedBox;
  detectedBox:NormalizedBox;
  shiftX:number;
  shiftY:number;
  shiftXRatio:number;
  shiftYRatio:number;
  scaleX:number;
  scaleY:number;
  scaleDelta:number;
  iou:number;
  compensationAllowed:boolean;
  reason:string;
}

function round(value:number,digits=4):number{
  const factor=10**digits;
  return Math.round(value*factor)/factor;
}

function boxFromQuad(corners:FaceQuad):NormalizedBox{
  const xs=corners.map(p=>p.x),ys=corners.map(p=>p.y);
  const minX=Math.min(...xs),maxX=Math.max(...xs);
  const minY=Math.min(...ys),maxY=Math.max(...ys);
  return {x:minX,y:minY,width:maxX-minX,height:maxY-minY};
}

function intersectionOverUnion(a:NormalizedBox,b:NormalizedBox):number{
  const left=Math.max(a.x,b.x),top=Math.max(a.y,b.y);
  const right=Math.min(a.x+a.width,b.x+b.width);
  const bottom=Math.min(a.y+a.height,b.y+b.height);
  const intersection=Math.max(0,right-left)*Math.max(0,bottom-top);
  const union=a.width*a.height+b.width*b.height-intersection;
  return union>0?intersection/union:0;
}

export function assessFixedCameraAlignment(
  corners:FaceQuad,
  detectedBox:NormalizedBox
):FixedCameraAlignmentResult{
  const expectedBox=boxFromQuad(corners);
  const expectedCx=expectedBox.x+expectedBox.width/2;
  const expectedCy=expectedBox.y+expectedBox.height/2;
  const detectedCx=detectedBox.x+detectedBox.width/2;
  const detectedCy=detectedBox.y+detectedBox.height/2;
  const shiftX=detectedCx-expectedCx;
  const shiftY=detectedCy-expectedCy;
  const shiftXRatio=Math.abs(shiftX)/Math.max(expectedBox.width,1e-6);
  const shiftYRatio=Math.abs(shiftY)/Math.max(expectedBox.height,1e-6);
  const scaleX=detectedBox.width/Math.max(expectedBox.width,1e-6);
  const scaleY=detectedBox.height/Math.max(expectedBox.height,1e-6);
  const scaleDelta=Math.max(Math.abs(scaleX-1),Math.abs(scaleY-1));
  const iou=intersectionOverUnion(expectedBox,detectedBox);

  const green=
    shiftXRatio<=0.035&&
    shiftYRatio<=0.04&&
    scaleDelta<=0.06&&
    iou>=0.82;
  const amber=
    shiftXRatio<=0.08&&
    shiftYRatio<=0.08&&
    scaleDelta<=0.12&&
    iou>=0.65;

  const status:FixedCameraAlignmentStatus=green?"GREEN":amber?"AMBER":"RED";
  const reason=status==="GREEN"
    ?"Container position matches the stored fixed-camera calibration."
    :status==="AMBER"
      ?"Container position differs slightly from calibration. Apply automatic translation/scale compensation and require surveyor review."
      :"Container position is outside the calibrated tolerance. Reposition the container or recalibrate before automatic CEDEX location.";

  return {
    status,
    verified:true,
    expectedBox,
    detectedBox,
    shiftX:round(shiftX),
    shiftY:round(shiftY),
    shiftXRatio:round(shiftXRatio),
    shiftYRatio:round(shiftYRatio),
    scaleX:round(scaleX),
    scaleY:round(scaleY),
    scaleDelta:round(scaleDelta),
    iou:round(iou),
    compensationAllowed:status!=="RED",
    reason
  };
}

export function alignedCalibrationCorners(
  corners:FaceQuad,
  detectedBox:NormalizedBox
):FaceQuad{
  const expected=boxFromQuad(corners);
  if(expected.width<=0||expected.height<=0)return corners;
  return corners.map(point=>({
    x:detectedBox.x+((point.x-expected.x)/expected.width)*detectedBox.width,
    y:detectedBox.y+((point.y-expected.y)/expected.height)*detectedBox.height
  })) as FaceQuad;
}
