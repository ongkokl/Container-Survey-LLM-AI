import { describe, expect, it, vi } from "vitest";
import { FixedCameraCalibrationService } from "../src/application/fixedCameraCalibrationService";
import type { CedexRepository } from "../src/infrastructure/d1/cedexRepository";

const quad=[
  {x:0.1,y:0.1},
  {x:0.9,y:0.1},
  {x:0.9,y:0.9},
  {x:0.1,y:0.9}
] as const;

function repoWithCalibration(stored:any=null){
  return {
    findingContext:vi.fn(async()=>({
      id:"f1",survey_id:"s1",container_face:"RIGHT",equipment_type:"GP",
      length_ft:40,observed_iso_code:"45G1"
    })),
    geometryForFinding:vi.fn(async()=>({
      isoCode:"45G1",equipmentType:"GP",lengthFt:40,heightDescription:"9ft 6in",
      lengthMm:12192,widthMm:2438,heightMm:2896,geometrySource:"ISO",geometryVersion:"v1"
    })),
    fixedCameraCalibration:vi.fn(async()=>stored),
    upsertFixedCameraCalibration:vi.fn(async(input:any)=>({
      cameraId:input.cameraId,
      containerFace:input.containerFace,
      lengthFt:input.lengthFt,
      heightMm:input.heightMm,
      doorEndInImage:input.doorEndInImage,
      corners:[...input.corners],
      calibrationVersion:2,
      updatedAt:"2026-09-27T00:00:00.000Z"
    }))
  } as unknown as CedexRepository;
}

describe("fixed camera calibration service",()=>{
  it("reports the exact R/40ft/HC profile as unavailable before one-time calibration",async()=>{
    const service=new FixedCameraCalibrationService(repoWithCalibration());
    await expect(service.get("f1","R")).resolves.toMatchObject({
      available:false,
      cameraId:"R",
      face:"RIGHT",
      lengthFt:40,
      heightMm:2896,
      doorEndInImage:"LEFT"
    });
  });

  it("saves the four-corner calibration against camera and container geometry",async()=>{
    const repo=repoWithCalibration();
    const service=new FixedCameraCalibrationService(repo);
    const result=await service.save({findingId:"f1",cameraId:"R",corners:quad});
    expect(result).toMatchObject({
      available:true,cameraId:"R",face:"RIGHT",lengthFt:40,heightMm:2896,
      doorEndInImage:"LEFT",calibrationVersion:2
    });
    expect((repo as any).upsertFixedCameraCalibration).toHaveBeenCalledWith(expect.objectContaining({
      cameraId:"R",containerFace:"RIGHT",lengthFt:40,heightMm:2896,doorEndInImage:"LEFT"
    }));
  });

  it("maps a damage box through stored camera calibration without per-image face detection",async()=>{
    const repo=repoWithCalibration({
      cameraId:"R",containerFace:"RIGHT",lengthFt:40,heightMm:2896,
      doorEndInImage:"LEFT",corners:[...quad],calibrationVersion:1,
      updatedAt:"2026-09-27T00:00:00.000Z"
    });
    const service=new FixedCameraCalibrationService(repo);
    const result=await service.calculate({
      findingId:"f1",
      cameraId:"R",
      damageBox:{x:0.46,y:0.25,width:0.08,height:0.18}
    });
    expect(result.referenceSource).toBe("FIXED_CAMERA_CALIBRATION");
    expect(result.code?.startsWith("R")).toBe(true);
    expect(result.calibration).toMatchObject({available:true,cameraId:"R",calibrationVersion:1});
  });

  it("does not enable side calibration for Door/Top cameras",async()=>{
    const doorRepo={
      findingContext:vi.fn(async()=>({
        id:"f1",survey_id:"s1",container_face:"DOOR",equipment_type:"GP",
        length_ft:40,observed_iso_code:"45G1"
      }))
    } as unknown as CedexRepository;
    const service=new FixedCameraCalibrationService(doorRepo);
    await expect(service.get("f1","D")).rejects.toThrow(/R\/L only/);
  });
});
