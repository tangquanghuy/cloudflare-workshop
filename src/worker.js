export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        hasD1: !!env.DB,
        project: "creative-workshop",
      });
    }

    if (url.pathname === "/api/db-test") {
      if (!env.DB) {
        return Response.json(
          {
            ok: false,
            error: "D1 binding `DB` is not configured.",
          },
          { status: 500 },
        );
      }

      try {
        const row = await env.DB.prepare("SELECT 1 AS ok").first();
        return Response.json({ ok: true, row });
      } catch (error) {
        return Response.json(
          {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          },
          { status: 500 },
        );
      }
    }

    return env.ASSETS.fetch(request);
  },
};
