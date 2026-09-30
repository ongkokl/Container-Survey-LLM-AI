import { describe, expect, it, vi } from "vitest";
import { CloseupMeasurementPocService } from "../src/application/closeupMeasurementPocService";
import type { CedexRepository } from "../src/infrastructure/d1/cedexRepository";

describe("close-up measurement POC service",()=>{
  it("maps the overview ROI to physical size and refines it with the close-up AI box",async()=>{
    const repo={
      findingContext:vi.fn(async()=>({
        id:"f1",survey_id:"s1",container_face:"LEFT",
        equipment_type:"GP",length_ft:40,observed_iso_code:"45G1"
      })),
      geometryForFinding:vi.fn(async()=>({
        isoCode:"45G1",equipmentType:"GP",lengthFt:40,heightDescription:"9'6",
        lengthMm:12000,widthMm:2400,heightMm:3000,
        geometrySource:"test",geometryVersion:"test"
      })),
      fixedCameraCalibration:vi.fn(async()=>({
        cameraId:"L",containerFace:"LEFT",lengthFt:40,heightMm:3000,
        doorEndInImage:"RIGHT",
        corners:[
          {x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}
        ],
        calibrationVersion:1,updatedAt:"2026-09-30T00:00:00.000Z"
      }))
    } as unknown as CedexRepository;

    const result=await new CloseupMeasurementPocService(repo).measure({
      findingId:"f1",
      cameraId:"L",
      overviewDamageBox:{x:0.1,y:0.2,width:0.2,height:0.1},
      closeupDamageBox:{x:0.2,y:0.25,width:0.5,height:0.4},
      alignmentReferenceBox:null
    });

    expect(result.overviewMeasurement.spanXmm).toBe(2400);
    expect(result.overviewMeasurement.spanYmm).toBe(300);
    expect(result.measurement.spanXmm).toBe(1200);
    expect(result.measurement.spanYmm).toBe(120);
    expect(result.measurement.majorCm).toBe(120);
    expect(result.measurement.minorCm).toBe(12);
    expect(result.measurement.requiresSurveyorVerification).toBe(true);
    expect(result.depthSupported).toBe(false);
  });
});
