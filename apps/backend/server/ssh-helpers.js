import ssh2 from 'ssh2';
const { Server } = ssh2;
import { generateKeyPairSync } from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Thin wrapper around ssh2.Server that guarantees a host key.
 * A persistent RSA key pair (PKCS8 PEM, which ssh2 parses natively) is
 * generated under .ssh-host/ on first run so clients see a stable
 * fingerprint across restarts. Override the location with SSH_HOST_KEY_DIR.
 */
export class NodeSSHServer extends Server {
  constructor({ keyDir = '.ssh-host' } = {}) {
    const dir = path.resolve(process.env.SSH_HOST_KEY_DIR || keyDir);
    const privPath = path.join(dir, 'host_key');

    let hostKey;
    if (fs.existsSync(privPath)) {
      hostKey = fs.readFileSync(privPath);
    } else {
      fs.mkdirSync(dir, { recursive: true });
      const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      // PKCS1 ("BEGIN RSA PRIVATE KEY") is the format ssh2 parses natively.
      const privPem = privateKey.export({ type: 'pkcs1', format: 'pem' });
      fs.writeFileSync(privPath, privPem, { mode: 0o600 });
      hostKey = Buffer.from(privPem);
    }

    // ssh2's Server emits 'connection' natively; no listener needed here.
    super({ hostKeys: [hostKey] });
  }
}
