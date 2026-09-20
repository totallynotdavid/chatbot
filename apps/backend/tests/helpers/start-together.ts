import { writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

export type ChildResult = { stdout: string; stderr: string; code: number };

/**
 * Starts `count` copies of a child script on the database at `dbPath` and
 * releases them together. Each child prints `ready` when it is loaded and then
 * spins until the barrier file appears. The working directory is `dir`, so a
 * child reads legacy uploads from `dir/data` and writes its logs there.
 */
export async function startTogether(options: {
  dir: string;
  dbPath: string;
  script: string;
  args?: string[];
  count?: number;
  /** Runs once the children are released, while they are still working. */
  afterRelease?: () => Promise<void>;
}): Promise<ChildResult[]> {
  const { dir, dbPath, script, args = [], count = 2, afterRelease } = options;
  const barrier = join(dir, "go");
  const children = Array.from({ length: count }, () =>
    Bun.spawn(["bun", "run", script, ...args, barrier], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        NODE_ENV: "test",
        DB_PATH: dbPath,
        UPLOAD_DIR: join(dir, "uploads"),
        PRIVATE_DIR: join(dir, "private"),
      },
    }),
  );

  const watched = children.map((child) => {
    const decoder = new TextDecoder();
    let text = "";
    let markReady = () => {};
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const stdout = (async () => {
      for await (const chunk of child.stdout) {
        text += decoder.decode(chunk, { stream: true });
        if (text.includes("ready")) markReady();
      }
      return text;
    })();

    return { child, ready, stdout };
  });

  await Promise.all(watched.map((w) => w.ready));
  writeFileSync(barrier, "");
  await afterRelease?.();

  return Promise.all(
    watched.map(async ({ child, stdout }) => {
      const [out, stderr, code] = await Promise.all([
        stdout,
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { stdout: out, stderr, code };
    }),
  );
}
