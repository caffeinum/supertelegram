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

export async function askAppId(): Promise<string> {
  console.log("\nget your API credentials from: https://my.telegram.org/apps\n");
  return input.text("enter TELEGRAM_APP_ID:");
}

export async function askAppHash(): Promise<string> {
  return input.text("enter TELEGRAM_APP_HASH:");
}
