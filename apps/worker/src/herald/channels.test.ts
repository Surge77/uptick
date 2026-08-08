import { describe, expect, it, vi } from "vitest";
import type { AlertMessage } from "@uptick/core";
import { DeliveryError, deliver, type DeliveryDeps, type DeliveryRequest } from "./channels.js";

const message: AlertMessage = {
  title: "Acme API is DOWN",
  body: "Monitor: Acme API\nCause: ECONNREFUSED",
  color: "#dc2626",
};

function deps(over: Partial<DeliveryDeps> = {}): DeliveryDeps & {
  posts: Array<{ url: string; body: unknown; headers?: Record<string, string> }>;
  emails: Array<{ to: string; subject: string }>;
} {
  const posts: Array<{ url: string; body: unknown; headers?: Record<string, string> }> = [];
  const emails: Array<{ to: string; subject: string }> = [];

  return {
    post: async (url, body, headers) => {
      posts.push({ url, body, headers });
      return 200;
    },
    sendEmail: async (to, subject) => {
      emails.push({ to, subject });
    },
    resolve: async () => ["93.184.216.34"],
    posts,
    emails,
    ...over,
  };
}

function request(over: Partial<DeliveryRequest> = {}): DeliveryRequest {
  return {
    type: "WEBHOOK",
    config: { url: "https://hooks.example.com/uptick" },
    message,
    monitorName: "Acme API",
    ...over,
  };
}

describe("deliver", () => {
  it("sends an email with the alert title as the subject", async () => {
    const d = deps();
    await deliver(request({ type: "EMAIL", config: { to: "ops@example.com" } }), d);

    expect(d.emails).toEqual([{ to: "ops@example.com", subject: "Acme API is DOWN" }]);
  });

  it("posts a Slack attachment with the severity colour", async () => {
    const d = deps();
    await deliver(
      request({ type: "SLACK", config: { webhookUrl: "https://hooks.slack.com/services/x" } }),
      d,
    );

    const body = d.posts[0]!.body as { attachments: Array<{ color: string }> };
    expect(body.attachments[0]!.color).toBe("#dc2626");
  });

  it("converts the colour to decimal for Discord", async () => {
    // Discord rejects a hex string; sending one produces a colourless embed.
    const d = deps();
    await deliver(
      request({ type: "DISCORD", config: { webhookUrl: "https://discord.com/api/webhooks/x" } }),
      d,
    );

    const body = d.posts[0]!.body as { embeds: Array<{ color: number }> };
    expect(body.embeds[0]!.color).toBe(0xdc2626);
  });

  it("posts a generic webhook payload", async () => {
    const d = deps();
    await deliver(request(), d);

    expect(d.posts[0]!.url).toBe("https://hooks.example.com/uptick");
    expect(d.posts[0]!.body).toMatchObject({ monitor: "Acme API", title: "Acme API is DOWN" });
  });

  it("attaches a shared secret header when configured", async () => {
    const d = deps();
    await deliver(request({ config: { url: "https://hooks.example.com/x", secret: "s3cr3t" } }), d);
    expect(d.posts[0]!.headers).toEqual({ "x-uptick-secret": "s3cr3t" });
  });

  it("omits the secret header when not configured", async () => {
    const d = deps();
    await deliver(request(), d);
    expect(d.posts[0]!.headers).toBeUndefined();
  });

  describe("SSRF protection", () => {
    it("refuses a webhook pointed at the metadata endpoint", async () => {
      // A notification channel is otherwise a perfectly good way to make the
      // worker fetch an internal address on demand.
      const post = vi.fn(async () => 200);
      await expect(
        deliver(
          request({ config: { url: "http://169.254.169.254/latest/meta-data/" } }),
          deps({ post }),
        ),
      ).rejects.toThrow(DeliveryError);
      expect(post).not.toHaveBeenCalled();
    });

    it("refuses a destination that resolves privately", async () => {
      const post = vi.fn(async () => 200);
      await expect(
        deliver(request(), deps({ post, resolve: async () => ["10.0.0.5"] })),
      ).rejects.toThrow(/Destination refused/);
      expect(post).not.toHaveBeenCalled();
    });

    it("refuses a non-http protocol", async () => {
      await expect(
        deliver(request({ config: { url: "file:///etc/passwd" } }), deps()),
      ).rejects.toThrow(DeliveryError);
    });

    it("applies the same guard to Slack and Discord", async () => {
      for (const type of ["SLACK", "DISCORD"] as const) {
        const post = vi.fn(async () => 200);
        await expect(
          deliver(
            request({ type, config: { webhookUrl: "http://127.0.0.1:8080/" } }),
            deps({ post }),
          ),
        ).rejects.toThrow(DeliveryError);
        expect(post).not.toHaveBeenCalled();
      }
    });
  });

  describe("failures", () => {
    it("rejects a config missing its destination", async () => {
      await expect(deliver(request({ config: {} }), deps())).rejects.toThrow(/missing "url"/);
    });

    it("rejects a blank destination", async () => {
      await expect(deliver(request({ config: { url: "   " } }), deps())).rejects.toThrow(
        DeliveryError,
      );
    });

    it("treats a non-2xx response as a delivery failure", async () => {
      const d = deps({ post: async () => 500 });
      await expect(deliver(request(), d)).rejects.toThrow(/status 500/);
    });

    it("accepts any 2xx", async () => {
      const d = deps({ post: async () => 204 });
      await expect(deliver(request(), d)).resolves.toBeUndefined();
    });
  });
});
