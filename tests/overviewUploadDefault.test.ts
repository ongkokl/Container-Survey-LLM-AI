import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("overview upload default analysis",()=>{
  const html=readFileSync("public/index.html","utf8");
  const app=readFileSync("public/app.js","utf8");

  it("enables zero-touch AI finding by default",()=>{
    expect(html).toMatch(/id="overviewDamagePocToggle"[^>]*checked/);
  });

  it("does not call the legacy locate-overview-damage endpoint from the upload UI",()=>{
    expect(app).not.toContain("/api/vision/locate-overview-damage");
  });

  it("runs the zero-touch overview orchestrator directly",()=>{
    expect(app).toContain('/api/poc/overview-auto-analyse');
    expect(app).toContain('form.append("orchestrateLocalization","true")');
    expect(app).toContain("ZERO_TOUCH_DEFAULT_1536_1200");
  });
});
