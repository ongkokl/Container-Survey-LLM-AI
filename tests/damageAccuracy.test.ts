import { describe, expect, it } from "vitest";
import { DamageAccuracyService } from "../src/application/damageAccuracyService";
import type { CedexRepository, DamageAccuracyRow } from "../src/infrastructure/d1/cedexRepository";

function row(input:Partial<DamageAccuracyRow>&Pick<DamageAccuracyRow,"final_value">):DamageAccuracyRow{
  return {
    ai_value:null,
    final_value:input.final_value,
    decision:"CORRECTED",
    confidence:null,
    candidate_codes:null,
    request_context_json:null,
    container_face:"RIGHT",
    equipment_type:"GP",
    component_code:"PAA",
    created_at:"2026-09-28T00:00:00.000Z",
    ...input
  };
}

describe("GP PAA damage accuracy benchmark",()=>{
  it("calculates photo-visual accuracy, review rate and key confusion groups",async()=>{
    const rows:DamageAccuracyRow[]=[
      row({
        ai_value:"DT",final_value:"DT",decision:"APPROVED",confidence:0.94,
        candidate_codes:"DT|GD|PF",
        request_context_json:JSON.stringify({needsReview:false})
      }),
      row({
        ai_value:"DT",final_value:"GD",decision:"CORRECTED",confidence:0.84,
        candidate_codes:"DT|GD|PF",
        request_context_json:JSON.stringify({needsReview:true})
      }),
      row({
        ai_value:"CO",final_value:"DY",decision:"CORRECTED",confidence:0.76,
        candidate_codes:"CO|DY|PF",
        request_context_json:JSON.stringify({})
      }),
      row({
        ai_value:"CK",final_value:"CK",decision:"APPROVED",confidence:0.91,
        candidate_codes:"CK|CU|GD",
        request_context_json:JSON.stringify({needsReview:false})
      }),
      row({
        ai_value:"IR",final_value:"IR",decision:"APPROVED",confidence:0.88,
        candidate_codes:"IR",
        request_context_json:JSON.stringify({evidenceReviewRequired:true})
      })
    ];
    const repo={
      damageAccuracyRows:async()=>rows
    } as Pick<CedexRepository,"damageAccuracyRows">;

    const report=await new DamageAccuracyService(repo).report();

    expect(report.equipment).toBe("GP");
    expect(report.componentCode).toBe("PAA");
    expect(report.allConfirmedPaa.samples).toBe(5);
    expect(report.photoVisualFocus.samples).toBe(4);
    expect(report.photoVisualFocus.top1Accuracy).toBe(0.5);
    expect(report.photoVisualFocus.top3HitRate).toBe(1);
    expect(report.photoVisualFocus.reviewRequired).toBe(2);
    expect(report.photoVisualFocus.reviewRequiredRate).toBe(0.5);
    expect(report.confusions).toContainEqual({expectedCode:"GD",aiCode:"DT",count:1});
    expect(report.confusions).toContainEqual({expectedCode:"DY",aiCode:"CO",count:1});
    expect(report.confusionGroups.find(group=>group.name==="DEFORMATION_SURFACE")?.withinGroupConfusions).toBe(1);
    expect(report.confusionGroups.find(group=>group.name==="SURFACE_CONDITION")?.withinGroupConfusions).toBe(1);
    expect(report.perCode.find(item=>item.code==="DT")?.samples).toBe(1);
    expect(report.benchmarkReady).toBe(false);
  });

  it("excludes rejected decisions and context-dependent codes from the photo-visual focus score",async()=>{
    const rows:DamageAccuracyRow[]=[
      row({ai_value:"DT",final_value:"DT",decision:"APPROVED",confidence:0.95,candidate_codes:"DT"}),
      row({ai_value:"NI",final_value:"NI",decision:"APPROVED",confidence:0.85,candidate_codes:"NI"}),
      row({ai_value:"GD",final_value:"DT",decision:"REJECTED",confidence:0.85,candidate_codes:"GD|DT"})
    ];
    const repo={
      damageAccuracyRows:async()=>rows
    } as Pick<CedexRepository,"damageAccuracyRows">;

    const report=await new DamageAccuracyService(repo).report();

    expect(report.allConfirmedPaa.samples).toBe(2);
    expect(report.photoVisualFocus.samples).toBe(1);
    expect(report.photoVisualFocus.top1Accuracy).toBe(1);
    expect(report.excludedContextDependentCodes).toContain("NI");
  });

  it("marks the benchmark ready only after five confirmed examples for every photo-visible code",async()=>{
    const rows:DamageAccuracyRow[]=[];
    for(const code of ["BN","CK","CO","CU","DT","DY","GD","ML","PF"]){
      for(let i=0;i<5;i++){
        rows.push(row({
          ai_value:code,
          final_value:code,
          decision:"APPROVED",
          confidence:0.93,
          candidate_codes:code,
          request_context_json:JSON.stringify({needsReview:false})
        }));
      }
    }
    const repo={
      damageAccuracyRows:async()=>rows
    } as Pick<CedexRepository,"damageAccuracyRows">;

    const report=await new DamageAccuracyService(repo).report();

    expect(report.photoVisualFocus.samples).toBe(45);
    expect(report.photoVisualFocus.top1Accuracy).toBe(1);
    expect(report.benchmarkReady).toBe(true);
    expect(report.perCode.every(item=>item.coverageReady)).toBe(true);
  });
});
