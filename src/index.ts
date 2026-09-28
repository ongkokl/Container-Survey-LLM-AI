import {
  ContainerIdentificationError,
  ContainerIdentificationService
} from "./application/containerIdentificationService";
import {
  DoorIdentificationError,
  DoorIdentificationService
} from "./application/doorIdentificationService";
import { QwenDoorIdentityProvider } from "./infrastructure/ai/qwenDoorIdentityProvider";
import {
  IdentificationAttemptRepository,
  SurveyRepository
} from "./infrastructure/d1/surveyRepository";
import { PhotoStore } from "./infrastructure/r2/photoStore";
import { FindingRepository } from "./infrastructure/d1/findingRepository";
import { FindingCaptureService } from "./application/findingCaptureService";
import { MoondreamDamageMarker } from "./infrastructure/ai/moondreamDamageMarker";
import { CedexRepository } from "./infrastructure/d1/cedexRepository";
import { CedexClassificationService } from "./application/cedexClassificationService";
import { DamageClassificationService } from "./application/damageClassificationService";
import { RepairRecommendationService } from "./application/repairRecommendationService";
import { LocationSuggestionService } from "./application/locationSuggestionService";
import { FixedCameraCalibrationService } from "./application/fixedCameraCalibrationService";
import { ComponentAccuracyService } from "./application/componentAccuracyService";
import { fixedCameraProfile } from "./domain/container/fixedCameraProfile";

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  AI: Ai;
  ASSETS: Fetcher;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

async function readJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error("Expected application/json request body.");
  }
  return request.json<T>();
}

function identificationService(env: Env): ContainerIdentificationService {
  return new ContainerIdentificationService(new SurveyRepository(env.DB));
}

function doorIdentificationService(env: Env): DoorIdentificationService {
  const ai = env.AI as unknown as {
    run(model: string, input: unknown): Promise<unknown>;
  };

  return new DoorIdentificationService(
    new QwenDoorIdentityProvider(ai),
    new PhotoStore(env.PHOTOS),
    new IdentificationAttemptRepository(env.DB),
    new SurveyRepository(env.DB)
  );
}

function cedexService(env:Env):CedexClassificationService{
  const ai=env.AI as unknown as {run(model:string,input:unknown):Promise<unknown>};
  return new CedexClassificationService(new CedexRepository(env.DB),env.PHOTOS,ai);
}

function findingService(env: Env): FindingCaptureService {
  return new FindingCaptureService(new FindingRepository(env.DB), new PhotoStore(env.PHOTOS));
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === "GET" && url.pathname === "/api/health") {
    return json({
      ok: true,
      service: "Container Survey LLM AI",
      phase: "POC phase 5 - component, damage and repair recommendation",
      visionModel: "@cf/qwen/qwen3.8-27b",
      time: new Date().toISOString()
    });
  }

  if (request.method === "GET" && url.pathname === "/api/qa/component-accuracy") {
    try {
      const requested=Number(url.searchParams.get("limit")??500);
      const limit=Number.isFinite(requested)?Math.max(1,Math.min(2000,Math.trunc(requested))):500;
      const result=await new ComponentAccuracyService(new CedexRepository(env.DB)).report(limit);
      return json({ok:true,result});
    } catch(error) {
      return json({
        ok:false,
        error:"COMPONENT_ACCURACY_REPORT_FAILED",
        message:error instanceof Error?error.message:"Unable to build component accuracy report."
      },422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/vision/mark-damage") {
    try {
      const form=await request.formData(),file=form.get("photo"),mode=String(form.get("mode")??"point");
      if(!(file instanceof File)) throw new Error("A photo is required.");
      if(file.size>8*1024*1024) throw new Error("Photo must be below 8 MB.");
      const ai=env.AI as unknown as {run(model:string,input:unknown):Promise<unknown>};
      const marker=new MoondreamDamageMarker(ai);
      const result=mode==="box"?await marker.detect(file):await marker.point(file);
      return json({ok:true,result});
    } catch(error) {
      return json({ok:false,error:"AI_MARK_FAILED",message:error instanceof Error?error.message:"Unable to locate damage."},422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/vision/locate-overview-damage") {
    try {
      const form=await request.formData();
      const file=form.get("photo");
      if(!(file instanceof File)) throw new Error("A photo is required.");
      if(file.size>8*1024*1024) throw new Error("Photo must be below 8 MB.");
      const captureMetadataRaw=String(form.get("captureMetadata")??"").trim();
      let captureMetadata:unknown=null;
      if(captureMetadataRaw){
        try{captureMetadata=JSON.parse(captureMetadataRaw);}
        catch{throw new Error("Invalid capture metadata.");}
      }
      const ai=env.AI as unknown as {run(model:string,input:unknown):Promise<unknown>};
      const repo=new CedexRepository(env.DB);
      const service=new LocationSuggestionService(repo,new MoondreamDamageMarker(ai));
      const result=await service.analyse({
        findingId:String(form.get("findingId")??""),
        file,
        imageWidth:Number(form.get("width"))||0,
        imageHeight:Number(form.get("height"))||0,
        captureMetadata
      });
      return json({ok:true,result});
    } catch(error) {
      return json({ok:false,error:"LOCATION_SUGGEST_FAILED",message:error instanceof Error?error.message:"Unable to suggest damage location."},422);
    }
  }

  if (request.method === "GET" && url.pathname === "/api/fixed-camera/calibration") {
    try {
      const findingId=url.searchParams.get("findingId")??"";
      const cameraId=url.searchParams.get("cameraId")??"";
      const service=new FixedCameraCalibrationService(new CedexRepository(env.DB));
      return json({ok:true,result:await service.get(findingId,cameraId)});
    } catch(error) {
      return json({ok:false,error:"FIXED_CAMERA_CALIBRATION_LOOKUP_FAILED",message:error instanceof Error?error.message:"Unable to load fixed camera calibration."},422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/fixed-camera/calibration") {
    try {
      const body=await readJson<{findingId?:string;cameraId?:string;corners?:unknown}>(request);
      const service=new FixedCameraCalibrationService(new CedexRepository(env.DB));
      return json({ok:true,result:await service.save({
        findingId:body.findingId??"",
        cameraId:body.cameraId??"",
        corners:body.corners
      })});
    } catch(error) {
      return json({ok:false,error:"FIXED_CAMERA_CALIBRATION_SAVE_FAILED",message:error instanceof Error?error.message:"Unable to save fixed camera calibration."},422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/fixed-camera/end-structure-calibration") {
    try {
      const body=await readJson<{
        findingId?:string;
        cameraId?:string;
        positionGuides?:unknown;
        verticalGuides?:unknown;
      }>(request);
      const service=new FixedCameraCalibrationService(new CedexRepository(env.DB));
      return json({ok:true,result:await service.saveEndStructure({
        findingId:body.findingId??"",
        cameraId:body.cameraId??"",
        positionGuides:body.positionGuides,
        verticalGuides:body.verticalGuides
      })});
    } catch(error) {
      return json({
        ok:false,
        error:"FIXED_CAMERA_END_STRUCTURE_SAVE_FAILED",
        message:error instanceof Error?error.message:"Unable to save Door/Front structure calibration."
      },422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/cedex/location-from-fixed-camera") {
    try {
      const body=await readJson<{
        findingId?:string;
        cameraId?:string;
        damagePoint?:{x:number;y:number}|null;
        damageBox?:{x:number;y:number;width:number;height:number}|null;
      }>(request);
      const service=new FixedCameraCalibrationService(new CedexRepository(env.DB));
      return json({ok:true,result:await service.calculate({
        findingId:body.findingId??"",
        cameraId:body.cameraId??"",
        damagePoint:body.damagePoint??null,
        damageBox:body.damageBox??null
      })});
    } catch(error) {
      return json({ok:false,error:"FIXED_CAMERA_LOCATION_FAILED",message:error instanceof Error?error.message:"Unable to calculate location from fixed camera calibration."},422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/cedex/location-from-face-quad") {
    try {
      const body=await readJson<{
        findingId?:string;
        corners?:Array<{x:number;y:number}>;
        doorEnd?:"LEFT"|"RIGHT";
        damagePoint?:{x:number;y:number}|null;
        damageBox?:{x:number;y:number;width:number;height:number}|null;
      }>(request);
      const repo=new CedexRepository(env.DB);
      const ai=env.AI as unknown as {run(model:string,input:unknown):Promise<unknown>};
      const service=new LocationSuggestionService(repo,new MoondreamDamageMarker(ai));
      const corners=(body.corners??[]) as [
        {x:number;y:number},
        {x:number;y:number},
        {x:number;y:number},
        {x:number;y:number}
      ];
      if(body.doorEnd!=="LEFT"&&body.doorEnd!=="RIGHT"){
        throw new Error("Select the door-end position before calculating location from the four-corner reference.");
      }
      const result=await service.fromFaceQuad({
        findingId:body.findingId??"",
        corners,
        doorEnd:body.doorEnd,
        damagePoint:body.damagePoint??null,
        damageBox:body.damageBox??null
      });
      return json({ok:true,result});
    } catch(error) {
      return json({ok:false,error:"LOCATION_FACE_QUAD_FAILED",message:error instanceof Error?error.message:"Unable to calculate location from marked container face."},422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/cedex/location-from-box") {
    try {
      const body=await readJson<{
        findingId?:string;
        damageBox?:{x:number;y:number;width:number;height:number};
        referenceBox?:{x:number;y:number;width:number;height:number};
      }>(request);
      const repo=new CedexRepository(env.DB);
      const ai=env.AI as unknown as {run(model:string,input:unknown):Promise<unknown>};
      const service=new LocationSuggestionService(repo,new MoondreamDamageMarker(ai));
      const result=await service.fromBox({
        findingId:body.findingId??"",
        damageBox:body.damageBox??{x:Number.NaN,y:Number.NaN,width:Number.NaN,height:Number.NaN},
        referenceBox:body.referenceBox??{x:Number.NaN,y:Number.NaN,width:Number.NaN,height:Number.NaN}
      });
      return json({ok:true,result});
    } catch(error) {
      return json({ok:false,error:"LOCATION_BOX_FAILED",message:error instanceof Error?error.message:"Unable to calculate damage area location."},422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/cedex/location-from-point") {
    try {
      const body=await readJson<{
        findingId?:string;
        point?:{x:number;y:number};
        referenceBox?:{x:number;y:number;width:number;height:number};
      }>(request);
      const repo=new CedexRepository(env.DB);
      const ai=env.AI as unknown as {run(model:string,input:unknown):Promise<unknown>};
      const service=new LocationSuggestionService(repo,new MoondreamDamageMarker(ai));
      const result=await service.fromPoint({
        findingId:body.findingId??"",
        point:body.point??{x:Number.NaN,y:Number.NaN},
        referenceBox:body.referenceBox??{x:Number.NaN,y:Number.NaN,width:Number.NaN,height:Number.NaN}
      });
      return json({ok:true,result});
    } catch(error) {
      return json({ok:false,error:"LOCATION_POINT_FAILED",message:error instanceof Error?error.message:"Unable to calculate damage location."},422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/cedex/location-decision") {
    try {
      const body=await readJson<{findingId?:string;finalCode?:string}>(request);
      const result=await new CedexRepository(env.DB).decideLocation({
        findingId:body.findingId??"",
        finalCode:body.finalCode??""
      });
      return json({ok:true,result});
    } catch(error) {
      return json({ok:false,error:"LOCATION_DECISION_FAILED",message:error instanceof Error?error.message:"Unable to save location code."},422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/cedex/component-suggest") {
    const startedAt=Date.now();
    let findingId="";
    try {
      const body=await readJson<{findingId?:string}>(request);
      findingId=body.findingId??"";
      console.log(JSON.stringify({
        scope:"COMPONENT_ANALYSIS",
        event:"HTTP_REQUEST",
        findingId
      }));
      const result=await cedexService(env).analyseComponent(findingId);
      if(result.analysisStatus==="INCOMPLETE"||result.analysisStatus==="INVALID_RESPONSE"){
        console.warn(JSON.stringify({
          scope:"COMPONENT_ANALYSIS",
          event:"HTTP_422",
          findingId,
          analysisStatus:result.analysisStatus,
          selectedCode:result.selectedCode,
          totalDurationMs:Date.now()-startedAt
        }));
        return json({ok:false,error:"CEDEX_COMPONENT_"+result.analysisStatus,message:result.reason,result},422);
      }
      return json({ok:true,result});
    } catch(error) {
      console.error(JSON.stringify({
        scope:"COMPONENT_ANALYSIS",
        event:"ERROR",
        findingId,
        message:error instanceof Error?error.message:"Unable to classify component.",
        totalDurationMs:Date.now()-startedAt
      }));
      return json({ok:false,error:"CEDEX_COMPONENT_FAILED",message:error instanceof Error?error.message:"Unable to classify component."},422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/cedex/component-decision") {
    try {
      const body=await readJson<{findingId?:string;finalCode?:string}>(request);
      const repo=new CedexRepository(env.DB);
      return json({ok:true,result:await repo.decideComponent({findingId:body.findingId??"",finalCode:body.finalCode??""})});
    } catch(error) {
      return json({ok:false,error:"CEDEX_COMPONENT_DECISION_FAILED",message:error instanceof Error?error.message:"Unable to save component decision."},422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/cedex/damage-suggest") {
    try {
      const body=await readJson<{findingId?:string}>(request);
      const ai=env.AI as unknown as {run(model:string,input:unknown):Promise<unknown>};
      const service=new DamageClassificationService(new CedexRepository(env.DB),env.PHOTOS,ai);
      const result=await service.analyse(body.findingId??"");
      if(result.analysisStatus==="INCOMPLETE"||result.analysisStatus==="INVALID_RESPONSE"){
        return json({ok:false,error:"CEDEX_DAMAGE_"+result.analysisStatus,message:result.reason,result},422);
      }
      return json({ok:true,result});
    } catch(error) {
      return json({ok:false,error:"CEDEX_DAMAGE_FAILED",message:error instanceof Error?error.message:"Unable to classify damage."},422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/cedex/damage-decision") {
    try {
      const body=await readJson<{findingId?:string;finalCode?:string}>(request);
      return json({ok:true,result:await new CedexRepository(env.DB).decideDamage({findingId:body.findingId??"",finalCode:body.finalCode??""})});
    } catch(error) {
      return json({ok:false,error:"CEDEX_DAMAGE_DECISION_FAILED",message:error instanceof Error?error.message:"Unable to save damage decision."},422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/findings/geometry") {
    try {
      const body=await readJson<{findingId?:string}>(request);
      const result=await new CedexRepository(env.DB).geometryForFinding(body.findingId??"");
      if(!result) return json({ok:false,error:"GEOMETRY_PROFILE_UNAVAILABLE",message:"Known container geometry is not available for this finding yet."},422);
      return json({ok:true,result});
    } catch(error) {
      return json({ok:false,error:"GEOMETRY_LOOKUP_FAILED",message:error instanceof Error?error.message:"Unable to load container geometry."},422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/cedex/repair-suggest") {
    try {
      const body=await readJson<{findingId?:string}>(request);
      const service=new RepairRecommendationService(new CedexRepository(env.DB));
      const result=await service.analyse(body.findingId??"");
      return json({ok:true,result});
    } catch(error) {
      return json({ok:false,error:"CEDEX_REPAIR_FAILED",message:error instanceof Error?error.message:"Unable to recommend repair method."},422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/cedex/repair-decision") {
    try {
      const body=await readJson<{
        findingId?:string;
        finalCode?:string;
        measurements?:{
          damageLengthCm?:number|null;
          damageWidthCm?:number|null;
          damageDepthCm?:number|null;
          corrugationsAffected?:number|null;
          deformationDirection?:"INWARD"|"OUTWARD"|"UNKNOWN"|null;
          notes?:string|null;
        };
      }>(request);
      return json({ok:true,result:await new CedexRepository(env.DB).decideRepair({
        findingId:body.findingId??"",
        finalCode:body.finalCode??"",
        measurements:body.measurements
      })});
    } catch(error) {
      return json({ok:false,error:"CEDEX_REPAIR_DECISION_FAILED",message:error instanceof Error?error.message:"Unable to save repair decision."},422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/findings") {
    try {
      const body=await readJson<{surveyId?:string;cameraId?:string;containerFace?:string}>(request);
      const camera=body.cameraId?fixedCameraProfile(body.cameraId):null;
      if(body.cameraId&&!camera)throw new Error("Select a valid fixed camera: R, L, D, F, T or B.");
      const face=camera?.face??body.containerFace??"";
      const result=await findingService(env).create(body.surveyId??"",face);
      return json({ok:true,result:{...result,fixed_camera:camera}},201);
    } catch(error) {
      return json({ok:false,error:"FINDING_CREATE_FAILED",message:error instanceof Error?error.message:"Unable to create finding."},422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/findings/face") {
    try {
      const body=await readJson<{findingId?:string;containerFace?:string}>(request);
      const result=await findingService(env).updateFace(body.findingId??"",body.containerFace??"");
      return json({ok:true,result});
    } catch(error) {
      return json({ok:false,error:"FINDING_FACE_UPDATE_FAILED",message:error instanceof Error?error.message:"Unable to update the finding face."},422);
    }
  }

  if (request.method === "GET" && url.pathname === "/api/findings") {
    try {
      const surveyId=url.searchParams.get("surveyId")??"";
      return json({ok:true,result:await findingService(env).list(surveyId)});
    } catch(error) {
      return json({ok:false,error:"FINDING_LIST_FAILED",message:error instanceof Error?error.message:"Unable to list findings."},422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/findings/photo") {
    try {
      const form=await request.formData();
      const file=form.get("photo");
      if(!(file instanceof File)) throw new Error("A photo is required.");
      const captureMetadataRaw=String(form.get("captureMetadata")??"").trim();
      let captureMetadata:unknown=null;
      if(captureMetadataRaw){
        try{captureMetadata=JSON.parse(captureMetadataRaw);}
        catch{throw new Error("Invalid capture metadata.");}
      }
      const result=await findingService(env).upload({
        surveyId:String(form.get("surveyId")??""),
        findingId:String(form.get("findingId")??""),
        role:String(form.get("role")??""),
        file,
        width:Number(form.get("width"))||null,
        height:Number(form.get("height"))||null,
        captureMetadata
      });
      return json({ok:true,result},201);
    } catch(error) {
      return json({ok:false,error:"PHOTO_UPLOAD_FAILED",message:error instanceof Error?error.message:"Unable to upload photo."},422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/annotations") {
    try {
      const body=await readJson<{photoId?:string;annotationType?:string;geometryType?:string;geometry?:unknown;createdBy?:"AI"|"SURVEYOR"}>(request);
      const result=await findingService(env).annotate({
        photoId:body.photoId??"",annotationType:body.annotationType??"",
        geometryType:body.geometryType??"",geometry:body.geometry,createdBy:body.createdBy
      });
      return json({ok:true,result},201);
    } catch(error) {
      return json({ok:false,error:"ANNOTATION_FAILED",message:error instanceof Error?error.message:"Unable to save annotation."},422);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/door/identify") {
    try {
      const form = await request.formData();
      const value = form.get("doorPhoto");

      if (!(value instanceof File)) {
        throw new DoorIdentificationError(
          "A door photo is required.",
          "IMAGE_REQUIRED"
        );
      }

      const result = await doorIdentificationService(env).analyse(value);
      return json({ ok: true, result });
    } catch (error) {
      if (error instanceof DoorIdentificationError) {
        return json(
          { ok: false, error: error.code, message: error.message },
          422
        );
      }

      return json(
        {
          ok: false,
          error: "DOOR_OCR_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Unable to analyse the container door photo."
        },
        502
      );
    }
  }

  if (request.method === "POST" && url.pathname === "/api/door/confirm") {
    try {
      const body = await readJson<{
        attemptId?: string;
        containerNo?: string;
        isoSizeType?: string;
        depotCode?: string;
      }>(request);

      const result = await doorIdentificationService(env).confirm({
        attemptId: body.attemptId ?? "",
        containerNo: body.containerNo ?? "",
        isoSizeType: body.isoSizeType ?? "",
        depotCode: body.depotCode
      });

      return json(
        { ok: true, result },
        result.survey.resumed ? 200 : 201
      );
    } catch (error) {
      if (error instanceof DoorIdentificationError) {
        return json(
          { ok: false, error: error.code, message: error.message },
          422
        );
      }

      return json(
        {
          ok: false,
          error: "DOOR_CONFIRM_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "Unable to confirm the container identity."
        },
        500
      );
    }
  }

  if (request.method === "POST" && url.pathname === "/api/container/validate") {
    try {
      const body = await readJson<{
        containerNo?: string;
        isoSizeType?: string;
        depotCode?: string;
      }>(request);

      const result = await identificationService(env).validate({
        containerNo: body.containerNo ?? "",
        isoSizeType: body.isoSizeType ?? "",
        depotCode: body.depotCode
      });

      return json({ ok: true, result });
    } catch (error) {
      if (error instanceof ContainerIdentificationError) {
        return json(
          { ok: false, error: error.code, message: error.message },
          422
        );
      }

      return json(
        {
          ok: false,
          error: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Invalid request."
        },
        400
      );
    }
  }

  if (request.method === "POST" && url.pathname === "/api/surveys/start") {
    try {
      const body = await readJson<{
        containerNo?: string;
        isoSizeType?: string;
        depotCode?: string;
      }>(request);

      const result = await identificationService(env).startOrResume({
        containerNo: body.containerNo ?? "",
        isoSizeType: body.isoSizeType ?? "",
        depotCode: body.depotCode
      });

      return json({ ok: true, result }, result.survey.resumed ? 200 : 201);
    } catch (error) {
      if (error instanceof ContainerIdentificationError) {
        return json(
          { ok: false, error: error.code, message: error.message },
          422
        );
      }

      return json(
        {
          ok: false,
          error: "START_SURVEY_FAILED",
          message: error instanceof Error ? error.message : "Unable to start survey."
        },
        500
      );
    }
  }

  return json({ ok: false, error: "NOT_FOUND" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
    }

    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;
