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

// The write tools' common inputs.
export const reasonField = Type.String({ minLength: 10, description: "Motivo da alteração, fica no histórico do FamilySearch" });
export const previewField = Type.Optional(Type.Boolean({ description: "Mostra o que mudaria sem perguntar nem escrever" }));
/** A FamilySearch id that goes into a URL path (relationship, fact, record). */
export const idField = (description?: string) =>
  Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$", ...(description ? { description } : {}) });

export const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
