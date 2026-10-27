// Error taxonomy for everything that talks to FamilySearch. Messages are
// user-facing (pt-BR) and actionable; the classes let callers (http layer,
// tools, CLI) branch on the *kind* of failure without parsing text.

export const LOGIN_HINT =
  "Rode `familysearch login` (importa a sessão do Dia) ou abra o FamilySearch no navegador e tente de novo.";

/** No session, or FamilySearch rejected it. Fix: `familysearch login`. */
export class AuthError extends Error {
  constructor(message: string) {
    super(`${message} ${LOGIN_HINT}`);
    this.name = "AuthError";
  }
}

/** Transport-level failure (network, unexpected status, non-JSON body). */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** FamilySearch kept answering 429 after every backoff. */
export class RateLimitError extends Error {
  constructor(
    public readonly attempts: number,
    message: string,
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

/** The encrypted session file or its key is unusable. */
export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionError";
  }
}

/** The browser login or the browser import did not complete. */
export class LoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoginError";
  }
}

/** The id does not exist (404/204) or is not a valid FamilySearch id (400). */
export class NotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Pessoa ou registro não encontrado no FamilySearch: ${id}. Confira o id no link da página.`);
    this.name = "NotFoundError";
  }
}

/** 301: the person was merged into another one; the old id now redirects. */
export class MergedError extends Error {
  constructor(
    public readonly id: string,
    /** Null when FamilySearch did not say which person survived. */
    public readonly survivorId: string | null,
  ) {
    super(
      survivorId
        ? `A pessoa ${id} foi mesclada em ${survivorId}. Use ${survivorId}: é ela que continua na árvore.`
        : `A pessoa ${id} foi mesclada em outra pessoa. Abra a página dela no FamilySearch para ver qual continua na árvore.`,
    );
    this.name = "MergedError";
  }
}

/** 410: the person was deleted from the tree. */
export class DeletedError extends Error {
  constructor(public readonly id: string) {
    super(
      `A pessoa ${id} foi apagada da árvore do FamilySearch. O histórico dela ainda aparece no site, em "Últimas alterações".`,
    );
    this.name = "DeletedError";
  }
}

/**
 * A response no longer looks like what the parsers expect — FamilySearch
 * changed something. `familysearch doctor` says which layer broke.
 */
export class ParseError extends Error {
  constructor(message: string) {
    super(`${message} Rode \`familysearch doctor\` para ver qual camada quebrou.`);
    this.name = "ParseError";
  }
}

/** The user declined, or no approval was possible: nothing was written. */
export class ApprovalRefusedError extends Error {
  constructor(
    public readonly tool: string,
    public readonly answer: string,
  ) {
    super(`Escrita não feita (${tool}): ${answer}`);
    this.name = "ApprovalRefusedError";
  }
}

/** A write got no clear answer (timeout, network, 5xx): it may or may not have been applied. */
export class WriteUncertainError extends Error {
  constructor(
    public readonly label: string,
    public readonly detail: string,
  ) {
    super(
      `A escrita "${label}" pode ter sido aplicada (${detail}). Releia a pessoa no FamilySearch antes de repetir.`,
    );
    this.name = "WriteUncertainError";
  }
}
