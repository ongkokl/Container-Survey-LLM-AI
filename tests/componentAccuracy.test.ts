import { describe, expect, it } from "vitest";
import { ComponentAccuracyService } from "../src/application/componentAccuracyService";
import type { ComponentAccuracyRow, CedexRepository } from "../src/infrastructure/d1/cedexRepository";

function row(input:Partial<ComponentAccuracyRow>&Pick<ComponentAccuracyRow,"final_value">):ComponentAccuracyRow{
  return {
    ai_value:null,
    decision:"CORRECTED",
    confidence:null,
    candidate_codes:null,
    request_context_json:null,
    container_face:"DOOR",
    equipment_type:"GP",
    created_at:"2026-09-28T00:00:00.000Z",
    ...input,
    final_value:input.final_value
  };
}

describe("component accuracy benchmark",()=>{
  it("calculates top-1, top-3, confusion and family-shortlist performance from surveyor decisions",async()=>{
    const rows:ComponentAccuracyRow[]=[
      row({
        ai_value:"LBB",final_value:"LBB",decision:"APPROVED",confidence:0.92,
        candidate_codes:"LBB|HWR|LBR",
        request_context_json:JSON.stringify({
          componentFamilyNarrowingUsed:true,
          classificationAllowedComponentCount:5,
          allowedComponentCount:39
        })
      }),
      row({
        ai_value:"HWH",final_value:"HWR",decision:"CORRECTED",confidence:0.84,
        candidate_codes:"HWH|HWR|LBB",
        request_context_json:JSON.stringify({
          componentFamilyNarrowingUsed:true,
          classificationAllowedComponentCount:5,
          allowedComponentCount:39
        })
      }),
      row({
        ai_value:"LBG",final_value:"LBR",decision:"CORRECTED",confidence:0.74,
        candidate_codes:"LBG|LBB|LBR",
        request_context_json:JSON.stringify({
          componentFamilyFallbackUsed:true,
          classificationAllowedComponentCount:39,
          allowedComponentCount:39
        })
      }),
      row({
        ai_value:"PAA",final_value:"PAA",decision:"APPROVED",confidence:0.96,
        candidate_codes:"PAA|DFA",
        request_context_json:JSON.stringify({
          componentFamilyFallbackUsed:true,
          classificationAllowedComponentCount:39,
          allowedComponentCount:39
        })
      })
    ];
    const repo={
      componentAccuracyRows:async()=>rows
    } as Pick<CedexRepository,"componentAccuracyRows">;

    const report=await new ComponentAccuracyService(repo).report();

    expect(report.source).toBe("SURVEYOR_CONFIRMED_COMPONENT_DECISIONS");
    expect(report.focus.samples).toBe(4);
    expect(report.focus.top1Accuracy).toBe(0.5);
    expect(report.focus.top3HitRate).toBe(1);
    expect(report.familyShortlist.narrowed.samples).toBe(2);
    expect(report.familyShortlist.narrowed.top1Accuracy).toBe(0.5);
    expect(report.familyShortlist.fallback.samples).toBe(2);
    expect(report.familyShortlist.fallback.top1Accuracy).toBe(0.5);
    expect(report.familyShortlist.averageClassificationAllowedCount).toBe(22);
    expect(report.familyShortlist.averageFullAllowedCount).toBe(39);
    expect(report.confusions).toContainEqual({expectedCode:"HWR",aiCode:"HWH",count:1});
    expect(report.confusions).toContainEqual({expectedCode:"LBR",aiCode:"LBG",count:1});
    expect(report.perCode.find(item=>item.code==="PAA")?.samples).toBe(1);
    expect(report.benchmarkReady).toBe(false);
  });

  it("ignores rejected decisions and non-focus codes in the focus score",async()=>{
    const rows:ComponentAccuracyRow[]=[
      row({ai_value:"LBB",final_value:"LBB",decision:"APPROVED",confidence:0.9,candidate_codes:"LBB"}),
      row({ai_value:"DFA",final_value:"DFA",decision:"APPROVED",confidence:0.9,candidate_codes:"DFA"}),
      row({ai_value:"HWH",final_value:"HWR",decision:"REJECTED",confidence:0.9,candidate_codes:"HWH|HWR"})
    ];
    const repo={
      componentAccuracyRows:async()=>rows
    } as Pick<CedexRepository,"componentAccuracyRows">;

    const report=await new ComponentAccuracyService(repo).report();

    expect(report.overall.samples).toBe(2);
    expect(report.focus.samples).toBe(1);
    expect(report.focus.top1Accuracy).toBe(1);
  });
});
