import { RequestError } from "@agentclientprotocol/sdk";
import { describe, expect, test } from "vitest";

import {
  callAcpWithParamCompat,
  extractUnrecognizedAcpParamKeys,
  nextAcpRequestParams,
} from "./acp-request-compat.js";

describe("extractUnrecognizedAcpParamKeys", () => {
  test("reads Zod unrecognized_keys from JSON-RPC error data", () => {
    const error = RequestError.invalidParams({
      issues: [{ code: "unrecognized_keys", keys: ["messageId"] }],
    });
    expect(extractUnrecognizedAcpParamKeys(error)).toEqual(["messageId"]);
  });

  test("reads serde unknown-field messages", () => {
    const error = RequestError.invalidParams(
      undefined,
      "unknown field `messageId`, expected `sessionId` or `prompt`",
    );
    expect(extractUnrecognizedAcpParamKeys(error)).toEqual(["messageId"]);
  });

  test("does not drop required ACP fields", () => {
    const error = RequestError.invalidParams({
      issues: [{ code: "unrecognized_keys", keys: ["sessionId", "messageId"] }],
    });
    expect(extractUnrecognizedAcpParamKeys(error)).toEqual(["messageId"]);
  });
});

describe("nextAcpRequestParams", () => {
  test("drops messageId when Cursor-style Invalid params omits the key name", () => {
    const next = nextAcpRequestParams(
      { sessionId: "s1", messageId: "m1", prompt: [{ type: "text", text: "hi" }] },
      RequestError.invalidParams(),
    );
    expect(next).toEqual({
      sessionId: "s1",
      prompt: [{ type: "text", text: "hi" }],
    });
  });

  test("returns null for unrelated failures", () => {
    expect(
      nextAcpRequestParams(
        { sessionId: "s1", prompt: [] },
        RequestError.internalError(undefined, "boom"),
      ),
    ).toBeNull();
  });
});

describe("callAcpWithParamCompat", () => {
  test("retries without rejected fields and remembers them", async () => {
    const omitted = new Set<string>();
    const calls: Array<Record<string, unknown>> = [];
    const result = await callAcpWithParamCompat(
      async (params) => {
        calls.push(params);
        if ("messageId" in params) {
          throw RequestError.invalidParams({
            issues: [{ code: "unrecognized_keys", keys: ["messageId"] }],
          });
        }
        return "ok";
      },
      { sessionId: "s1", messageId: "m1", prompt: [{ type: "text", text: "hi" }] },
      omitted,
    );

    expect(result).toBe("ok");
    expect(calls).toEqual([
      { sessionId: "s1", messageId: "m1", prompt: [{ type: "text", text: "hi" }] },
      { sessionId: "s1", prompt: [{ type: "text", text: "hi" }] },
    ]);
    expect([...omitted]).toEqual(["messageId"]);

    const second = await callAcpWithParamCompat(
      async (params) => {
        calls.push(params);
        return "ok-2";
      },
      { sessionId: "s1", messageId: "m2", prompt: [{ type: "text", text: "again" }] },
      omitted,
    );
    expect(second).toBe("ok-2");
    expect(calls.at(-1)).toEqual({
      sessionId: "s1",
      prompt: [{ type: "text", text: "again" }],
    });
  });
});
