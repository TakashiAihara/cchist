import { describe, expect, test } from "bun:test";
import {
  extractCommandNames,
  extractSkillToolInvocations,
  isSkillCommand,
} from "../src/commands/commands";

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

describe("extractSkillToolInvocations", () => {
  const assistant = (content: any) => ({
    type: "assistant",
    message: { role: "assistant", content },
  });

  test("pulls input.skill from a Skill tool_use block", () => {
    const rec = assistant([
      { type: "tool_use", name: "Skill", input: { skill: "ta.session.wrap-up" } },
    ]);
    expect(extractSkillToolInvocations(rec)).toEqual(["ta.session.wrap-up"]);
  });

  test("collects multiple Skill invocations in one message", () => {
    const rec = assistant([
      { type: "tool_use", name: "Skill", input: { skill: "a.b" } },
      { type: "text", text: "thinking..." },
      { type: "tool_use", name: "Skill", input: { skill: "c.d" } },
    ]);
    expect(extractSkillToolInvocations(rec)).toEqual(["a.b", "c.d"]);
  });

  test("ignores non-Skill tool_use blocks", () => {
    const rec = assistant([
      { type: "tool_use", name: "Bash", input: { command: "ls" } },
      { type: "tool_use", name: "Skill", input: { skill: "x.y" } },
    ]);
    expect(extractSkillToolInvocations(rec)).toEqual(["x.y"]);
  });

  test("skips Skill blocks missing or wrongly typed input.skill", () => {
    const rec = assistant([
      { type: "tool_use", name: "Skill", input: {} },
      { type: "tool_use", name: "Skill", input: { skill: 42 } },
      { type: "tool_use", name: "Skill", input: { skill: "   " } }, // whitespace only
      { type: "tool_use", name: "Skill", input: { skill: "ok" } },
    ]);
    expect(extractSkillToolInvocations(rec)).toEqual(["ok"]);
  });

  test("returns [] for non-assistant records", () => {
    expect(extractSkillToolInvocations({ type: "user", message: { content: "hello" } })).toEqual(
      [],
    );
  });

  test("returns [] when content isn't an array", () => {
    expect(extractSkillToolInvocations(assistant("plain string"))).toEqual([]);
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
