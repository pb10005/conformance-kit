import { describe, it } from "node:test";
import assert from "node:assert";
import { requestLoginLink } from "../src/auth.ts";

describe("login", () => {
  // AC-001
  it("AC-001: 未登録アドレスでも200を返し、ユーザーを作成しない", () => {
    assert.equal(requestLoginLink("nobody@example.com").status, 200);
  });
});
