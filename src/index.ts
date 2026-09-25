import {
  ContainerIdentificationError,
  ContainerIdentificationService
} from "./application/containerIdentificationService";
import { SurveyRepository } from "./infrastructure/d1/surveyRepository";

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

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === "GET" && url.pathname === "/api/health") {
    return json({
      ok: true,
      service: "Container Survey LLM AI",
      phase: "POC foundation",
      time: new Date().toISOString()
    });
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
