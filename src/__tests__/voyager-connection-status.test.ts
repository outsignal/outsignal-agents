import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoyagerClient, VoyagerError } from "../../worker/src/voyager-client";

describe("VoyagerClient.checkConnectionStatus", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    warnSpy.mockRestore();
  });

  it("logs when profileId extraction fails", async () => {
    const client = new VoyagerClient("li_at", '"ajax:123"', undefined);

    const status = await client.checkConnectionStatus("https://www.linkedin.com/company/openai/");

    expect(status).toBe("unknown");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("failed to extract profileId"),
    );
  });

  it("logs checkpoint redirects with status and url", async () => {
    fetchMock.mockResolvedValue(
      new Response("checkpoint", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const client = new VoyagerClient("li_at", '"ajax:123"', undefined);
    const requestSpy = vi
      .spyOn(client as unknown as { request: (path: string) => Promise<Response> }, "request")
      .mockResolvedValue({
        status: 200,
        url: "https://www.linkedin.com/checkpoint/challenge",
      } as Response);

    const status = await client.checkConnectionStatus("https://www.linkedin.com/in/jane-doe/");

    expect(status).toBe("unknown");
    expect(requestSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("checkpoint on profile resolve"),
    );
  });

  it("logs unknown response shapes with a body preview", async () => {
    const client = new VoyagerClient("li_at", '"ajax:123"', undefined);
    vi.spyOn(
      client as unknown as {
        request: (path: string) => Promise<Response>;
      },
      "request",
    )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              "*elements": ["urn:li:fsd_profile:ACoAAResolved123"],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            memberRelationship: { distanceOfConnection: "DISTANCE_99" },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    const status = await client.checkConnectionStatus("https://www.linkedin.com/in/jane-doe/");

    expect(status).toBe("unknown");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("unknown relationship shape"),
    );
  });

  it("resolves member ID before hitting the relationship endpoint", async () => {
    const client = new VoyagerClient("li_at", '"ajax:123"', undefined);
    const requestSpy = vi
      .spyOn(
        client as unknown as {
          request: (path: string) => Promise<Response>;
        },
        "request",
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              "*elements": ["urn:li:fsd_profile:ACoAAResolved123"],
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            memberRelationship: { distanceOfConnection: "DISTANCE_1" },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    const result = await client.checkConnectionStatusDetailed(
      "https://www.linkedin.com/in/jane-doe/",
    );

    expect(result).toEqual({ status: "connected" });
    expect(requestSpy.mock.calls[0]?.[0]).toContain(
      "memberIdentity=jane-doe",
    );
    expect(requestSpy.mock.calls[1]?.[0]).toBe(
      "/identity/profiles/ACoAAResolved123/relationships",
    );
  });

  it("logs thrown Voyager errors with status and body preview", async () => {
    const client = new VoyagerClient("li_at", '"ajax:123"', undefined);
    vi.spyOn(
      client as unknown as {
        request: (path: string) => Promise<Response>;
      },
      "request",
    ).mockRejectedValue(new VoyagerError(403, "checkpoint_detected"));

    const status = await client.checkConnectionStatus("https://www.linkedin.com/in/jane-doe/");

    expect(status).toBe("unknown");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("status=403 body=checkpoint_detected"),
    );
  });

  it("flags 404s for browser fallback", async () => {
    const client = new VoyagerClient("li_at", '"ajax:123"', undefined);
    vi.spyOn(
      client as unknown as {
        request: (path: string) => Promise<Response>;
      },
      "request",
    ).mockRejectedValue(new VoyagerError(404, '{"status":404}'));

    const result = await client.checkConnectionStatusDetailed(
      "https://www.linkedin.com/in/jane-doe/",
    );

    expect(result).toEqual({
      status: "unknown",
      shouldBrowserFallback: true,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("status=404 body={\"status\":404}"),
    );
  });
});
