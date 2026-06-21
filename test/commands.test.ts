import { describe, expect, test } from "bun:test";
import { extractCommandNames, isSkillCommand } from "../src/commands/commands";

describe("extractCommandNames", () => {
  const user = (content: any) => ({ type: "user", message: { role: "user", content } });

  test("pulls the command name from a string content, stripping the slash", () => {
    const rec = user(
      "<command-name>/ta.session.wrap-up</command-name>\n<command-message>wrap-up</command-message>",
    );
    expect(extractCommandNames(rec)).toEqual(["ta.session.wrap-up"]);
  });

  test("pulls command names from text blocks too", () => {
    const rec = user([{ type: "text", text: "<command-name>/clear</command-name>" }]);
    expect(extractCommandNames(rec)).toEqual(["clear"]);
  });

  test("handles multiple commands in one record", () => {
    const rec = user("<command-name>/a</command-name> ... <command-name>/b.c</command-name>");
    expect(extractCommandNames(rec)).toEqual(["a", "b.c"]);
  });

  test("returns [] for non-user records", () => {
    expect(extractCommandNames({ type: "assistant", message: { content: [] } })).toEqual([]);
  });

  test("returns [] when there is no command tag", () => {
    expect(extractCommandNames(user("just a normal prompt"))).toEqual([]);
  });

  test("ignores an empty command tag", () => {
    expect(extractCommandNames(user("<command-name></command-name>"))).toEqual([]);
  });
});

describe("isSkillCommand", () => {
  test("namespaced names are skills", () => {
    expect(isSkillCommand("ta.session.wrap-up")).toBe(true);
    expect(isSkillCommand("agent-deck:session-share")).toBe(true);
  });

  test("bare built-in commands are not skills", () => {
    expect(isSkillCommand("clear")).toBe(false);
    expect(isSkillCommand("model")).toBe(false);
    expect(isSkillCommand("remote-control")).toBe(false);
  });
});
