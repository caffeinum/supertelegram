import input from "input";

export async function askPhoneNumber(): Promise<string> {
  return input.text("enter phone number (with country code):");
}

export async function askPhoneCode(): Promise<string> {
  return input.text("enter the code you received:");
}

export async function askPassword(): Promise<string> {
  return input.text("enter 2fa password (if any):");
}

export async function askMessage(): Promise<string> {
  return input.text("message:");
}

export async function askUsername(): Promise<string> {
  return input.text("username/chat:");
}

export async function askCommand(): Promise<string> {
  return input.text("command (send/read/dialogs/quit):");
}
