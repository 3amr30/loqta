import PgBoss from "pg-boss";

/**
 * Lazy send-only pg-boss handle for the API process (the worker owns the
 * actual queue consumers). Same Postgres, same pgboss schema.
 */
let _boss: PgBoss | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (!_boss) {
    const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, max: 2 });
    boss.on("error", (err) => console.error("[pgboss:api]", err));
    await boss.start();
    _boss = boss;
  }
  return _boss;
}

export async function stopBoss() {
  await _boss?.stop({ graceful: false }).catch(() => {});
  _boss = null;
}
