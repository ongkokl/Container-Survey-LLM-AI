import { CedexRepository } from "../infrastructure/d1/cedexRepository";

export class RepairRecommendationService{
  constructor(private readonly repo:CedexRepository){}

  async analyse(findingId:string){
    const context=await this.repo.findingContext(findingId);
    if(!context)throw new Error("Finding not found.");

    const allowed=await this.repo.repairCodesForFinding(findingId);
    if(!allowed.repairs.length){
      throw new Error(`No verified GP.xlsx repair methods are loaded for ${allowed.equipment} ${allowed.componentCode} + ${allowed.damageCode}.`);
    }

    const result={
      equipment:allowed.equipment,
      componentCode:allowed.componentCode,
      damageCode:allowed.damageCode,
      analysisStatus:"RULES_ONLY",
      selectedCode:null,
      confidence:null,
      needsReview:true,
      reviewPolicy:"SURVEYOR_SELECTION_REQUIRED",
      recommendationMode:"GP_XLSX_RULES_ONLY",
      reason:"GP.xlsx defines the valid repair methods. Select the final method after measurement and physical inspection.",
      candidates:[],
      allowedRepairs:allowed.repairs,
      allowedRepairCount:allowed.repairs.length,
      repairRuleSource:allowed.repairs.every(x=>x.standard_version==="GP.xlsx")?"GP.xlsx":"MIXED",
      model:null
    };

    await this.repo.saveRepairPrediction({
      findingId,
      surveyId:context.survey_id,
      modelName:"RULES_ONLY",
      selectedCode:null,
      confidence:null,
      candidates:[],
      response:result,
      status:"REVIEW_REQUIRED",
      requestContext:{
        equipment:allowed.equipment,
        componentCode:allowed.componentCode,
        damageCode:allowed.damageCode,
        allowedRepairCodes:allowed.repairs.map(x=>x.repair_code),
        reviewPolicy:"SURVEYOR_SELECTION_REQUIRED",
        recommendationMode:"GP_XLSX_RULES_ONLY",
        repairRuleSource:"GP.xlsx"
      }
    });

    return result;
  }
}
