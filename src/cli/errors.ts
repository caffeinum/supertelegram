export const EXIT = { runtime: 1, usage: 2, notFound: 3, ambiguous: 4 } as const;

export class CliError extends Error {
  constructor(message: string, readonly code: number = EXIT.runtime) {
    super(message);
  }
}

export function usageError(message: string): CliError {
  return new CliError(message, EXIT.usage);
}
