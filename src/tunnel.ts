import net from 'net';
import { Client } from 'ssh2';
import type { ConnectConfig } from 'ssh2';
import { getPort, readFile } from './utils';
import createLogger from './logger';
import type { ServerConfig } from './server';

const logger = createLogger('db:tunnel');

interface TunnelConfig extends ConnectConfig {
  srcHost: string;
  srcPort: number;
  dstHost: string;
  dstPort: number;
  sshPort: number;
  localHost: string;
  localPort: number;
}

export default function (serverInfo: ServerConfig): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    logger().debug('configuring tunnel');
    configTunnel(serverInfo).then((config): void => {
      const connections: (net.Socket | Client)[] = [];

      logger().debug('creating ssh tunnel server');
      const server = net.createServer((conn) => {
        conn.on('error', (err) => server.emit('error', err));

        logger().debug('creating ssh tunnel client');
        const client = new Client();
        connections.push(conn);

        client.on('error', (err) => server.emit('error', err));

        client.on('ready', () => {
          logger().debug('connected ssh tunnel client');
          connections.push(client);

          logger().debug('forwarding ssh tunnel client output');
          client.forwardOut(
            config.srcHost,
            config.srcPort,
            config.dstHost,
            config.dstPort,
            (err, sshStream) => {
              if (err) {
                logger().error('error ssh connection %j', err);
                server.close();
                server.emit('error', err);
                return;
              }
              server.emit('success');
              conn.pipe(sshStream).pipe(conn);
            });
        });

        try {
          logger().debug('connecting ssh tunnel client');
          client.connect(config);
        } catch (err) {
          server.emit('error', err);
        }
      });

      server.once('close', () => {
        logger().debug('close ssh tunnel server');
        connections.forEach((conn) => conn.end());
      });

      logger().debug('connecting ssh tunnel server');
      server.listen(config.localPort, config.localHost, () => {
        logger().debug('connected ssh tunnel server');
        resolve(server);
      }).on('error', (err) => {
        reject(err);
      });
    }).catch((err) => {
      reject(err);
    });
  });
}


async function configTunnel(serverInfo: ServerConfig) {
  if (!serverInfo.port || !serverInfo.host) {
    throw new Error('Host and port not specified for tunnel');
  }
  if (!serverInfo.ssh) {
    throw new Error('SSH information not specified');
  }
  const config: TunnelConfig = {
    username: serverInfo.ssh.user,
    port: serverInfo.ssh.port,
    host: serverInfo.ssh.host,
    dstPort: serverInfo.port,
    dstHost: serverInfo.host,
    sshPort: 22,
    srcPort: 0,
    srcHost: 'localhost',
    localHost: 'localhost',
    localPort: await getPort(),
  };
  if (serverInfo.ssh.password) config.password = serverInfo.ssh.password;
  if (serverInfo.ssh.passphrase) config.passphrase = serverInfo.ssh.passphrase;
  if (serverInfo.ssh.privateKey) {
    config.privateKey = await readFile(serverInfo.ssh.privateKey);
  }
  return config;
}
