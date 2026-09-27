export type FixedCameraId = "R" | "L" | "D" | "F" | "T" | "B";
export type FixedCameraFace = "RIGHT" | "LEFT" | "DOOR" | "FRONT" | "ROOF" | "FLOOR";

export interface FixedCameraProfile {
  id: FixedCameraId;
  label: string;
  face: FixedCameraFace;
  doorEndInImage: "LEFT" | "RIGHT" | null;
  canonicalFlipX: boolean;
  canonicalFlipY: boolean;
  zoomCapable: true;
  zoomMode: "OPTICAL";
  automaticLocation: true;
}

const PROFILES:Record<FixedCameraId,FixedCameraProfile>={
  R:{
    id:"R",
    label:"Right side camera",
    face:"RIGHT",
    doorEndInImage:"LEFT",
    canonicalFlipX:false,
    canonicalFlipY:false,
    zoomCapable:true,
    zoomMode:"OPTICAL",
    automaticLocation:true
  },
  L:{
    id:"L",
    label:"Left side camera",
    face:"LEFT",
    doorEndInImage:"RIGHT",
    canonicalFlipX:true,
    canonicalFlipY:false,
    zoomCapable:true,
    zoomMode:"OPTICAL",
    automaticLocation:true
  },
  D:{
    id:"D",
    label:"Door-end camera",
    face:"DOOR",
    doorEndInImage:null,
    canonicalFlipX:false,
    canonicalFlipY:false,
    zoomCapable:true,
    zoomMode:"OPTICAL",
    automaticLocation:true
  },
  F:{
    id:"F",
    label:"Front-end camera",
    face:"FRONT",
    doorEndInImage:null,
    canonicalFlipX:true,
    canonicalFlipY:false,
    zoomCapable:true,
    zoomMode:"OPTICAL",
    automaticLocation:true
  },
  T:{
    id:"T",
    label:"Roof / top camera",
    face:"ROOF",
    doorEndInImage:"LEFT",
    canonicalFlipX:false,
    canonicalFlipY:false,
    zoomCapable:true,
    zoomMode:"OPTICAL",
    automaticLocation:true
  },
  B:{
    id:"B",
    label:"Floor / bottom camera",
    face:"FLOOR",
    doorEndInImage:"LEFT",
    canonicalFlipX:false,
    canonicalFlipY:false,
    zoomCapable:true,
    zoomMode:"OPTICAL",
    automaticLocation:true
  }
};

export function fixedCameraProfile(value:string|null|undefined):FixedCameraProfile|null{
  const id=String(value??"").trim().toUpperCase() as FixedCameraId;
  return PROFILES[id]??null;
}

export function fixedCameraProfiles():FixedCameraProfile[]{
  return Object.values(PROFILES);
}
