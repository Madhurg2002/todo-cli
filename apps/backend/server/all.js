import app from './index.js';
import { NodeSSHServer } from './ssh-helpers.js';
import { createSession } from './ssh.js';
import { authenticate, closeAccountsPool } from '@todo/shared/accounts';
import { closePgPool } from '@todo/shared/store';

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const SSH_PORT = process.env.SSH_PORT || 2222;

// Where the HTTP(S) surface is reachable from outside (display only).
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

const httpServer = app.listen(PORT, HOST, () => {
  const addr = httpServer.address();
  const bound = addr && typeof addr === 'object' ? addr.port : PORT;
  console.log(`todo web+api  → ${PUBLIC_URL} (listening on ${HOST}:${bound})`);

  // SSH: authenticated TUI (same accounts as the web client)
  const ssh = new NodeSSHServer();

  ssh.on('connection', (client) => {
    // Authenticate with the same username/password as the web client.
    client.on('authentication', (ctx) => {
      authenticate(ctx.username, ctx.password)
        .then((user) => {
          if (user) {
            client.user = user;
            ctx.accept();
            return;
          }
          ctx.reject(['password'], false);
        })
        .catch(() => ctx.reject(['password'], false));
    });

    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('pty', (accept) => accept());
        session.on('shell', (accept) => {
          createSession(accept(), client.user).start();
        });
      });
    });
  });

  ssh.listen(SSH_PORT, HOST, () => {
    console.log(`todo ssh      → ssh -p ${SSH_PORT} <host>   (sign in with your todo.sh account)`);
  });

  // Graceful shutdown: stop accepting, close SSE connections, then exit.
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received — closing servers…`);
    ssh.close(() => {
      httpServer.close(() => {
        closeAccountsPool();
        closePgPool();
        console.log('todo: shut down cleanly.');
        process.exit(0);
      });
      // Force-exit if connections (e.g. open SSE streams) refuse to drain.
      setTimeout(() => process.exit(0), 5000).unref();
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
});
