// process-wide connection flags, kept free of gramjs so the entry point can read them without loading it

let tearingDown = false;
let keepAlive = false;

// true once teardown has begun. gramjs's background update loop can reject with a TIMEOUT while the
// connection is torn down — after the command's work committed — so this tells that noise from a failure
export function isTearingDown(): boolean {
  return tearingDown;
}

export function markTearingDown(): void {
  tearingDown = true;
}

// long-lived sessions (tui, shell) keep connections open between commands
export function setKeepAlive(on: boolean): void {
  keepAlive = on;
}

export function isKeepAlive(): boolean {
  return keepAlive;
}
