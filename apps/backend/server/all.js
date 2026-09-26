import app from './index.js';
import { NodeSSHServer } from './ssh-helpers.js';
import { createSession } from './ssh.js';
import { authenticate } from '@todo/shared/accounts';

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const SSH_PORT = process.env.SSH_PORT || 2222;

// HTTP: REST API + static web frontend
const httpServer = app.listen(PORT, HOST, () => {
  const addr = httpServer.address();
  const bound = addr && typeof addr === 'object' ? addr.port : PORT;
  console.log(`todo web+api  → http://${HOST}:${bound}`);

  // SSH: authenticated TUI (same accounts as the web client)
  const ssh = new NodeSSHServer();

  ssh.on('connection', (client) => {
    // Authenticate with the same username/password as the web client.
    client.on('authentication', (ctx) => {
      const user = authenticate(ctx.username, ctx.password);
      if (user) {
        client.user = user;
        ctx.accept();
        return;
      }
      ctx.reject(['password'], false);
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
});
