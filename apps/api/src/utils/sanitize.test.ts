import { expect, test } from "vitest";
import { cleanText, csvSafeCell, escapeHtml, nameField } from "./sanitize";

test("cleanText strips markup, control and bidi characters", () => {
  expect(cleanText("  <script>alert(1)</script>‮ Bob\n")).toBe("scriptalert(1)/script Bob");
});
test("nameField rejects empty-after-clean and over-long values", () => {
  expect(nameField(10).safeParse("<>").success).toBe(false);
  expect(nameField(10).safeParse("x".repeat(11)).success).toBe(false);
  expect(nameField(10).parse(" Ada ")).toBe("Ada");
});
test("escapeHtml and csvSafeCell", () => {
  expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  expect(csvSafeCell("=1+1")).toBe("'=1+1");
  expect(csvSafeCell("plain")).toBe("plain");
});
