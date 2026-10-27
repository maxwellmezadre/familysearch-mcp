import { expect, test } from "bun:test";
import { PRODUCTION_PROVEN, describeWrite } from "../src/tools/write-status.js";

test("describeWrite flags tools not yet proven in production", () => {
  expect(describeWrite("x_tool", "Faz algo.")).toBe("Faz algo. Ainda não provada em produção.");
  PRODUCTION_PROVEN.constructor === Set && (PRODUCTION_PROVEN as Set<string>).add("proven_tool");
  expect(describeWrite("proven_tool", "Faz algo.")).toBe("Faz algo.");
  (PRODUCTION_PROVEN as Set<string>).delete("proven_tool");
});
