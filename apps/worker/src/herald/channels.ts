import { checkUrl, type AlertMessage, type Resolver } from "@uptick/core";
import { assertTargetAllowed } from "@uptick/core";

/**
 * Channel adapters.
 *
 * Webhook and chat destinations are user-supplied URLs, exactly like probe
 * targets, so they go through the same SSRF guard. A notification channel is
 * otherwise a perfectly good way to make the worker fetch an internal address
 * on demand.
 */

export type ChannelType = "EMAIL" | "SLACK" | "DISCORD" | "WEBHOOK";

export interface DeliveryRequest {
  type: ChannelType;
  config: Record<string, unknown>;
  message: AlertMessage;
  monitorName: string;
}

export interface DeliveryDeps {
  /** Posts JSON to a URL. Injected so channels are testable without network. */
  post: (url: string, body: unknown, headers?: Record<string, string>) => Promise<number>;
  sendEmail: (to: string, subject: string, text: string) => Promise<void>;
  resolve: Resolver;
}

export class DeliveryError extends Error {}

function readString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new DeliveryError(`Channel config is missing "${key}"`);
  }
  return value.trim();
}

/**
 * Validate a user-supplied destination URL before posting to it.
 *
 * Identical treatment to a probe target: resolve first, then check the
 * resolved address. A webhook pointed at 169.254.169.254 would otherwise
 * exfiltrate cloud credentials into whatever the response is echoed to.
 */
async function assertDestinationAllowed(url: string, resolve: Resolver): Promise<void> {
  const structural = checkUrl(url);
  if (!structural.allowed) throw new DeliveryError(`Destination refused: ${structural.reason}`);

  const blocked = await assertTargetAllowed(url, resolve);
  if (blocked) throw new DeliveryError(`Destination refused: ${blocked}`);
}

function assertAccepted(status: number, channel: string): void {
  if (status < 200 || status >= 300) {
    throw new DeliveryError(`${channel} rejected the delivery with status ${status}`);
  }
}

/** Deliver one alert over one channel. */
export async function deliver(request: DeliveryRequest, deps: DeliveryDeps): Promise<void> {
  const { message } = request;

  switch (request.type) {
    case "EMAIL": {
      const to = readString(request.config, "to");
      await deps.sendEmail(to, message.title, message.body);
      return;
    }

    case "SLACK": {
      const url = readString(request.config, "webhookUrl");
      await assertDestinationAllowed(url, deps.resolve);
      const status = await deps.post(url, {
        text: message.title,
        attachments: [{ color: message.color, text: message.body }],
      });
      assertAccepted(status, "Slack");
      return;
    }

    case "DISCORD": {
      const url = readString(request.config, "webhookUrl");
      await assertDestinationAllowed(url, deps.resolve);
      const status = await deps.post(url, {
        content: message.title,
        embeds: [
          {
            title: message.title,
            description: message.body,
            // Discord takes a decimal colour, not a hex string.
            color: Number.parseInt(message.color.replace("#", ""), 16),
          },
        ],
      });
      assertAccepted(status, "Discord");
      return;
    }

    case "WEBHOOK": {
      const url = readString(request.config, "url");
      await assertDestinationAllowed(url, deps.resolve);
      const secret = typeof request.config.secret === "string" ? request.config.secret : null;
      const status = await deps.post(
        url,
        {
          monitor: request.monitorName,
          title: message.title,
          body: message.body,
          severityColor: message.color,
        },
        secret ? { "x-uptick-secret": secret } : undefined,
      );
      assertAccepted(status, "Webhook");
      return;
    }
  }
}
