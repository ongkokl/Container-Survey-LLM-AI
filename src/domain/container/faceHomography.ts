import type { NormalizedBox, NormalizedPoint } from "./locationCode";

export type DoorEndSide = "LEFT" | "RIGHT";
export type FaceQuad = [NormalizedPoint,NormalizedPoint,NormalizedPoint,NormalizedPoint];

function finitePoint(p:NormalizedPoint):boolean{
  return Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;
}

function edgeLength(a:NormalizedPoint,b:NormalizedPoint):number{
  return Math.hypot(b.x-a.x,b.y-a.y);
}

function signedArea(points:FaceQuad):number{
  let sum=0;
  for(let i=0;i<4;i++){
    const a=points[i],b=points[(i+1)%4];
    sum+=a.x*b.y-b.x*a.y;
  }
  return sum/2;
}

function cross(a:NormalizedPoint,b:NormalizedPoint,c:NormalizedPoint):number{
  return (b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
}

export function isValidFaceQuad(points:FaceQuad):boolean{
  if(points.length!==4||!points.every(finitePoint))return false;
  if(Math.abs(signedArea(points))<0.005)return false;
  for(let i=0;i<4;i++){
    if(edgeLength(points[i],points[(i+1)%4])<0.03)return false;
  }
  const crosses=[
    cross(points[0],points[1],points[2]),
    cross(points[1],points[2],points[3]),
    cross(points[2],points[3],points[0]),
    cross(points[3],points[0],points[1])
  ].filter(v=>Math.abs(v)>1e-8);
  if(crosses.length<4)return false;
  const sign=Math.sign(crosses[0]);
  return crosses.every(v=>Math.sign(v)===sign);
}

function solveLinear(matrix:number[][]):number[]{
  const n=matrix.length;
  for(let col=0;col<n;col++){
    let pivot=col;
    for(let row=col+1;row<n;row++){
      if(Math.abs(matrix[row][col])>Math.abs(matrix[pivot][col]))pivot=row;
    }
    if(Math.abs(matrix[pivot][col])<1e-10)throw new Error("Container face corners do not form a usable perspective reference.");
    [matrix[col],matrix[pivot]]=[matrix[pivot],matrix[col]];
    const div=matrix[col][col];
    for(let j=col;j<=n;j++)matrix[col][j]/=div;
    for(let row=0;row<n;row++){
      if(row===col)continue;
      const factor=matrix[row][col];
      if(Math.abs(factor)<1e-12)continue;
      for(let j=col;j<=n;j++)matrix[row][j]-=factor*matrix[col][j];
    }
  }
  return matrix.map(row=>row[n]);
}

function homographyToTarget(points:FaceQuad,target:FaceQuad):number[]{
  if(!isValidFaceQuad(points))throw new Error("Mark the four container-face corners in order: top-left, top-right, bottom-right, bottom-left.");
  const m:number[][]=[];
  for(let i=0;i<4;i++){
    const {x,y}=points[i],{x:u,y:v}=target[i];
    m.push([x,y,1,0,0,0,-u*x,-u*y,u]);
    m.push([0,0,0,x,y,1,-v*x,-v*y,v]);
  }
  return solveLinear(m);
}

function targetForOrientation(flipX:boolean,flipY:boolean):FaceQuad{
  const left=flipX?1:0,right=flipX?0:1;
  const top=flipY?1:0,bottom=flipY?0:1;
  return [{x:left,y:top},{x:right,y:top},{x:right,y:bottom},{x:left,y:bottom}];
}

function homography(points:FaceQuad,doorEnd:DoorEndSide):number[]{
  return homographyToTarget(points,targetForOrientation(doorEnd==="RIGHT",false));
}

function clamp01(v:number):number{
  return Math.max(0,Math.min(1,v));
}

export function mapPointToFace(point:NormalizedPoint,points:FaceQuad,doorEnd:DoorEndSide):NormalizedPoint{
  if(!finitePoint(point))throw new Error("Invalid damage point.");
  const h=homography(points,doorEnd);
  const den=h[6]*point.x+h[7]*point.y+1;
  if(Math.abs(den)<1e-10)throw new Error("Unable to map this point through the container perspective.");
  return {
    x:clamp01((h[0]*point.x+h[1]*point.y+h[2])/den),
    y:clamp01((h[3]*point.x+h[4]*point.y+h[5])/den)
  };
}

export function mapBoxToFace(box:NormalizedBox,points:FaceQuad,doorEnd:DoorEndSide):NormalizedBox{
  if(![box.x,box.y,box.width,box.height].every(Number.isFinite)||box.width<=0||box.height<=0){
    throw new Error("Invalid damage area.");
  }
  const corners=[
    {x:box.x,y:box.y},
    {x:box.x+box.width,y:box.y},
    {x:box.x+box.width,y:box.y+box.height},
    {x:box.x,y:box.y+box.height}
  ].map(p=>mapPointToFace(p,points,doorEnd));
  const xs=corners.map(p=>p.x),ys=corners.map(p=>p.y);
  const left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
  return {x:left,y:top,width:right-left,height:bottom-top};
}


export function mapPointToCalibratedFace(
  point:NormalizedPoint,
  points:FaceQuad,
  orientation:{flipX?:boolean;flipY?:boolean}={}
):NormalizedPoint{
  if(!finitePoint(point))throw new Error("Invalid damage point.");
  const h=homographyToTarget(points,targetForOrientation(Boolean(orientation.flipX),Boolean(orientation.flipY)));
  const den=h[6]*point.x+h[7]*point.y+1;
  if(Math.abs(den)<1e-10)throw new Error("Unable to map this point through the camera calibration.");
  return {
    x:clamp01((h[0]*point.x+h[1]*point.y+h[2])/den),
    y:clamp01((h[3]*point.x+h[4]*point.y+h[5])/den)
  };
}

export function mapBoxToCalibratedFace(
  box:NormalizedBox,
  points:FaceQuad,
  orientation:{flipX?:boolean;flipY?:boolean}={}
):NormalizedBox{
  if(![box.x,box.y,box.width,box.height].every(Number.isFinite)||box.width<=0||box.height<=0){
    throw new Error("Invalid damage area.");
  }
  const corners=[
    {x:box.x,y:box.y},
    {x:box.x+box.width,y:box.y},
    {x:box.x+box.width,y:box.y+box.height},
    {x:box.x,y:box.y+box.height}
  ].map(p=>mapPointToCalibratedFace(p,points,orientation));
  const xs=corners.map(p=>p.x),ys=corners.map(p=>p.y);
  const left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
  return {x:left,y:top,width:right-left,height:bottom-top};
}
