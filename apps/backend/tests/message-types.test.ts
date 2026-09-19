/**
 * Compile-time contracts, checked by compiling a fixture against the real sources:
 * `messages.type` is text or image, and `last_activity_at` is a millisecond number.
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { resolve } from "node:path";
import ts from "typescript";

const BACKEND_DIR = resolve(import.meta.dir, "..");
const FIXTURE = resolve(import.meta.dir, "compile-fixture.ts");

const HEADER = `
import type {
  Conversation,
  ConversationMessage,
  ConversationRef,
  IncomingMessage,
} from "@totem/types";
import { MessageStore } from "../src/adapters/whatsapp/message-store.ts";
import { WhatsAppService } from "../src/adapters/whatsapp/index.ts";
declare const ref: ConversationRef;
declare const incoming: IncomingMessage;
declare const conversation: Conversation;
declare const stored: ConversationMessage;`;

const CASES = {
  storeText: `MessageStore.log(ref, "inbound", "text", "x");`,
  storeImage: `MessageStore.log(ref, "outbound", "image", "x");`,
  storeUnknown: `MessageStore.log(ref, "inbound", "unknown", "x");`,
  storeDocument: `MessageStore.log(ref, "inbound", "document", "x");`,
  storeInboundTyped: `MessageStore.log(ref, "inbound", incoming.type, "x");`,
  logText: `WhatsAppService.logMessage(ref, "inbound", "text", "x");`,
  logUnknown: `WhatsAppService.logMessage(ref, "inbound", "unknown", "x");`,
  logAudio: `WhatsAppService.logMessage(ref, "inbound", "audio", "x");`,
  inboundUnknown: `export const inboundUnknown: IncomingMessage["type"] = "unknown";`,
  inboundVideo: `export const inboundVideo: IncomingMessage["type"] = "video";`,
  storedIsTextOrImage: `export const storedType: "text" | "image" = stored.type;`,
  lastActivityIsNumber: `export const at: number = conversation.last_activity_at;`,
} as const;

type CaseName = keyof typeof CASES;

let errorLines: Set<number>;
let caseLine: Record<CaseName, number>;

function compile(): void {
  const names = Object.keys(CASES) as CaseName[];
  const headerLines = HEADER.split("\n").length;
  const source = [HEADER, ...names.map((name) => CASES[name])].join("\n");
  caseLine = Object.fromEntries(
    names.map((name, i) => [name, headerLines + i + 1]),
  ) as Record<CaseName, number>;

  const config = ts.getParsedCommandLineOfConfigFile(
    resolve(BACKEND_DIR, "tsconfig.json"),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(
          ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        );
      },
    },
  );
  if (!config) throw new Error("backend tsconfig.json did not parse");

  const options = { ...config.options, noEmit: true, skipLibCheck: true };
  const host = ts.createCompilerHost(options);
  const { getSourceFile, fileExists, readFile } = host;
  host.getSourceFile = (name, languageVersion, ...rest) =>
    name === FIXTURE
      ? ts.createSourceFile(name, source, languageVersion)
      : getSourceFile.call(host, name, languageVersion, ...rest);
  host.fileExists = (name) => name === FIXTURE || fileExists.call(host, name);
  host.readFile = (name) =>
    name === FIXTURE ? source : readFile.call(host, name);

  const program = ts.createProgram([FIXTURE], options, host);
  errorLines = new Set(
    ts
      .getPreEmitDiagnostics(program)
      .filter((d) => d.file?.fileName === FIXTURE && d.start !== undefined)
      .map((d) => d.file!.getLineAndCharacterOfPosition(d.start!).line + 1),
  );
}

const compiles = (name: CaseName) => !errorLines.has(caseLine[name]);

describe("the type a message is stored with", () => {
  beforeAll(compile, 60_000);

  it("accepts text and image", () => {
    expect(compiles("storeText")).toBe(true);
    expect(compiles("storeImage")).toBe(true);
    expect(compiles("logText")).toBe(true);
  });

  it("rejects storing a type the messages table cannot hold", () => {
    expect(compiles("storeUnknown")).toBe(false);
    expect(compiles("storeDocument")).toBe(false);
    expect(compiles("logUnknown")).toBe(false);
    expect(compiles("logAudio")).toBe(false);
  });

  it("rejects storing a message's inbound type as it arrived", () => {
    expect(compiles("storeInboundTyped")).toBe(false);
  });

  it("leaves the inbound type able to carry what the channel delivers", () => {
    expect(compiles("inboundUnknown")).toBe(true);
    expect(compiles("inboundVideo")).toBe(true);
  });

  it("gives a stored message back as text or image", () => {
    expect(compiles("storedIsTextOrImage")).toBe(true);
  });
});

describe("a conversation's last activity", () => {
  beforeAll(() => {
    if (!errorLines) compile();
  }, 60_000);

  it("is typed as the millisecond number the column holds", () => {
    expect(compiles("lastActivityIsNumber")).toBe(true);
  });
});
