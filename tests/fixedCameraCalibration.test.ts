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
    fixedCameraCalibrationByHeight:vi.fn(async()=>stored),
    fixedCameraEndStructureCalibration:vi.fn(async()=>null),
    upsertFixedCameraEndStructureCalibration:vi.fn(async(input:any)=>({
      cameraId:input.cameraId,containerFace:input.containerFace,equipmentType:input.equipmentType,
      heightMm:input.heightMm,positionBoundariesX:[...input.positionBoundariesX],
      verticalBoundariesY:[...input.verticalBoundariesY],calibrationVersion:1,
      updatedAt:"2026-09-27T00:00:00.000Z"
    })),
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
    const repo=repoWithCalibration() as any;
    repo.fixedCameraCalibration.mockResolvedValue({
      cameraId:"R",containerFace:"RIGHT",lengthFt:40,heightMm:2896,
      doorEndInImage:"LEFT",corners:[...quad],calibrationVersion:2,
      updatedAt:"2026-09-27T00:00:00.000Z"
    });
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

  it("requires physical structure calibration before Door automatic location",async()=>{
    const service=new FixedCameraCalibrationService(
      repoWithCalibration(stored("D","DOOR",null),"DOOR")
    );
    const result=await service.calculate({
      findingId:"f1",cameraId:"D",
      damagePoint:{x:0.30,y:0.13}
    });
    expect(result.code).toBeNull();
    expect(result.reason).toMatch(/structure calibration/i);
  });

  it("maps Door damage through stored physical structure boundaries",async()=>{
    const repo=repoWithCalibration(stored("D","DOOR",null),"DOOR") as any;
    repo.fixedCameraEndStructureCalibration=vi.fn(async()=>({
      cameraId:"D",containerFace:"DOOR",equipmentType:"GP",heightMm:2896,
      positionBoundariesX:[0.10,0.50,0.90],verticalBoundariesY:[0.10,0.50,0.90],
      calibrationVersion:1,updatedAt:"2026-09-27T00:00:00.000Z"
    }));
    const service=new FixedCameraCalibrationService(repo);
    const result=await service.calculate({
      findingId:"f1",cameraId:"D",
      damagePoint:{x:0.30,y:0.26}
    });
    expect(result.code).toBe("DT2N");
  });

  it("mirrors Front camera and applies its stored physical structure",async()=>{
    const repo=repoWithCalibration(stored("F","FRONT",null),"FRONT") as any;
    repo.fixedCameraEndStructureCalibration=vi.fn(async()=>({
      cameraId:"F",containerFace:"FRONT",equipmentType:"GP",heightMm:2896,
      positionBoundariesX:[0.10,0.50,0.90],verticalBoundariesY:[0.10,0.50,0.90],
      calibrationVersion:1,updatedAt:"2026-09-27T00:00:00.000Z"
    }));
    const service=new FixedCameraCalibrationService(repo);
    const result=await service.calculate({
      findingId:"f1",cameraId:"F",
      damagePoint:{x:0.40,y:0.66}
    });
    expect(result.code).toBe("FB3N");
  });

  it("saves six physical guide points as canonical Door structure boundaries",async()=>{
    const repo=repoWithCalibration(stored("D","DOOR",null),"DOOR") as any;
    const service=new FixedCameraCalibrationService(repo);
    await service.saveEndStructure({
      findingId:"f1",cameraId:"D",
      positionGuides:[{x:0.18,y:0.5},{x:0.5,y:0.5},{x:0.82,y:0.5}],
      verticalGuides:[{x:0.5,y:0.18},{x:0.5,y:0.5},{x:0.5,y:0.82}]
    });
    expect(repo.upsertFixedCameraEndStructureCalibration).toHaveBeenCalledWith(expect.objectContaining({
      cameraId:"D",containerFace:"DOOR",equipmentType:"GP",heightMm:2896
    }));
    const saved=repo.upsertFixedCameraEndStructureCalibration.mock.calls[0][0];
    expect(saved.positionBoundariesX[0]).toBeCloseTo(0.10,6);
    expect(saved.positionBoundariesX[1]).toBeCloseTo(0.50,6);
    expect(saved.positionBoundariesX[2]).toBeCloseTo(0.90,6);
    expect(saved.verticalBoundariesY[0]).toBeCloseTo(0.10,6);
    expect(saved.verticalBoundariesY[1]).toBeCloseTo(0.50,6);
    expect(saved.verticalBoundariesY[2]).toBeCloseTo(0.90,6);
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
