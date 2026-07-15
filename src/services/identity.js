import { randomUUID } from "node:crypto";

export function listMembers(database) {
  return database.prepare(`
    SELECT id, display_name, is_admin
    FROM household_members WHERE is_active = 1 ORDER BY display_name
  `).all().map((row) => ({
    id: row.id,
    displayName: row.display_name,
    isAdmin: Boolean(row.is_admin),
  }));
}

export function findMemberBySender(database, senderId) {
  const row = database.prepare(`
    SELECT m.id, m.display_name, m.is_admin
    FROM member_whatsapp_identities i
    JOIN household_members m ON m.id = i.member_id
    WHERE i.sender_id = ? AND i.is_active = 1 AND m.is_active = 1
  `).get(senderId);
  return row ? { id: row.id, displayName: row.display_name, isAdmin: Boolean(row.is_admin) } : null;
}

export function linkSenderToMember(database, { senderId, memberId, pushName = "", actorMemberId = null }) {
  if (!senderId) throw new Error("senderId is required");
  const member = database.prepare(`
    SELECT id, display_name, is_admin FROM household_members WHERE id = ? AND is_active = 1
  `).get(memberId);
  if (!member) throw new Error("Selected household member does not exist");

  const existingMemberIdentity = database.prepare(`
    SELECT sender_id FROM member_whatsapp_identities
    WHERE member_id = ? AND is_active = 1
  `).get(memberId);
  if (existingMemberIdentity && existingMemberIdentity.sender_id !== senderId) {
    throw new Error(`${member.display_name} is already linked to another WhatsApp account`);
  }

  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare(`
      INSERT INTO member_whatsapp_identities
        (sender_id, member_id, observed_push_name, is_active, updated_at)
      VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(sender_id) DO UPDATE SET
        member_id = excluded.member_id,
        observed_push_name = excluded.observed_push_name,
        is_active = 1,
        updated_at = CURRENT_TIMESTAMP
    `).run(senderId, memberId, pushName);

    database.prepare(`
      INSERT INTO configuration_audit
        (id, actor_member_id, change_type, target_key, old_value_json, new_value_json)
      VALUES (?, ?, 'identity_link', ?, NULL, ?)
    `).run(
      randomUUID(),
      actorMemberId || memberId,
      senderId,
      JSON.stringify({ memberId, pushName })
    );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  return { id: member.id, displayName: member.display_name, isAdmin: Boolean(member.is_admin) };
}
