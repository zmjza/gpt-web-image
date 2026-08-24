import test from "node:test";
import assert from "node:assert/strict";
import { matchUploadedAttachments, AttachmentUploadError, type AttachmentExpectation, type UploadedAttachmentEvidence } from "../../src/chatgpt/attachments.js";

const expected: AttachmentExpectation[] = [{ fileName: "图生图真机测试图.jpg", byteLength: 90800 }];

test("accepts only an attachment whose visible name and count match the request", () => {
  const actual: UploadedAttachmentEvidence[] = [{ fileName: expected[0]!.fileName, byteLength: expected[0]!.byteLength }];
  assert.deepEqual(matchUploadedAttachments(expected, actual), actual);
});

test("rejects missing or mismatched attachment evidence", () => {
  assert.throws(() => matchUploadedAttachments(expected, []), (error: unknown) => error instanceof AttachmentUploadError && error.code === "ATTACHMENT_UPLOAD_UNCONFIRMED");
  assert.throws(() => matchUploadedAttachments(expected, [{ fileName: "其他图片.jpg", byteLength: 90800 }]), (error: unknown) => error instanceof AttachmentUploadError && error.code === "ATTACHMENT_IDENTITY_MISMATCH");
});

test("rejects an attachment preview that has not exposed completed upload controls", () => {
  assert.throws(() => matchUploadedAttachments(expected, [{ fileName: expected[0]!.fileName, byteLength: null, ready: false }]), (error: unknown) => error instanceof AttachmentUploadError && error.code === "ATTACHMENT_UPLOAD_UNCONFIRMED");
});
