import process from "node:process";

/** A hidden prompt, asked twice, on a terminal; otherwise all of stdin. */
export async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) return readFromStdin();

  const password = await promptHidden("Password: ");
  const confirmation = await promptHidden("Confirm password: ");

  if (password !== confirmation) {
    throw new Error("The passwords do not match.");
  }

  return password;
}

async function readFromStdin(): Promise<string> {
  const password = (await Bun.stdin.text()).replace(/\r?\n$/, "");

  if (/[\r\n]/.test(password)) {
    throw new Error("Expected the password on a single line of stdin.");
  }

  return password;
}

function promptHidden(label: string): Promise<string> {
  const { stdin, stderr } = process;

  stderr.write(label);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();

  return new Promise((resolve, reject) => {
    const typed: string[] = [];

    function finish(settle: () => void) {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stderr.write("\n");
      settle();
    }

    function onData(chunk: string) {
      // Escape sequences (arrow keys, paste markers) are not part of the password.
      const keys = chunk.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");

      for (const key of keys) {
        if (key === "\r" || key === "\n")
          return finish(() => resolve(typed.join("")));
        if (key === "\u0003" || key === "\u0004") {
          return finish(() => reject(new Error("Cancelled.")));
        }
        if (key === "\u007f" || key === "\b") typed.pop();
        else if (key >= " ") typed.push(key);
      }
    }

    stdin.on("data", onData);
  });
}
