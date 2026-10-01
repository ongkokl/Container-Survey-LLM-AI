import { CedexRepository } from "../infrastructure/d1/cedexRepository";
import { OverviewCombinedClassificationService } from "./overviewCombinedClassificationService";
import { OverviewUnifiedZeroTouchService } from "./overviewUnifiedZeroTouchService";

type AiRunner={run(model:string,input:unknown):Promise<unknown>};

export class OverviewAutoAnalysisService{
  private readonly combinedService:OverviewCombinedClassificationService;
  private readonly unifiedService:OverviewUnifiedZeroTouchService;

  constructor(
    private readonly repo:CedexRepository,
    private readonly ai:AiRunner,
    dependencies?:{
      combinedService?:OverviewCombinedClassificationService;
      unifiedService?:OverviewUnifiedZeroTouchService;
    }
  ){
    this.combinedService=dependencies?.combinedService??new OverviewCombinedClassificationService(repo,ai);
    this.unifiedService=dependencies?.unifiedService??new OverviewUnifiedZeroTouchService(repo,ai);
  }

  private async saveClassificationPredictions(
    context:{survey_id:string},
    findingId:string,
    result:{
      analysisStatus:string;
      model:string;
      classificationMode:string;
      imageScope:string;
      damageBox:unknown;
      locationCode:string|null;
      componentCode:string|null;
      componentConfidence:number|null;
      componentNeedsReview:boolean;
      componentCandidates:Array<{code:string;confidence:number|null;reason?:string}>;
      selectedCode:string|null;
      confidence:number|null;
      damageNeedsReview:boolean;
      candidates:Array<{code:string;confidence:number|null;reason?:string}>;
      localization?:{localizationSource?:string|null}|null;
      [key:string]:unknown;
    },
    manualTargetUsed:boolean
  ){
    const componentStatus=result.analysisStatus==="SUGGESTED"
      ?result.componentNeedsReview?"REVIEW_REQUIRED":"SUGGESTED"
      :result.componentCode?"REVIEW_REQUIRED":"FAILED";
    await this.repo.saveComponentPrediction({
      findingId,
      surveyId:context.survey_id,
      modelName:result.model,
      selectedCode:result.componentCode,
      confidence:result.componentConfidence,
      candidates:result.componentCandidates,
      response:result,
      status:componentStatus,
      requestContext:{
        source:"ZERO_TOUCH_OVERVIEW_POC",
        classificationMode:result.classificationMode,
        imageScope:result.imageScope,
        damageBox:result.damageBox,
        locationCode:result.locationCode,
        localizationSource:result.localization?.localizationSource??null,
        unifiedQwen:result.classificationMode==="SINGLE_QWEN_LOCALIZATION_COMPONENT_DAMAGE",
        manualTargetUsed,
        componentPinpointUsed:false
      }
    });

    const damageStatus=result.analysisStatus==="SUGGESTED"
      ?result.damageNeedsReview?"REVIEW_REQUIRED":"SUGGESTED"
      :result.selectedCode?"REVIEW_REQUIRED":"FAILED";
    await this.repo.saveDamagePrediction({
      findingId,
      surveyId:context.survey_id,
      modelName:result.model,
      selectedCode:result.selectedCode,
      confidence:result.confidence,
      candidates:result.candidates,
      response:result,
      status:damageStatus,
      requestContext:{
        source:"ZERO_TOUCH_OVERVIEW_POC",
        classificationMode:result.classificationMode,
        imageScope:result.imageScope,
        autoComponentCode:result.componentCode,
        autoComponentConfidence:result.componentConfidence,
        damageBox:result.damageBox,
        locationCode:result.locationCode,
        localizationSource:result.localization?.localizationSource??null,
        unifiedQwen:result.classificationMode==="SINGLE_QWEN_LOCALIZATION_COMPONENT_DAMAGE",
        manualDamageBoxUsed:manualTargetUsed,
        manualTargetUsed
      }
    });
  }

  async analyse(input:{
    findingId:string;
    file:File;
    damageBox?:unknown;
    locationCode?:string|null;
    imageWidth?:number;
    imageHeight?:number;
    captureMetadata?:unknown;
    orchestrateLocalization?:boolean;
  }){
    const context=await this.repo.findingContext(input.findingId);
    if(!context)throw new Error("Finding not found.");
    const shouldLocate=Boolean(input.orchestrateLocalization||!input.damageBox);

    if(shouldLocate){
      const result=await this.unifiedService.analyse({
        findingId:input.findingId,
        file:input.file,
        imageWidth:Number(input.imageWidth)||0,
        imageHeight:Number(input.imageHeight)||0,
        captureMetadata:input.captureMetadata
      });
      if(result.damageBox){
        await this.saveClassificationPredictions(context,input.findingId,result,false);
      }
      return result;
    }

    const combined=await this.combinedService.analyse({
      findingId:input.findingId,
      file:input.file,
      damageBox:input.damageBox,
      locationCode:(input.locationCode??"").trim().toUpperCase()||null,
      imageScope:"CROP"
    });
    await this.saveClassificationPredictions(context,input.findingId,combined,true);
    return combined;
  }
}
