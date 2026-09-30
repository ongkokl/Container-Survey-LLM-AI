export type NormalizedBox={x:number;y:number;width:number;height:number};

export interface OverviewPhysicalMeasurement {
  spanXmm:number;
  spanYmm:number;
  majorMm:number;
  minorMm:number;
  majorCm:number;
  minorCm:number;
  xAxis?:string|null;
  yAxis?:string|null;
  method?:string|null;
  source?:string|null;
  planeProjected?:boolean;
  requiresSurveyorVerification?:boolean;
}

function validBox(box:NormalizedBox){
  return [box.x,box.y,box.width,box.height].every(Number.isFinite)&&
    box.x>=0&&box.y>=0&&box.width>0&&box.height>0&&
    box.x+box.width<=1.000001&&box.y+box.height<=1.000001;
}

function round1(value:number){return Math.round(value*10)/10;}

export function refineCloseupDamageMeasurement(input:{
  overviewMeasurement:OverviewPhysicalMeasurement;
  closeupDamageBox:NormalizedBox;
}){
  const {overviewMeasurement,closeupDamageBox}=input;
  if(!validBox(closeupDamageBox))throw new Error("Close-up damage box is invalid.");
  if(!(overviewMeasurement.spanXmm>0)||!(overviewMeasurement.spanYmm>0)){
    throw new Error("A calibrated overview damage measurement is required before close-up refinement.");
  }

  const spanXmm=overviewMeasurement.spanXmm*closeupDamageBox.width;
  const spanYmm=overviewMeasurement.spanYmm*closeupDamageBox.height;
  const majorMm=Math.max(spanXmm,spanYmm);
  const minorMm=Math.min(spanXmm,spanYmm);
  const touchesEdge=
    closeupDamageBox.x<=0.015||
    closeupDamageBox.y<=0.015||
    closeupDamageBox.x+closeupDamageBox.width>=0.985||
    closeupDamageBox.y+closeupDamageBox.height>=0.985;
  const verySmall=closeupDamageBox.width<0.04||closeupDamageBox.height<0.04;

  return {
    method:"FIXED_CAMERA_OVERVIEW_ROI_X_CLOSEUP_BOX",
    source:"CLOSEUP_DAMAGE_BOX_RELATIVE_TO_OVERVIEW_ROI",
    planeProjected:true,
    xAxis:overviewMeasurement.xAxis??"X",
    yAxis:overviewMeasurement.yAxis??"Y",
    spanXmm:round1(spanXmm),
    spanYmm:round1(spanYmm),
    majorMm:round1(majorMm),
    minorMm:round1(minorMm),
    majorCm:round1(majorMm/10),
    minorCm:round1(minorMm/10),
    closeupBox:{...closeupDamageBox},
    closeupCoverage:{
      widthPct:round1(closeupDamageBox.width*100),
      heightPct:round1(closeupDamageBox.height*100)
    },
    overviewBaseline:{
      spanXmm:round1(overviewMeasurement.spanXmm),
      spanYmm:round1(overviewMeasurement.spanYmm),
      majorCm:round1(overviewMeasurement.majorCm),
      minorCm:round1(overviewMeasurement.minorCm)
    },
    framingAssumption:"CLOSEUP_FRAME_MATCHES_OVERVIEW_DAMAGE_ROI",
    requiresSurveyorVerification:true,
    productionZoomCalibrationRequired:true,
    quality:{
      touchesImageEdge:touchesEdge,
      verySmallDetection:verySmall,
      reviewRequired:true,
      reason:touchesEdge
        ?"Detected damage touches the close-up image edge; the full damage may not be visible."
        :verySmall
          ?"Detected damage occupies very little of the close-up image; use a tighter optical zoom."
          :"POC estimate assumes the close-up frame represents the same physical area as the overview damage ROI."
    }
  };
}
