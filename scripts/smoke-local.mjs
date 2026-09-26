/**
 * Local smoke check: boots the combined server on an alternate port and
 * exercises the API + web + shared bundle. Meant for humans verifying a
 * fresh clone works; uses only local defaults.
 */
process.env.PORT = process.env.PORT || '3666';
process.env.HOST = '127.0.0.1';
process.env.SSH_PORT = process.env.SSH_PORT || '2388';

const base = `http://127.0.0.1:${process.env.PORT}`;
import('./apps/backend/server/all.js');

setTimeout(async () => {
  let failures = 0;
  const check = (name, cond) => {
    console.log(`${cond ? '✔' : '✗'} ${name}`);
    if (!cond) failures++;
  };

  const health = await fetch(`${base}/api/health`);
  check(`API health (${health.status})`, health.status === 200);

  const web = await fetch(`${base}/`);
  const webText = await web.text();
  check(`web terminal served (${web.status})`, web.status === 200 && webText.includes('todo.sh'));

  const bundle = await fetch(`${base}/vendor/shared-commands.js`);
  check(`shared grammar bundle (${bundle.status})`, bundle.status === 200);

  const created = await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'fresh clone works', priority: 'high' }),
  });
  check(`task creation (${created.status})`, created.status === 201);

  const stats = await fetch(`${base}/api/stats`);
  const body = await stats.json();
  check(`stats total=${body.total}`, stats.status === 200 && body.total === 1);

  console.log(failures === 0 ? '\nLocal smoke check passed — the clone is fully working.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}, 2000);
