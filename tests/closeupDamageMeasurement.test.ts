import { describe, expect, it } from "vitest";
import { refineCloseupDamageMeasurement } from "../src/domain/container/closeupDamageMeasurement";

describe("close-up damage measurement refinement",()=>{
  const overview={
    spanXmm:1000,
    spanYmm:500,
    majorMm:1000,
    minorMm:500,
    majorCm:100,
    minorCm:50,
    xAxis:"LONGITUDINAL",
    yAxis:"VERTICAL",
    method:"FIXED_CAMERA_HOMOGRAPHY",
    source:"OVERVIEW_DAMAGE_BOX",
    planeProjected:true,
    requiresSurveyorVerification:true
  };

  it("refines overview physical extent using the AI close-up damage box",()=>{
    const result=refineCloseupDamageMeasurement({
      overviewMeasurement:overview,
      closeupDamageBox:{x:0.2,y:0.25,width:0.5,height:0.4}
    });

    expect(result.source).toBe("CLOSEUP_DAMAGE_BOX_RELATIVE_TO_OVERVIEW_ROI");
    expect(result.method).toBe("FIXED_CAMERA_OVERVIEW_ROI_X_CLOSEUP_BOX");
    expect(result.spanXmm).toBe(500);
    expect(result.spanYmm).toBe(200);
    expect(result.majorCm).toBe(50);
    expect(result.minorCm).toBe(20);
    expect(result.closeupCoverage).toEqual({widthPct:50,heightPct:40});
    expect(result.framingAssumption).toBe("CLOSEUP_FRAME_MATCHES_OVERVIEW_DAMAGE_ROI");
    expect(result.requiresSurveyorVerification).toBe(true);
    expect(result.productionZoomCalibrationRequired).toBe(true);
  });

  it("flags a damage box that touches the close-up edge",()=>{
    const result=refineCloseupDamageMeasurement({
      overviewMeasurement:overview,
      closeupDamageBox:{x:0,y:0.2,width:0.7,height:0.5}
    });
    expect(result.quality.touchesImageEdge).toBe(true);
    expect(result.quality.reason).toContain("full damage may not be visible");
  });

  it("flags a very small close-up detection",()=>{
    const result=refineCloseupDamageMeasurement({
      overviewMeasurement:overview,
      closeupDamageBox:{x:0.4,y:0.4,width:0.03,height:0.03}
    });
    expect(result.quality.verySmallDetection).toBe(true);
    expect(result.quality.reason).toContain("tighter optical zoom");
  });

  it("rejects an invalid close-up box",()=>{
    expect(()=>refineCloseupDamageMeasurement({
      overviewMeasurement:overview,
      closeupDamageBox:{x:0.9,y:0.2,width:0.2,height:0.3}
    })).toThrow("Close-up damage box is invalid");
  });
});
