import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

afterEach(() => {
  if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
});

describe("middleware login redirects", () => {
  it("uses the configured public URL instead of an internal loopback host", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://erp.example.com";
    const res = middleware(new NextRequest("https://localhost:3016/orders"));

    assert.equal(res.status, 307);
    assert.equal(
      res.headers.get("location"),
      "https://erp.example.com/login?redirect=%2Forders"
    );
  });

  it("ignores placeholder localhost values copied from .env.example", () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    const res = middleware(new NextRequest("https://erp.example.com/admin"));

    assert.equal(
      res.headers.get("location"),
      "https://erp.example.com/login?redirect=%2Fadmin"
    );
  });

  it("keeps local development redirects on the request host", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const res = middleware(new NextRequest("http://127.0.0.1:3101/settings"));

    assert.equal(
      res.headers.get("location"),
      "http://localhost:3101/login?redirect=%2Fsettings"
    );
  });
});
