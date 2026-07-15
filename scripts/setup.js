import fs from "node:fs";
import path from "node:path";
import {
  createInterface,
} from "node:readline/promises";
import {
  stdin,
  stdout,
} from "node:process";

import {
  validateHouseholdConfig,
} from "../src/config.js";

import {
  buildSetupConfig,
  normalizeCarbType,
  parseNonNegativeNumber,
  parsePositiveInteger,
  parseYesNo,
  starterWeeklyMenu,
  uniqueMemberId,
} from "../src/setup/setupConfig.js";

const CONFIG_PATH =
  path.resolve(
    "config/household.json"
  );

const ENV_PATH =
  path.resolve(".env");

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const MEAL_NAMES = [
  "lunch",
  "dinner",
];

const rl =
  createInterface({
    input: stdin,
    output: stdout,
  });

function shownDefault(defaultValue) {
  return (
    defaultValue === undefined ||
    defaultValue === null ||
    defaultValue === ""
  )
    ? ""
    : ` [${defaultValue}]`;
}

async function ask(
  prompt,
  {
    defaultValue = "",
    required = false,
    transform = (value) => value,
  } = {}
) {
  while (true) {
    const raw =
      await rl.question(
        `${prompt}${shownDefault(
          defaultValue
        )}: `
      );

    const chosen =
      raw.trim() === ""
        ? String(defaultValue)
        : raw.trim();

    if (
      required &&
      chosen.trim() === ""
    ) {
      console.log(
        "A value is required."
      );
      continue;
    }

    try {
      return transform(chosen);
    } catch (error) {
      console.log(error.message);
    }
  }
}

async function askYesNo(
  prompt,
  defaultValue = false
) {
  return ask(
    `${prompt} (y/n)`,
    {
      defaultValue:
        defaultValue ? "y" : "n",
      transform: (value) =>
        parseYesNo(
          value,
          defaultValue
        ),
    }
  );
}

async function askQuantity(
  prompt,
  defaultValue
) {
  return ask(
    prompt,
    {
      defaultValue,
      transform: (value) =>
        parseNonNegativeNumber(
          value,
          prompt
        ),
    }
  );
}

async function askMealDefaults(
  displayName,
  mealType
) {
  console.log(
    `\n${displayName} — ${mealType} defaults`
  );

  const sharedDishPortions =
    await askQuantity(
      "Shared dish portions",
      1
    );

  const roti =
    await askQuantity(
      "Rotis on a roti meal",
      2
    );

  const rice =
    await askQuantity(
      "Rice portions on a rice meal",
      1
    );

  const paratha =
    await askQuantity(
      "Parathas on a paratha meal",
      2
    );

  const customItemCount =
    await ask(
      "Number of extra recurring items",
      {
        defaultValue: 0,
        transform: (value) => {
          const parsed =
            Number(value);

          if (
            !Number.isInteger(parsed) ||
            parsed < 0
          ) {
            throw new Error(
              "Enter zero or a positive integer"
            );
          }

          return parsed;
        },
      }
    );

  const customItems = [];
  const itemKeys = new Set();

  for (
    let index = 0;
    index < customItemCount;
    index += 1
  ) {
    console.log(
      `\nExtra item ${index + 1}`
    );

    const label =
      await ask(
        "Item label",
        {
          required: true,
        }
      );

    const key =
      uniqueMemberId(
        label,
        itemKeys
      );

    itemKeys.add(key);

    const quantity =
      await askQuantity(
        "Quantity",
        1
      );

    const unit =
      await ask(
        "Unit (g, portion, count, ml, etc.)",
        {
          defaultValue:
            "portion",
          required: true,
        }
      );

    customItems.push({
      key,
      label,
      quantity,
      unit,
    });
  }

  return {
    sharedDishPortions,
    carbs: {
      roti,
      rice,
      paratha,
    },
    customItems,
  };
}

async function askMembers() {
  const memberCount =
    await ask(
      "Number of household members",
      {
        defaultValue: 2,
        transform: (value) =>
          parsePositiveInteger(
            value,
            "Member count"
          ),
      }
    );

  const members = [];
  const ids = new Set();

  for (
    let index = 0;
    index < memberCount;
    index += 1
  ) {
    console.log(
      `\n=== MEMBER ${index + 1} OF ${memberCount} ===`
    );

    const displayName =
      await ask(
        "Display name",
        {
          defaultValue:
            `Member ${index + 1}`,
          required: true,
        }
      );

    const suggestedId =
      uniqueMemberId(
        displayName,
        ids
      );

    const id =
      await ask(
        "Stable member ID",
        {
          defaultValue:
            suggestedId,
          required: true,
          transform: (value) =>
            uniqueMemberId(
              value,
              ids
            ),
        }
      );

    ids.add(id);

    const isAdmin =
      await askYesNo(
        "Can this member administer household settings?",
        index === 0
      );

    const defaults = {};

    for (
      const mealType
      of MEAL_NAMES
    ) {
      defaults[mealType] =
        await askMealDefaults(
          displayName,
          mealType
        );
    }

    members.push({
      id,
      displayName,
      isAdmin,
      whatsappSenderIds: [],
      defaults,
    });
  }

  if (
    !members.some(
      (member) =>
        member.isAdmin
    )
  ) {
    members[0].isAdmin = true;

    console.log(
      `\n${members[0].displayName} was made an admin because at least one admin is required.`
    );
  }

  return members;
}

async function askWeeklyMenu() {
  const useStarter =
    await askYesNo(
      "Start with the editable sample weekly menu?",
      true
    );

  if (useStarter) {
    return starterWeeklyMenu();
  }

  const weeklyMenu = [];

  for (
    let dayIndex = 0;
    dayIndex < 7;
    dayIndex += 1
  ) {
    const day = {
      weekday: dayIndex + 1,
    };

    console.log(
      `\n=== ${DAY_NAMES[dayIndex]} ===`
    );

    for (
      const mealType
      of MEAL_NAMES
    ) {
      const dishName =
        await ask(
          `${
            mealType === "lunch"
              ? "Lunch"
              : "Dinner"
          } dish`,
          {
            required: true,
          }
        );

      const carbType =
        await ask(
          "Carb type",
          {
            defaultValue:
              mealType === "lunch"
                ? "roti"
                : "rice",
            transform:
              normalizeCarbType,
          }
        );

      day[mealType] = {
        dishName,
        carbType,
      };
    }

    weeklyMenu.push(day);
  }

  return weeklyMenu;
}

async function confirmOverwrite() {
  if (
    !fs.existsSync(CONFIG_PATH)
  ) {
    return true;
  }

  console.log(
    `\nA local configuration already exists:\n${CONFIG_PATH}`
  );

  return askYesNo(
    "Replace it?",
    false
  );
}

function writeEnvFile() {
  if (fs.existsSync(ENV_PATH)) {
    return false;
  }

  fs.writeFileSync(
    ENV_PATH,
    [
      "CONFIG_PATH=config/household.json",
      "DB_PATH=data/flat-meal-bot.db",
      "AUTH_DIR=auth",
      "",
    ].join("\n")
  );

  return true;
}

async function main() {
  console.log(
    "\nFlat Meal Bot setup"
  );

  console.log(
    "This creates only local files ignored by Git."
  );

  const mayContinue =
    await confirmOverwrite();

  if (!mayContinue) {
    console.log(
      "Setup cancelled. Nothing was changed."
    );
    return;
  }

  const detectedTimezone =
    Intl.DateTimeFormat()
      .resolvedOptions()
      .timeZone ||
    "Asia/Kolkata";

  const household = {
    name:
      await ask(
        "Household name",
        {
          defaultValue:
            "My Home",
          required: true,
        }
      ),

    cookLabel:
      await ask(
        "How should the cook be addressed?",
        {
          defaultValue:
            "Cook",
          required: true,
        }
      ),

    timezone:
      await ask(
        "Timezone",
        {
          defaultValue:
            detectedTimezone,
          required: true,
        }
      ),

    botPrefix:
      await ask(
        "Bot message prefix",
        {
          defaultValue:
            "[Meal Bot 🤖]",
          required: true,
        }
      ),
  };

  console.log(
    "\nWhatsApp group IDs may be left blank here."
  );

  console.log(
    "The WhatsApp pairing and group picker will fill them in later."
  );

  const operationsGroupId =
    await ask(
      "Operations group ID",
      {
        defaultValue: "",
      }
    );

  const useSameGroup =
    operationsGroupId
      ? await askYesNo(
          "Use the same group for cook instructions?",
          false
        )
      : false;

  const cookGroupId =
    useSameGroup
      ? operationsGroupId
      : await ask(
          "Cook group ID",
          {
            defaultValue: "",
          }
        );

  const schedule = {
    menuAnnouncement:
      await ask(
        "Menu announcement time",
        {
          defaultValue:
            "22:00",
        }
      ),

    reviewSummary:
      await ask(
        "Review summary time",
        {
          defaultValue:
            "22:30",
        }
      ),

    lockPlan:
      await ask(
        "Silent lock time",
        {
          defaultValue:
            "22:40",
        }
      ),

    cookDelivery:
      await ask(
        "Cook delivery time",
        {
          defaultValue:
            "22:45",
        }
      ),
  };

  const voiceEnabled =
    process.platform === "darwin"
      ? await askYesNo(
          "Enable macOS voice notes?",
          false
        )
      : false;

  const voice = {
    enabled: voiceEnabled,
    voice:
      voiceEnabled
        ? await ask(
            "macOS voice name",
            {
              defaultValue:
                "Lekha",
              required: true,
            }
          )
        : "System Default",
    speakingRate:
      voiceEnabled
        ? await askQuantity(
            "Speaking rate",
            110
          )
        : 110,
  };

  const members =
    await askMembers();

  console.log(
    "\nWhich member's defaults should guests copy?"
  );

  members.forEach(
    (member, index) => {
      console.log(
        `${index + 1}. ${member.displayName}`
      );
    }
  );

  const guestMemberNumber =
    await ask(
      "Guest template member number",
      {
        defaultValue: 1,
        transform: (value) => {
          const parsed =
            Number(value);

          if (
            !Number.isInteger(parsed) ||
            parsed < 1 ||
            parsed > members.length
          ) {
            throw new Error(
              `Enter a number from 1 to ${members.length}`
            );
          }

          return parsed;
        },
      }
    );

  const weeklyMenu =
    await askWeeklyMenu();

  const config =
    buildSetupConfig({
      household,
      groups: {
        operationsGroupId,
        cookGroupId,
      },
      schedule,
      voice,
      members,
      guestTemplateMemberId:
        members[
          guestMemberNumber - 1
        ].id,
      weeklyMenu,
    });

  const groupsComplete =
    Boolean(
      config.groups.operationsGroupId &&
      config.groups.cookGroupId
    );

  validateHouseholdConfig(
    config,
    {
      allowIncompleteGroups:
        !groupsComplete,
    }
  );

  fs.mkdirSync(
    path.dirname(CONFIG_PATH),
    {
      recursive: true,
    }
  );

  fs.writeFileSync(
    CONFIG_PATH,
    JSON.stringify(
      config,
      null,
      2
    ) + "\n"
  );

  const envCreated =
    writeEnvFile();

  console.log(
    "\n✅ LOCAL CONFIGURATION CREATED"
  );

  console.log(CONFIG_PATH);

  console.log(
    envCreated
      ? "✅ .env created"
      : "ℹ .env already existed and was left unchanged"
  );

  console.log(
    `✅ ${members.length} members configured`
  );

  console.log(
    "✅ Seven-day menu configured"
  );

  if (groupsComplete) {
    console.log(
      "✅ WhatsApp destinations configured"
    );

    console.log(
      "\nNext command:"
    );

    console.log(
      "npm run db:init"
    );
  } else {
    console.log(
      "⚠ WhatsApp destinations are still pending"
    );

    console.log(
      "Next, run npm run setup:whatsapp to pair WhatsApp and choose groups."
    );
  }
}

try {
  await main();
} finally {
  rl.close();
}
