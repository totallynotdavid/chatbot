import os from "node:os";
import type { CliOperator } from "../platform/audit/logger.ts";

/**
 * Bun takes the user name from $USER and answers "unknown" or an empty string
 * when the environment sets none, as under `docker exec` or cron. The uid comes
 * from the process, so it stands in for the name then.
 */
export function operatorFrom(info: {
  username: string;
  uid: number;
}): CliOperator {
  const named = info.username !== "" && info.username !== "unknown";

  return { name: named ? info.username : `uid=${info.uid}`, uid: info.uid };
}

export function currentOperator(): CliOperator {
  return operatorFrom(os.userInfo());
}
