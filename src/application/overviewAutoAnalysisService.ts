import { CedexRepository } from "../infrastructure/d1/cedexRepository";
import { OverviewComponentPocService } from "./overviewComponentPocService";
import { OverviewDamagePocService } from "./overviewDamagePocService";

type AiRunner={run(model:string,input:unknown):Promise<unknown>};

export class OverviewAutoAnalysisService{
  private readonly componentService:OverviewComponentPocService;
  private readonly damageService:OverviewDamagePocService;

  constructor(private readonly repo:CedexRepository,private readonly ai:AiRunner){
    this.componentService=new OverviewComponentPocService(repo,ai);
    this.damageService=new OverviewDamagePocService(repo,ai);
  }

  async analyse(input:{
    findingId:string;
    file:File;
    damageBox?:unknown;
    locationCode?:string|null;
  }){
    const context=await this.repo.findingContext(input.findingId);
    if(!context)throw new Error("Finding not found.");

    const component=await this.componentService.analyse(input);
    const componentStatus=component.analysisStatus==="SUGGESTED"
      ?component.needsReview?"REVIEW_REQUIRED":"SUGGESTED"
      :"FAILED";
    await this.repo.saveComponentPrediction({
      findingId:input.findingId,
      surveyId:context.survey_id,
      modelName:component.model,
      selectedCode:component.selectedCode,
      confidence:component.confidence,
      candidates:component.candidates,
      response:component,
      status:componentStatus,
      requestContext:{
        source:"ZERO_TOUCH_OVERVIEW_POC",
        damageBox:component.damageBox,
        locationCode:component.locationCode,
        overviewZone:component.overviewZone,
        manualTargetUsed:false,
        componentPinpointUsed:false
      }
    });

    if(!component.selectedCode){
      return {
        pocMode:"ZERO_TOUCH_OVERVIEW",
        source:"AI_DETECTED_OVERVIEW_CROP",
        damageBox:component.damageBox,
        locationCode:component.locationCode,
        componentCode:null,
        componentName:null,
        componentConfidence:component.confidence,
        componentNeedsReview:true,
        componentReason:component.reason,
        componentCandidates:component.candidates,
        selectedCode:null,
        selectedName:null,
        confidence:null,
        damageNeedsReview:true,
        damageReason:"Damage classification was skipped because the component was not reliable.",
        candidates:[],
        needsReview:true,
        analysisStatus:component.analysisStatus,
        component,
        damage:null
      };
    }

    const damage=await this.damageService.analyse({
      ...input,
      componentCode:component.selectedCode
    });
    const damageStatus=damage.analysisStatus==="SUGGESTED"
      ?damage.needsReview?"REVIEW_REQUIRED":"SUGGESTED"
      :"FAILED";
    await this.repo.saveDamagePrediction({
      findingId:input.findingId,
      surveyId:context.survey_id,
      modelName:damage.model,
      selectedCode:damage.selectedCode,
      confidence:damage.confidence,
      candidates:damage.candidates,
      response:damage,
      status:damageStatus,
      requestContext:{
        source:"ZERO_TOUCH_OVERVIEW_POC",
        autoComponentCode:component.selectedCode,
        autoComponentConfidence:component.confidence,
        damageBox:damage.damageBox,
        locationCode:damage.locationCode,
        manualDamageBoxUsed:false,
        manualTargetUsed:false
      }
    });

    const locationCode=(input.locationCode??"").trim().toUpperCase()||null;
    const needsReview=Boolean(
      component.needsReview||
      damage.needsReview||
      !locationCode
    );
    const analysisStatus=
      ["INCOMPLETE","INVALID_RESPONSE"].includes(component.analysisStatus)
        ?component.analysisStatus
        :["INCOMPLETE","INVALID_RESPONSE"].includes(damage.analysisStatus)
          ?damage.analysisStatus
          :component.selectedCode&&damage.selectedCode?"SUGGESTED":"ABSTAINED";

    return {
      pocMode:"ZERO_TOUCH_OVERVIEW",
      source:"AI_DETECTED_OVERVIEW_CROP",
      damageBox:damage.damageBox,
      locationCode,
      componentCode:component.selectedCode,
      componentName:component.selectedName,
      componentConfidence:component.confidence,
      componentNeedsReview:component.needsReview,
      componentReason:component.reason,
      componentCandidates:component.candidates,
      selectedCode:damage.selectedCode,
      selectedName:damage.selectedName,
      confidence:damage.confidence,
      damageNeedsReview:damage.needsReview,
      damageReason:damage.reason,
      candidates:damage.candidates,
      needsReview,
      analysisStatus,
      component,
      damage
    };
  }
}
