import { describe, expect, it, vi } from "vitest";
import { FixedCameraCalibrationService } from "../src/application/fixedCameraCalibrationService";
import type { CedexRepository } from "../src/infrastructure/d1/cedexRepository";

const quad=[
  {x:0.1,y:0.1},
  {x:0.9,y:0.1},
  {x:0.9,y:0.9},
  {x:0.1,y:0.9}
] as const;

function repoWithCalibration(stored:any=null,face="RIGHT"){
  return {
    findingContext:vi.fn(async()=>({
      id:"f1",survey_id:"s1",container_face:face,equipment_type:"GP",
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

function stored(cameraId:string,containerFace:string,doorEndInImage:"LEFT"|"RIGHT"|null){
  return {
    cameraId,containerFace,lengthFt:40,heightMm:2896,doorEndInImage,
    corners:[...quad],calibrationVersion:1,updatedAt:"2026-09-27T00:00:00.000Z"
  };
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

  it("maps right-side damage through stored calibration",async()=>{
    const service=new FixedCameraCalibrationService(
      repoWithCalibration(stored("R","RIGHT","LEFT"),"RIGHT")
    );
    const result=await service.calculate({
      findingId:"f1",cameraId:"R",
      damageBox:{x:0.46,y:0.25,width:0.08,height:0.18}
    });
    expect(result.referenceSource).toBe("FIXED_CAMERA_CALIBRATION");
    expect(result.code?.startsWith("R")).toBe(true);
  });

  it("maps Door camera damage to the IICL end-face grid",async()=>{
    const service=new FixedCameraCalibrationService(
      repoWithCalibration(stored("D","DOOR",null),"DOOR")
    );
    const result=await service.calculate({
      findingId:"f1",cameraId:"D",
      damagePoint:{x:0.30,y:0.13}
    });
    expect(result.code).toBe("DH2N");
  });

  it("mirrors Front camera horizontal positions so they follow the door positions",async()=>{
    const service=new FixedCameraCalibrationService(
      repoWithCalibration(stored("F","FRONT",null),"FRONT")
    );
    const result=await service.calculate({
      findingId:"f1",cameraId:"F",
      damagePoint:{x:0.40,y:0.66}
    });
    expect(result.code).toBe("FB3N");
  });

  it("maps Roof camera longitudinal and left/right halves",async()=>{
    const service=new FixedCameraCalibrationService(
      repoWithCalibration(stored("T","ROOF","LEFT"),"ROOF")
    );
    const result=await service.calculate({
      findingId:"f1",cameraId:"T",
      damagePoint:{x:0.30,y:0.30}
    });
    expect(result.code).toBe("TL3N");
  });

  it("maps Floor camera longitudinal and left/right halves",async()=>{
    const service=new FixedCameraCalibrationService(
      repoWithCalibration(stored("B","FLOOR","LEFT"),"FLOOR")
    );
    const result=await service.calculate({
      findingId:"f1",cameraId:"B",
      damagePoint:{x:0.13,y:0.30}
    });
    expect(result.code).toBe("BL1N");
  });
});
