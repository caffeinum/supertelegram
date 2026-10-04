import {
  isLoggedIn,
  disconnect,
  getClient,
  setSessionPath,
  login as telegramLogin,
} from "../client/telegram";
import { askPhoneNumber, askPhoneCode, askPassword, askAppId, askAppHash } from "./prompts";
import { getApiCredentials, getConfig, setConfig } from "../config/manager";
import {
  listAccounts,
  setCurrentAccount,
  registerAccount,
  removeAccount,
  getCurrentAccount,
  accountSessionPath,
} from "../config/accounts";
import { CliError, EXIT, usageError } from "./errors";

export async function login(accountName?: string) {
  const name = accountName || getCurrentAccount() || "default";
  // isolate this login to the named account's own session file
  setSessionPath(accountSessionPath(name), name);

  // check if API credentials are configured (shared across accounts)
  const creds = getApiCredentials();
  if (!creds) {
    console.log("no API credentials found. let's set them up first.");
    const appId = await askAppId();
    const appHash = await askAppHash();

    setConfig("appId", appId);
    setConfig("appHash", appHash);
    console.log("credentials saved to ~/.supertelegram/config.json\n");
  }

  const loggedIn = await isLoggedIn();
  if (!loggedIn) {
    console.log(`starting login for account "${name}"...`);
    await telegramLogin({
      phoneNumber: askPhoneNumber,
      phoneCode: askPhoneCode,
      password: askPassword,
    });
  } else {
    console.log(`account "${name}" already has a session, refreshing details...`);
  }

  // capture identity + register (and make current)
  const client = await getClient();
  const me = await client.getMe();
  const fullName = [me.firstName, me.lastName].filter(Boolean).join(" ");
  registerAccount(name, {
    username: me.username ?? undefined,
    userId: me.id?.toString(),
    name: fullName || undefined,
  });

  const label = me.username ? `@${me.username}` : fullName || name;
  console.log(`logged in as ${label} — account "${name}" is now active`);
  await disconnect();
}

export async function accounts() {
  const list = listAccounts();
  if (list.length === 0) {
    console.log("no accounts yet. run: telegram login <name>");
    return;
  }
  for (const { name, meta, current } of list) {
    const marker = current ? "*" : " ";
    const who = meta.username
      ? `@${meta.username}`
      : meta.name || (meta.userId ? `id ${meta.userId}` : "");
    console.log(`${marker} ${name}${who ? ` — ${who}` : ""}`);
  }
  console.log("\nswitch with: telegram switch <name>");
}

export async function switchAccount(name?: string) {
  if (!name) throw usageError("usage: telegram switch <name>\nsee accounts with: telegram accounts");
  setCurrentAccount(name);
  console.log(`switched to account "${name}"`);
}

export async function logout(name?: string) {
  const target = name || getCurrentAccount();
  if (!target) throw new CliError("no account to log out. see: telegram accounts");
  removeAccount(target);
  const now = getCurrentAccount();
  console.log(
    `logged out of "${target}"` + (now ? `. active account is now "${now}"` : ". no accounts left")
  );
}

// `pinned` is the --account/-a override: whoami must report the session it's
// actually running as, not the registry's current account.
export async function whoami(pinned?: string) {
  const current = pinned || getCurrentAccount();
  if (!current) throw new CliError("no active account. run: telegram login <name>");

  const isRegistered = listAccounts().some((a) => a.name === current);
  let meta = listAccounts().find((a) => a.name === current)?.meta;

  // resolve identity from the live session when metadata is missing —
  // either a migrated account with no cached details, or an -a account
  // that isn't in the registry at all.
  if (!meta?.username && !meta?.name) {
    const loggedIn = await isLoggedIn();
    if (!loggedIn) {
      await disconnect();
      throw new CliError(`account "${current}" is not logged in. run: telegram login ${current}  (known: telegram accounts)`);
    }
    const me = await (await getClient()).getMe();
    const fullName = [me.firstName, me.lastName].filter(Boolean).join(" ");
    meta = {
      username: me.username ?? undefined,
      userId: me.id?.toString(),
      name: fullName || undefined,
    };
    if (isRegistered) registerAccount(current, meta, false);
    await disconnect();
  }

  const who = meta.username ? `@${meta.username}` : meta.name ?? `id ${meta.userId}`;
  console.log(`${current} — ${who}`);
}

const CONFIG_KEYS = ["appId", "appHash", "wss", "images"];
const IMAGE_PROTOCOLS = ["auto", "kitty", "sixel", "blocks"];

export async function config(action?: string, key?: string, value?: string) {
  const usage = [
    "usage:",
    "  telegram config set appId <id>",
    "  telegram config set appHash <hash>",
    "  telegram config set wss true    (websocket transport for networks blocking mtproto)",
    "  telegram config set images blocks   (how the tui draws images: auto, kitty, sixel, blocks)",
    "  telegram config get appId",
  ].join("\n");

  if (action !== "set" && action !== "get") throw usageError(usage);
  if (!key || !CONFIG_KEYS.includes(key)) throw usageError(`unknown config key "${key ?? ""}". keys: ${CONFIG_KEYS.join(", ")}\n${usage}`);

  if (action === "set") {
    if (!value) throw usageError(`config set ${key} needs a value\n${usage}`);
    if (key === "images" && !IMAGE_PROTOCOLS.includes(value)) throw usageError(`images must be one of ${IMAGE_PROTOCOLS.join(", ")}`);
    setConfig(key, value);
    console.log(`set ${key} = ${value}`);
    return;
  }

  if (key === "wss") {
    console.log(String(getConfig().wss === "true"));
    return;
  }
  if (key === "images") {
    console.log(getConfig().images ?? "auto");
    return;
  }
  const creds = getApiCredentials();
  if (!creds) throw new CliError(`${key} is not set. run: telegram config set ${key} <value>`, EXIT.notFound);
  console.log(key === "appId" ? creds.appId : creds.appHash);
}
