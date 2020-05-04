import * as fauna from 'faunadb';
const q = fauna.query;

export { q };
export function client() {
  return new fauna.Client({ secret: process.env.FAUNA_TEST_KEY });
}

export async function database() {
  const c = new fauna.Client({ secret: process.env.FAUNA_TEST_KEY });

  const { id, key } = await c.query(
    q.Let(
      {
        id: q.NewId(),
        database: q.CreateDatabase({
          name: q.Var('id'),
        }),
        key: q.CreateKey({
          database: q.Select('ref', q.Var('database')),
          role: 'admin',
        }),
      },
      {
        id: q.Var('id'),
        key: q.Var('key'),
      },
    ),
  );

  const { secret } = key || {};

  return {
    db: new fauna.Client({ secret }),
    drop() {
      return c.query(q.Delete(q.Database(id)));
    },
  };
}

type WrapperTestHandler = (db: any) => Promise<void>;
export function wrapTest(handler: WrapperTestHandler) {
  return async (done: any) => {
    const { db, drop } = await database();
    try {
      // ---
      await handler(db);
      // ---
    } catch (error) {
      done(error);
    } finally {
      await drop();
      done();
    }
  };
}
