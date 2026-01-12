import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createLogger } from "./logger.ts";

const logger = createLogger("group-registry");

const DATA_PATH = process.env.NOTIFIER_DATA_PATH || "./data/notifier";
const MAPPING_FILE = path.join(DATA_PATH, "group_mapping.json");

const groupMapping = new Map<string, string>();

export function loadGroupMapping() {
  if (!fs.existsSync(MAPPING_FILE)) return;

  const data = JSON.parse(fs.readFileSync(MAPPING_FILE, "utf-8"));
  Object.entries(data).forEach(([key, jid]) => {
    groupMapping.set(key, jid as string);
  });

  logger.info(
    { groups: Array.from(groupMapping.keys()) },
    "Loaded group mapping",
  );
}

export function saveGroupMapping(groupName: string, jid: string) {
  groupMapping.set(groupName, jid);
  const obj = Object.fromEntries(groupMapping.entries());
  fs.writeFileSync(MAPPING_FILE, JSON.stringify(obj, null, 2));
}

export function getGroupJID(channel: "agent" | "dev" | "sales"): string | null {
  const envKeyMap = {
    agent: "WHATSAPP_GROUP_AGENT",
    dev: "WHATSAPP_GROUP_DEV",
    sales: "WHATSAPP_GROUP_SALES",
  };

  const envJID = process.env[envKeyMap[channel]];
  if (envJID) return envJID;

  const mappingKeyMap = {
    agent: "agent_team",
    dev: "dev_team",
    sales: "sales_team",
  };

  return groupMapping.get(mappingKeyMap[channel]) || null;
}
