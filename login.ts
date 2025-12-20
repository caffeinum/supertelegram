import { isLoggedIn, login, disconnect } from "./src/client/telegram";
import { askPhoneNumber, askPhoneCode, askPassword } from "./src/cli/prompts";

async function main() {
  console.log("telegram login script");

  const loggedIn = await isLoggedIn();
  if (loggedIn) {
    console.log("already logged in!");
    await disconnect();
    return;
  }

  console.log("starting login...");
  await login({
    phoneNumber: askPhoneNumber,
    phoneCode: askPhoneCode,
    password: askPassword,
  });

  console.log("login complete!");
  await disconnect();
}

main().catch(console.error);
