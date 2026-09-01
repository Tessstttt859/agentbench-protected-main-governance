export class PolicyError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "PolicyError";
  }
}

export class ContractValidationError extends PolicyError {
  public constructor(message: string) {
    super(message, "INVALID_CONTRACT");
    this.name = "ContractValidationError";
  }
}

export class GitHubApiError extends PolicyError {
  public constructor(
    message: string,
    public readonly status: number,
    options?: ErrorOptions
  ) {
    super(message, "GITHUB_API_ERROR", options);
    this.name = "GitHubApiError";
  }
}
