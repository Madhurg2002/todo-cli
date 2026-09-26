import app from './index.js';
import { NodeSSHServer } from './ssh-helpers.js';
import { createSession } from './ssh.js';

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const SSH_PORT = process.env.SSH_PORT || 2222;

// HTTP: REST API + static web frontend
const httpServer = app.listen(PORT, HOST, () => {
  const bound = typeof httpServer.address() === 'object' ? httpServer.address().port : PORT;
  console.log(`todo web+api  → http://${HOST}:${bound}`);

  // SSH: interactive TUI
  const ssh = new NodeSSHServer();
  ssh.on('connection', (client) => {
    client.on('authentication', (ctx) => ctx.accept());
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('pty', (accept) => accept());
        session.on('shell', (accept) => {
          const stream = accept();
          createSession(stream).start();
        });
      });
    });
  });

  ssh.listen(SSH_PORT, HOST, () => {
    console.log(`todo ssh      → ssh -p ${SSH_PORT} ${HOST === '0.0.0.0' ? '<host>' : HOST}`);
  });
});
