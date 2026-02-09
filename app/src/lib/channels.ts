/**
 * Channel integration configuration and types.
 *
 * OpenClaw supports channel integrations via its config file (openclaw.json).
 * Channels are configured by writing to `channels.<platform>` in the config,
 * then the gateway picks them up automatically (or on restart).
 *
 * Supported platforms (MVP): Slack, Telegram, Discord
 *
 * Docs:
 * - https://docs.openclaw.ai/channels/slack
 * - https://docs.openclaw.ai/channels/telegram
 * - https://docs.openclaw.ai/channels/discord
 */

export type ChannelType = "slack" | "telegram" | "discord";

export const CHANNEL_TYPES: ChannelType[] = ["slack", "telegram", "discord"];

/** What credentials each platform requires */
export interface ChannelCredentials {
  slack: {
    appToken: string;   // xapp-... (Socket Mode, connections:write scope)
    botToken: string;   // xoxb-... (OAuth bot token)
    userToken?: string; // xoxp-... (User OAuth Token, optional)
  };
  telegram: {
    botToken: string;  // From @BotFather
  };
  discord: {
    token: string;     // Discord bot token from Developer Portal
  };
}

/** Channel status returned by the API */
export interface ChannelInfo {
  type: ChannelType;
  enabled: boolean;
  status: "connected" | "disconnected" | "error";
  error?: string;
}

/** Validation: what fields are required per channel type */
const REQUIRED_FIELDS: Record<ChannelType, string[]> = {
  slack: ["appToken", "botToken"],
  telegram: ["botToken"],
  discord: ["token"],
};

/** Token format prefixes for basic validation */
const TOKEN_PREFIXES: Record<string, string> = {
  "slack.appToken": "xapp-",
  "slack.botToken": "xoxb-",
  "slack.userToken": "xoxp-",
};

/**
 * Validate channel config before writing to container.
 * Returns null if valid, or an error message string.
 */
export function validateChannelConfig(
  type: ChannelType,
  config: Record<string, string>,
): string | null {
  const required = REQUIRED_FIELDS[type];
  if (!required) return `Unknown channel type: ${type}`;

  for (const field of required) {
    const value = config[field];
    if (!value || typeof value !== "string" || value.trim().length === 0) {
      return `Missing required field: ${field}`;
    }

    // Check token format prefixes where applicable
    const prefixKey = `${type}.${field}`;
    const expectedPrefix = TOKEN_PREFIXES[prefixKey];
    if (expectedPrefix && !value.startsWith(expectedPrefix)) {
      return `Invalid ${field}: must start with "${expectedPrefix}"`;
    }
  }

  // Validate optional fields if provided
  if (type === "slack" && config.userToken) {
    const userToken = config.userToken.trim();
    if (userToken.length > 0 && !userToken.startsWith("xoxp-")) {
      return `Invalid userToken: must start with "xoxp-"`;
    }
  }

  return null;
}

/**
 * Build the openclaw config JSON object for a channel.
 * This gets written into the container's openclaw.json.
 */
export function buildChannelConfig(
  type: ChannelType,
  config: Record<string, string>,
): Record<string, unknown> {
  switch (type) {
    case "slack": {
      const slackConfig: Record<string, unknown> = {
        enabled: true,
        appToken: config.appToken,
        botToken: config.botToken,
        slashCommand: {
          enabled: true,
          name: "openclaw",
          ephemeral: true,
        },
        commands: {
          native: true,
        },
      };
      // Only include userToken if it's provided and non-empty
      if (config.userToken && config.userToken.trim().length > 0) {
        slackConfig.userToken = config.userToken;
      }
      return slackConfig;
    }
    case "telegram":
      return {
        enabled: true,
        botToken: config.botToken,
      };
    case "discord":
      return {
        enabled: true,
        token: config.token,
      };
  }
}
