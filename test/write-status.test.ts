import { expect, test } from "bun:test";
import { PRODUCTION_PROVEN, describeWrite } from "../src/tools/write-status.js";

test("describeWrite flags tools not yet proven in production", () => {
  expect(describeWrite("x_tool", "Faz algo.")).toBe("Faz algo. Ainda não provada em produção.");
  PRODUCTION_PROVEN.constructor === Set && (PRODUCTION_PROVEN as Set<string>).add("proven_tool");
  expect(describeWrite("proven_tool", "Faz algo.")).toBe("Faz algo.");
  (PRODUCTION_PROVEN as Set<string>).delete("proven_tool");
});

test("merge_persons is proven in production (grandmother pilot)", () => {
  expect(PRODUCTION_PROVEN.has("merge_persons")).toBe(true);
});

test("update_person is proven in production (a death fact on a living person)", () => {
  expect(PRODUCTION_PROVEN.has("update_person")).toBe(true);
});

test("attach_record is proven in production (a marriage and a death record)", () => {
  expect(PRODUCTION_PROVEN.has("attach_record")).toBe(true);
});
