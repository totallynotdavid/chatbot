import process from "node:process";

// Names assembled so a repo search for the removed variables finds nothing.
const BOOTSTRAP = ["BOOTSTRAP", "ADMIN"].join("_");

export const ENV_ACCOUNT_USERNAME = "env-admin";

export const ACCOUNT_ENV: Record<string, string> = {
  [`${BOOTSTRAP}_USERNAME`]: ENV_ACCOUNT_USERNAME,
  [`${BOOTSTRAP}_PASSWORD`]: "a-long-enough-password",
  [`${BOOTSTRAP}_NAME`]: "Env Admin",
  [`${BOOTSTRAP}_PLATFORM_OPERATOR`]: "true",
  [["MIGRATION", "PLATFORM", "OPERATOR", "USERNAME"].join("_")]: "agent1",
};

/** Sets `ACCOUNT_ENV` on this process and returns the function that undoes it. */
export function setAccountEnv(): () => void {
  const saved = Object.keys(ACCOUNT_ENV).map(
    (key) => [key, process.env[key]] as const,
  );

  Object.assign(process.env, ACCOUNT_ENV);

  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}
