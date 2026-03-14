export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        ok: true,
        hasD1: !!env.ngnl_build,
        project: "creative-workshop",
      });
    }

    if (url.pathname === "/api/db-test") {
      if (!env.ngnl_build) {
        return Response.json(
          {
            ok: false,
            error: "D1 binding `ngnl_build` is not configured.",
          },
          { status: 500 },
        );
      }

      try {
        const row = await env.ngnl_build.prepare("SELECT 1 AS ok").first();
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

