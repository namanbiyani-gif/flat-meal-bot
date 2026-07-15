import test from "node:test";
import assert from "node:assert/strict";
import { buildSetupConfig, normalizeCarbType, parseYesNo, starterWeeklyMenu, uniqueMemberId } from "../src/setup/setupConfig.js";
import { normalizeParticipatingGroups, parseGroupSelection, updateConfigGroups } from "../src/setup/whatsappSetup.js";
import { exampleConfig } from "./helpers.js";

test("setup helpers create stable IDs and parse answers", () => {
  assert.equal(uniqueMemberId("Primary Member", new Set(["primary-member"])), "primary-member-2");
  assert.equal(parseYesNo("yes"), true);
  assert.equal(normalizeCarbType("PARATHA"), "paratha");
  assert.equal(starterWeeklyMenu().length, 7);
});

test("setup config allows the same group for both destinations", () => {
  const example = exampleConfig();
  const config = buildSetupConfig({
    household: example.household,
    groups: { operationsGroupId: "111111@g.us", cookGroupId: "111111@g.us" },
    schedule: example.schedule,
    voice: example.voice,
    members: example.members,
    guestTemplateMemberId: "member-1",
    weeklyMenu: example.weeklyMenu,
  });
  assert.equal(config.groups.operationsGroupId, config.groups.cookGroupId);
});

test("WhatsApp group picker sorts groups and accepts a number", () => {
  const groups = normalizeParticipatingGroups({
    "2@g.us": { id: "2@g.us", subject: "Zeta", participants: [] },
    "1@g.us": { id: "1@g.us", subject: "Alpha", participants: [{}, {}] },
  });
  assert.equal(groups[0].subject, "Alpha");
  assert.equal(parseGroupSelection("1", groups, "Group").id, "1@g.us");
  const updated = updateConfigGroups(exampleConfig(), {
    operationsGroupId: "1@g.us",
    cookGroupId: "2@g.us",
  });
  assert.equal(updated.groups.cookGroupId, "2@g.us");
});
