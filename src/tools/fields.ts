import { Type } from "@sinclair/typebox";

// Schema fragments shared by several tools, so a description is written once.

export const personIdField = Type.String({
  pattern: "^[A-Z0-9]{4}-[A-Z0-9]{3,4}$",
  description: "Id da pessoa no FamilySearch, como aparece no link da página (ex.: KWCB-XXX)",
});

export const limitField = (max: number, fallback: number) =>
  Type.Optional(
    Type.Integer({ minimum: 1, maximum: max, description: `Máximo de itens (default ${fallback})` }),
  );

export const generationsField = (max: number, fallback: number) =>
  Type.Optional(
    Type.Integer({ minimum: 1, maximum: max, description: `Gerações (1 a ${max}, default ${fallback})` }),
  );
