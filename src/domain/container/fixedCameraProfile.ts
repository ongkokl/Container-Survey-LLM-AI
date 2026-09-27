export type FixedCameraId = "R" | "L" | "D" | "T";
export type FixedCameraFace = "RIGHT" | "LEFT" | "DOOR" | "ROOF";

export interface FixedCameraProfile {
  id: FixedCameraId;
  label: string;
  face: FixedCameraFace;
  doorEndInImage: "LEFT" | "RIGHT" | null;
  zoomCapable: true;
  zoomMode: "OPTICAL";
  automaticSideLocation: boolean;
}

const PROFILES:Record<FixedCameraId,FixedCameraProfile>={
  R:{
    id:"R",
    label:"Right side camera",
    face:"RIGHT",
    doorEndInImage:"LEFT",
    zoomCapable:true,
    zoomMode:"OPTICAL",
    automaticSideLocation:true
  },
  L:{
    id:"L",
    label:"Left side camera",
    face:"LEFT",
    doorEndInImage:"RIGHT",
    zoomCapable:true,
    zoomMode:"OPTICAL",
    automaticSideLocation:true
  },
  D:{
    id:"D",
    label:"Door-end camera",
    face:"DOOR",
    doorEndInImage:null,
    zoomCapable:true,
    zoomMode:"OPTICAL",
    automaticSideLocation:false
  },
  T:{
    id:"T",
    label:"Roof / top camera",
    face:"ROOF",
    doorEndInImage:null,
    zoomCapable:true,
    zoomMode:"OPTICAL",
    automaticSideLocation:false
  }
};

export function fixedCameraProfile(value:string|null|undefined):FixedCameraProfile|null{
  const id=String(value??"").trim().toUpperCase() as FixedCameraId;
  return PROFILES[id]??null;
}

export function fixedCameraProfiles():FixedCameraProfile[]{
  return Object.values(PROFILES);
}
