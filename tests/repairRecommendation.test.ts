import { describe, expect, it, vi } from "vitest";
import { RepairRecommendationService } from "../src/application/repairRecommendationService";
import type { CedexRepository, RepairMeasurementRecord } from "../src/infrastructure/d1/cedexRepository";

function measurement(overrides:Partial<RepairMeasurementRecord>={}):RepairMeasurementRecord{
  return {
    findingId:"f1",
    damageLengthCm:32,
    damageWidthCm:18,
    damageDepthCm:1.8,
    corrugationsAffected:2,
    deformationDirection:"INWARD",
    geometryIsoCode:"45G1",
    measurementMethod:"SURVEYOR_MANUAL",
    applicableIiclLimitMm:35,
    iiclDepthStatus:"WITHIN_DIMENSIONAL_CRITERION",
    iiclCriterionSource:"IICL dimensional criterion",
    notes:null,
    ...overrides
  };
}

function baseRepo(){
  return {
    findingContext:vi.fn(async()=>({
      id:"f1",survey_id:"s1",container_face:"RIGHT",final_location_code:"RT4N",
      equipment_type:"GP",length_ft:40,observed_iso_code:"45G1"
    })),
    repairCodesForFinding:vi.fn(async()=>({
      equipment:"GP",componentCode:"PAA",damageCode:"DT",
      repairs:[
        {repair_code:"GS",repair_name:"Straighten",description:"Straighten damaged panel",standard_version:"GP.xlsx"},
        {repair_code:"RP",repair_name:"Replace",description:"Replace damaged section",standard_version:"GP.xlsx"}
      ]
    })),
    saveRepairMeasurements:vi.fn(async()=>measurement()),
    repairMeasurementsForFinding:vi.fn(async()=>measurement()),
    historicalRepairCases:vi.fn(async()=>[
      {
        ...measurement({findingId:"h1",damageLengthCm:30,damageWidthCm:17,damageDepthCm:1.5}),
        repairCode:"RP",locationCode:"RT4N",containerFace:"RIGHT",decisionDate:"2026-09-20T00:00:00.000Z"
      },
      {
        ...measurement({findingId:"h2",damageLengthCm:18,damageWidthCm:10,damageDepthCm:0.7,corrugationsAffected:1}),
        repairCode:"GS",locationCode:"RT3N",containerFace:"RIGHT",decisionDate:"2026-09-10T00:00:00.000Z"
      }
    ]),
    saveRepairPrediction:vi.fn(async()=>({predictionId:"pred-1"}))
  };
}

describe("measurement-aware repair reasoning",()=>{
  it("uses GP.xlsx constraints, measurements and similar confirmed repairs for GP/PAA DT",async()=>{
    const repo=baseRepo();
    const ai={run:vi.fn(async(_model:string,input:unknown)=>{
      const request=input as {
        messages:Array<{content:string}>,
        response_format:{json_schema:{schema:{properties:{selected_code:{enum:Array<string|null>}}}}}
      };
      const prompt=request.messages[0].content;
      expect(prompt).toContain("Component: PAA");
      expect(prompt).toContain("Damage: DT");
      expect(prompt).toContain("length=32 cm");
      expect(prompt).toContain("repair=RP");
      expect(prompt).toContain("Do not invent length/width/depth thresholds");
      expect(request.response_format.json_schema.schema.properties.selected_code.enum).toEqual(["GS","RP",null]);
      return {choices:[{finish_reason:"stop",message:{content:JSON.stringify({
        selected_code:"RP",
        confidence:0.86,
        needs_review:true,
        reason:"Measured extent and similar confirmed repairs support RP over GS.",
        candidates:[
          {code:"RP",confidence:0.86,reason:"Closest measured historical cases used RP."},
          {code:"GS",confidence:0.14,reason:"Smaller comparable cases used GS."}
        ]
      })}}]};
    })};

    const result=await new RepairRecommendationService(
      repo as unknown as CedexRepository,
      ai
    ).analyse("f1",{
      damageLengthCm:32,damageWidthCm:18,damageDepthCm:1.8,
      corrugationsAffected:2,deformationDirection:"INWARD"
    });

    expect(result.analysisStatus).toBe("SUGGESTED");
    expect(result.selectedCode).toBe("RP");
    expect(result.needsReview).toBe(true);
    expect(result.recommendationMode).toBe("MEASUREMENT_RULES_HISTORY_QWEN");
    expect(result.historicalCaseCount).toBe(2);
    expect(repo.saveRepairMeasurements).toHaveBeenCalled();
    expect(repo.saveRepairPrediction).toHaveBeenCalledWith(expect.objectContaining({
      selectedCode:"RP",
      requestContext:expect.objectContaining({
        recommendationMode:"MEASUREMENT_RULES_HISTORY_QWEN",
        reviewPolicy:"SURVEYOR_CONFIRMATION_REQUIRED"
      })
    }));
  });

  it("does not call Qwen until GP/PAA DT length and width are captured",async()=>{
    const repo=baseRepo();
    repo.saveRepairMeasurements=vi.fn(async()=>measurement({damageWidthCm:null}));
    const ai={run:vi.fn()};

    const result=await new RepairRecommendationService(
      repo as unknown as CedexRepository,
      ai
    ).analyse("f1",{damageLengthCm:32,damageWidthCm:null});

    expect(result.analysisStatus).toBe("ABSTAINED");
    expect(result.recommendationMode).toBe("MEASUREMENTS_REQUIRED");
    expect(result.measurementRequired).toBe(true);
    expect(ai.run).not.toHaveBeenCalled();
  });

  it("keeps non-GP/PAA-DT combinations on verified manual selection",async()=>{
    const repo=baseRepo();
    repo.repairCodesForFinding=vi.fn(async()=>({
      equipment:"GP",componentCode:"PAA",damageCode:"CK",
      repairs:[
        {repair_code:"RP",repair_name:"Replace",description:"Replace damaged section",standard_version:"GP.xlsx"}
      ]
    }));
    const ai={run:vi.fn()};

    const result=await new RepairRecommendationService(
      repo as unknown as CedexRepository,
      ai
    ).analyse("f1",{damageLengthCm:10,damageWidthCm:2});

    expect(result.analysisStatus).toBe("ABSTAINED");
    expect(result.recommendationMode).toBe("RULES_ONLY_OUTSIDE_STAGE5A");
    expect(ai.run).not.toHaveBeenCalled();
  });
});
