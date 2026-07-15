import fs from "node:fs";
import path from "node:path";

export function normalizeParticipatingGroups(
  groups
) {
  const values =
    Array.isArray(groups)
      ? groups
      : Object.values(
          groups || {}
        );

  return values
    .map((group) => {
      const id =
        String(
          group?.id ||
          group?.jid ||
          ""
        ).trim();

      if (
        !id.endsWith(
          "@g.us"
        )
      ) {
        return null;
      }

      const subject =
        String(
          group?.subject ||
          group?.name ||
          ""
        ).trim();

      return {
        id,
        subject:
          subject ||
          "Unnamed group",
        participantCount:
          Array.isArray(
            group?.participants
          )
            ? group
                .participants
                .length
            : null,
      };
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        left.subject.localeCompare(
          right.subject,
          undefined,
          {
            sensitivity:
              "base",
          }
        ) ||
        left.id.localeCompare(
          right.id
        )
    );
}

export function groupDisplayLabel(
  group
) {
  const count =
    Number.isInteger(
      group.participantCount
    )
      ? ` — ${group.participantCount} participants`
      : "";

  return (
    `${group.subject}${count}`
  );
}

export function parseGroupSelection(
  value,
  groups,
  label
) {
  const normalized =
    String(value || "")
      .trim();

  const numeric =
    Number(normalized);

  if (
    Number.isInteger(
      numeric
    ) &&
    numeric >= 1 &&
    numeric <=
      groups.length
  ) {
    return groups[
      numeric - 1
    ];
  }

  if (
    normalized.endsWith(
      "@g.us"
    )
  ) {
    return (
      groups.find(
        (group) =>
          group.id ===
          normalized
      ) || {
        id: normalized,
        subject:
          "Manually entered group",
        participantCount:
          null,
      }
    );
  }

  throw new Error(
    `${label} must be a listed number or a WhatsApp group ID ending in @g.us`
  );
}

export function updateConfigGroups(
  config,
  {
    operationsGroupId,
    cookGroupId,
  }
) {
  if (
    typeof operationsGroupId !==
      "string" ||
    !operationsGroupId.endsWith(
      "@g.us"
    )
  ) {
    throw new Error(
      "Operations group ID must end in @g.us"
    );
  }

  if (
    typeof cookGroupId !==
      "string" ||
    !cookGroupId.endsWith(
      "@g.us"
    )
  ) {
    throw new Error(
      "Cook group ID must end in @g.us"
    );
  }

  return {
    ...structuredClone(
      config
    ),

    groups: {
      operationsGroupId,
      cookGroupId,
    },
  };
}

export function saveConfigGroups(
  filePath,
  config,
  selection
) {
  const updated =
    updateConfigGroups(
      config,
      selection
    );

  fs.mkdirSync(
    path.dirname(
      filePath
    ),
    {
      recursive: true,
    }
  );

  fs.writeFileSync(
    filePath,
    JSON.stringify(
      updated,
      null,
      2
    ) + "\n"
  );

  return updated;
}

export async function fetchGroupsWithRetry(
  socket,
  {
    attempts = 4,
    delayMs = 1500,
    wait = (milliseconds) =>
      new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            milliseconds
          )
      ),
  } = {}
) {
  let lastError = null;

  for (
    let attempt = 1;
    attempt <= attempts;
    attempt += 1
  ) {
    try {
      const groups =
        await socket
          .groupFetchAllParticipating();

      const normalized =
        normalizeParticipatingGroups(
          groups
        );

      if (
        normalized.length >
        0
      ) {
        return normalized;
      }

      lastError =
        new Error(
          "WhatsApp returned no participating groups"
        );
    } catch (error) {
      lastError = error;
    }

    if (
      attempt < attempts
    ) {
      await wait(delayMs);
    }
  }

  throw new Error(
    "Could not load WhatsApp groups after multiple attempts",
    {
      cause: lastError,
    }
  );
}
