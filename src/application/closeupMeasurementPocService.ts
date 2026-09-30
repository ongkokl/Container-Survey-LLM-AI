import { refineCloseupDamageMeasurement } from "../domain/container/closeupDamageMeasurement";
import { FixedCameraCalibrationService } from "./fixedCameraCalibrationService";
import { CedexRepository } from "../infrastructure/d1/cedexRepository";

export class CloseupMeasurementPocService{
  private readonly calibration:FixedCameraCalibrationService;

  constructor(private readonly repo:CedexRepository){
    this.calibration=new FixedCameraCalibrationService(repo);
  }

  async measure(input:{
    findingId:string;
    cameraId:string;
    overviewDamageBox:unknown;
    closeupDamageBox:unknown;
    alignmentReferenceBox?:unknown;
  }){
    const overview=await this.calibration.calculate({
      findingId:input.findingId,
      cameraId:input.cameraId,
      damageBox:input.overviewDamageBox,
      alignmentReferenceBox:input.alignmentReferenceBox,
      requireAlignment:true
    });
    if(!overview.physicalMeasurement){
      throw new Error("A real overview damage area with calibrated physical measurement is required before close-up refinement.");
    }
    if(!input.closeupDamageBox||typeof input.closeupDamageBox!=="object"||Array.isArray(input.closeupDamageBox)){
      throw new Error("A valid AI close-up damage box is required.");
    }
    const box=input.closeupDamageBox as {x:number;y:number;width:number;height:number};
    const measurement=refineCloseupDamageMeasurement({
      overviewMeasurement:overview.physicalMeasurement,
      closeupDamageBox:box
    });
    return {
      measurement,
      overviewMeasurement:overview.physicalMeasurement,
      overviewLocation:overview.code??null,
      overviewAlignment:overview.alignment??null,
      reviewRequired:true,
      depthSupported:false,
      note:"POC only. Length/width are plane-projected and assume the close-up frame matches the overview damage ROI. Dent depth is not estimated."
    };
  }
}
