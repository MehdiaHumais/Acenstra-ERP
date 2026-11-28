import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { statusTone } from "@/components/ui";
import { titleCase } from "@/lib/format";

describe("Overview render safety", () => {
  it("tolerates null or missing status values", () => {
    assert.equal(statusTone(null), "neutral");
    assert.equal(statusTone(undefined), "neutral");
    assert.equal(statusTone("in_range"), "ok");
    assert.equal(statusTone("CANCELLED"), "critical");
  });

  it("tolerates null or missing labels", () => {
    assert.equal(titleCase(null), "");
    assert.equal(titleCase(undefined), "");
    assert.equal(titleCase("quality_status"), "Quality Status");
  });
});
