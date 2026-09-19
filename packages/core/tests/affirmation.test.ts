import { describe, test, expect } from "bun:test";
import { isAffirmative, isNegative } from "../src/validation/affirmation";

describe("isAffirmative", () => {
  test("accepts single words, with or without trailing punctuation", () => {
    for (const input of [
      "sí",
      "SI",
      "claro",
      "ok",
      "  vale  ",
      "dale!",
      "si.",
    ]) {
      expect(isAffirmative(input)).toBe(true);
    }
  });

  test("accepts elongated, repeated and phrase forms", () => {
    for (const input of [
      "siii",
      "claroooo",
      "si si",
      "sí sí sí!",
      "dale que sí",
      "sí por favor?",
      "de acuerdo;",
      "tengo gas",
    ]) {
      expect(isAffirmative(input)).toBe(true);
    }
  });

  test("rejects negatives and unrelated text", () => {
    for (const input of ["no", "no gracias", "hola", "", "!!!", "quizás?"]) {
      expect(isAffirmative(input)).toBe(false);
    }
  });

  test("strips a mixed run of trailing punctuation", () => {
    expect(isAffirmative("sí¡!¿?.,:;")).toBe(true);
    expect(isAffirmative("sí!.!?")).toBe(true);
  });

  test("keeps punctuation that is not trailing", () => {
    expect(isAffirmative("sí, por favor")).toBe(false);
    expect(isAffirmative("!sí")).toBe(false);
  });

  test("a long run of punctuation followed by a letter is rejected", () => {
    expect(isAffirmative(`${"!".repeat(4000)}a`)).toBe(false);
  });

  test("a very long run of punctuation is scanned in linear time", () => {
    const input = `${"!".repeat(40_000)}a`;
    const start = performance.now();
    isAffirmative(input);
    expect(performance.now() - start).toBeLessThan(50);
  });
});

describe("isNegative", () => {
  test("accepts single words, with or without trailing punctuation", () => {
    for (const input of [
      "no",
      "NOPE",
      "nunca!",
      "  nah  ",
      "negativo?",
      "paso.",
    ]) {
      expect(isNegative(input)).toBe(true);
    }
  });

  test("accepts rejection phrases", () => {
    for (const input of [
      "no gracias",
      "gracias pero no",
      "nada gracias",
      "no por ahora",
      "mejor no",
      "creo que no",
      "no tengo gas",
      "no soy cliente!",
      "no somos clientes",
    ]) {
      expect(isNegative(input)).toBe(true);
    }
  });

  test("rejects affirmatives and unrelated text", () => {
    for (const input of ["sí", "claro", "hola", "", "???", "no sé"]) {
      expect(isNegative(input)).toBe(false);
    }
  });

  test("strips a mixed run of trailing punctuation", () => {
    expect(isNegative("no¡!¿?.,:;")).toBe(true);
  });

  test("a long run of punctuation followed by a letter is rejected", () => {
    expect(isNegative(`${"!".repeat(4000)}a`)).toBe(false);
  });

  test("a very long run of punctuation is scanned in linear time", () => {
    const input = `${"!".repeat(40_000)}a`;
    const start = performance.now();
    isNegative(input);
    expect(performance.now() - start).toBeLessThan(50);
  });
});
