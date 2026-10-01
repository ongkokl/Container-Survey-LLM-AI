import { CedexRepository } from "../infrastructure/d1/cedexRepository";
import { OverviewCombinedClassificationService } from "./overviewCombinedClassificationService";

type AiRunner={run(model:string,input:unknown):Promise<unknown>};

export class OverviewAutoAnalysisService{
  private readonly combinedService:OverviewCombinedClassificationService;

  constructor(private readonly repo:CedexRepository,private readonly ai:AiRunner){
    this.combinedService=new OverviewCombinedClassificationService(repo,ai);
  }

  async analyse(input:{
    findingId:string;
    file:File;
    damageBox?:unknown;
    locationCode?:string|null;
  }){
    const startedAt=Date.now();
    const context=await this.repo.findingContext(input.findingId);
    if(!context)throw new Error("Finding not found.");

    const combined=await this.combinedService.analyse(input);
    const componentStatus=combined.analysisStatus==="SUGGESTED"
      ?combined.componentNeedsReview?"REVIEW_REQUIRED":"SUGGESTED"
      :combined.componentCode?"REVIEW_REQUIRED":"FAILED";
    await this.repo.saveComponentPrediction({
      findingId:input.findingId,
      surveyId:context.survey_id,
      modelName:combined.model,
      selectedCode:combined.componentCode,
      confidence:combined.componentConfidence,
      candidates:combined.componentCandidates,
      response:combined,
      status:componentStatus,
      requestContext:{
        source:"ZERO_TOUCH_OVERVIEW_POC",
        classificationMode:combined.classificationMode,
        damageBox:combined.damageBox,
        locationCode:combined.locationCode,
        manualTargetUsed:false,
        componentPinpointUsed:false
      }
    });

    const damageStatus=combined.analysisStatus==="SUGGESTED"
      ?combined.damageNeedsReview?"REVIEW_REQUIRED":"SUGGESTED"
      :combined.selectedCode?"REVIEW_REQUIRED":"FAILED";
    await this.repo.saveDamagePrediction({
      findingId:input.findingId,
      surveyId:context.survey_id,
      modelName:combined.model,
      selectedCode:combined.selectedCode,
      confidence:combined.confidence,
      candidates:combined.candidates,
      response:combined,
      status:damageStatus,
      requestContext:{
        source:"ZERO_TOUCH_OVERVIEW_POC",
        classificationMode:combined.classificationMode,
        autoComponentCode:combined.componentCode,
        autoComponentConfidence:combined.componentConfidence,
        damageBox:combined.damageBox,
        locationCode:combined.locationCode,
        manualDamageBoxUsed:false,
        manualTargetUsed:false
      }
    });

    return {
      ...combined,
      timings:{
        ...combined.timings,
        totalAutoAnalysisMs:Date.now()-startedAt
      }
    };
  }
}
