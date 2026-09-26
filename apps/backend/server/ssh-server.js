import { NodeSSHServer } from './ssh-helpers.js';
import { createSession } from './ssh.js';

const PORT = process.env.SSH_PORT || 2222;
const HOST = process.env.HOST || '0.0.0.0';

const server = new NodeSSHServer();

server.on('connection', (client) => {
  client.on('authentication', (ctx) => {
    // Open access by design: each connection gets its own view of the
    // shared task store. Tighten here if you deploy this publicly.
    ctx.accept();
  });

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

server.listen(PORT, HOST, () => {
  console.log(`todo SSH listening on ${HOST}:${PORT}`);
});
