import { CedexRepository } from "../infrastructure/d1/cedexRepository";
import { MoondreamDamageMarker } from "../infrastructure/ai/moondreamDamageMarker";
import { LocationSuggestionService } from "./locationSuggestionService";
import { OverviewCombinedClassificationService } from "./overviewCombinedClassificationService";

type AiRunner={run(model:string,input:unknown):Promise<unknown>};

export class OverviewAutoAnalysisService{
  private readonly combinedService:OverviewCombinedClassificationService;
  private readonly locationService:LocationSuggestionService;

  constructor(
    private readonly repo:CedexRepository,
    private readonly ai:AiRunner,
    dependencies?:{
      combinedService?:OverviewCombinedClassificationService;
      locationService?:LocationSuggestionService;
    }
  ){
    this.combinedService=dependencies?.combinedService??new OverviewCombinedClassificationService(repo,ai);
    this.locationService=dependencies?.locationService??new LocationSuggestionService(repo,new MoondreamDamageMarker(ai));
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
    const startedAt=Date.now();
    const context=await this.repo.findingContext(input.findingId);
    if(!context)throw new Error("Finding not found.");

    let localization:Awaited<ReturnType<LocationSuggestionService["analyse"]>>|null=null;
    let damageBox=input.damageBox;
    let locationCode=(input.locationCode??"").trim().toUpperCase()||null;
    const shouldLocate=Boolean(input.orchestrateLocalization||!damageBox);

    if(shouldLocate){
      const localizationStartedAt=Date.now();
      localization=await this.locationService.analyse({
        findingId:input.findingId,
        file:input.file,
        imageWidth:Number(input.imageWidth)||0,
        imageHeight:Number(input.imageHeight)||0,
        captureMetadata:input.captureMetadata
      });
      const localizationMs=Date.now()-localizationStartedAt;
      damageBox=localization.damageBox??null;
      locationCode=localization.location?.code??null;

      if(!localization.found||!damageBox){
        return {
          pocMode:"ZERO_TOUCH_OVERVIEW",
          source:"FULL_OVERVIEW_ORCHESTRATOR",
          classificationMode:null,
          analysisStatus:"ABSTAINED" as const,
          damageBox:null,
          locationCode,
          componentCode:null,
          componentName:null,
          componentConfidence:null,
          componentNeedsReview:true,
          componentReason:"Component classification was skipped because no reliable primary damage target was localized.",
          componentCandidates:[],
          selectedCode:null,
          selectedName:null,
          confidence:null,
          damageNeedsReview:true,
          damageReason:"Damage classification was skipped because no reliable primary damage target was localized.",
          candidates:[],
          needsReview:true,
          localization,
          timings:{
            localizationMs,
            classificationAiMs:0,
            totalClassificationMs:0,
            totalAutoAnalysisMs:Date.now()-startedAt
          }
        };
      }
    }

    const combined=await this.combinedService.analyse({
      findingId:input.findingId,
      file:input.file,
      damageBox,
      locationCode,
      imageScope:shouldLocate?"FULL_OVERVIEW":"CROP"
    });
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
      response:{...combined,localization},
      status:componentStatus,
      requestContext:{
        source:"ZERO_TOUCH_OVERVIEW_POC",
        classificationMode:combined.classificationMode,
        imageScope:combined.imageScope,
        damageBox:combined.damageBox,
        locationCode:combined.locationCode,
        localizationSource:localization?.localizationSource??null,
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
      response:{...combined,localization},
      status:damageStatus,
      requestContext:{
        source:"ZERO_TOUCH_OVERVIEW_POC",
        classificationMode:combined.classificationMode,
        imageScope:combined.imageScope,
        autoComponentCode:combined.componentCode,
        autoComponentConfidence:combined.componentConfidence,
        damageBox:combined.damageBox,
        locationCode:combined.locationCode,
        localizationSource:localization?.localizationSource??null,
        manualDamageBoxUsed:false,
        manualTargetUsed:false
      }
    });

    return {
      ...combined,
      source:shouldLocate?"FULL_OVERVIEW_ORCHESTRATOR":combined.source,
      localization,
      timings:{
        localizationMs:localization?Math.max(0,Date.now()-startedAt-combined.timings.totalClassificationMs):0,
        ...combined.timings,
        totalAutoAnalysisMs:Date.now()-startedAt
      }
    };
  }
}
