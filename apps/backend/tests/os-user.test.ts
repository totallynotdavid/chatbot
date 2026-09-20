/** The operator a row names: the name the environment gives, and the uid it cannot. */

import { describe, it, expect } from "bun:test";
import { operatorFrom } from "../src/cli/os-user.ts";

describe("operatorFrom", () => {
  it("keeps the name and the uid", () => {
    expect(operatorFrom({ username: "alice", uid: 1000 })).toEqual({
      name: "alice",
      uid: 1000,
    });
  });

  it.each([
    ["an empty name", ""],
    ["the name Bun gives when $USER is unset", "unknown"],
  ])("names the uid for %s", (_, username) => {
    expect(operatorFrom({ username, uid: 1000 })).toEqual({
      name: "uid=1000",
      uid: 1000,
    });
  });
});
