/**
 * @file proxy.js
 * @description Bedrock Protocol Packet Logger Proxy. Intercepts, decodes, and logs 
 * Minecraft Bedrock (RakNet) packets to a SQLite database. Designed to capture unabridged 
 * packet flows for reversing mechanics without locking up the event loop.
 * @requires bedrock-protocol
 * @requires better-sqlite3
 * @requires dotenv
 */

require('dotenv').config();
const { Relay } = require('bedrock-protocol');
const Database = require('better-sqlite3');

/**
 * Handles initialization of the SQLite database and logging of filtered RakNet packets.
 */
class PacketLogger {
  /**
   * Initializes the SQLite database, configures WAL mode, and prepares SQL statements.
   *
   * @param {string} dbPath - Path to the SQLite database file.
   */
  constructor(dbPath) {
    /**
     * The active SQLite database connection.
     * @type {Database.Database}
     */
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS packet_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
        direction TEXT NOT NULL,
        packet_name TEXT NOT NULL,
        payload JSON NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_packet_name ON packet_log(packet_name);
      CREATE INDEX IF NOT EXISTS idx_direction ON packet_log(direction);
    `);

    /**
     * The prepared statement for inserting new packet records.
     * @type {Database.Statement}
     */
    this.insertStmt = this.db.prepare(`
      INSERT INTO packet_log (direction, packet_name, payload)
      VALUES (@direction, @packet_name, @payload)
    `);

    /**
     * A collection of high-frequency packet names to drop, preventing database bloat.
     * @type {Set<string>}
     */
    this.ignoredPackets = new Set([
      'move_actor_delta',
      'move_player',
      'player_auth_input',
      'network_chunk_publisher_update',
      'level_chunk',
      'client_cache_status',
      'tick_sync',
      'update_attributes',
      'set_time'
    ]);
  }

  /**
   * Logs a packet to the database if it isn't in the ignore list.
   * Automatically handles BigInt serialization and truncates massive Buffer payloads.
   * 
   * @param {string} direction - The traffic direction ('serverbound' or 'clientbound').
   * @param {string} packetName - The name of the RakNet packet.
   * @param {Object} payload - The decoded packet payload.
   */
  logPacket(direction, packetName, payload) {
    if (this.ignoredPackets.has(packetName)) {
      return;
    }

    try {
      const safePayload = JSON.stringify(payload, (key, value) => {
        if (typeof value === 'bigint') {
          return value.toString();
        }
        if (Buffer.isBuffer(value) || (value && value.type === 'Buffer')) {
          return '[Buffer]';
        }
        return value;
      });

      this.insertStmt.run({
        direction,
        packet_name: packetName,
        payload: safePayload
      });
    } catch (error) {
      console.error(`[DB Error] Failed to log packet ${packetName}:`, error.message);
    }
  }

  /**
   * Closes the database connection cleanly.
   */
  close() {
    this.db.close();
  }
}

/**
 * Sets up a Man-In-The-Middle proxy using bedrock-protocol to intercept traffic.
 */
class BedrockProxy {
  /**
   * Initializes proxy configuration and assigns the logger.
   *
   * @param {string} host - The destination Bedrock server IP.
   * @param {number} port - The destination Bedrock server Port.
   * @param {number} listenPort - The local port this proxy will listen on.
   * @param {PacketLogger} logger - The logger instance used to record packets.
   */
  constructor(host, port, listenPort, logger) {
    /**
     * The destination Bedrock server IP.
     * @type {string}
     */
    this.host = host;

    /**
     * The destination Bedrock server Port.
     * @type {number}
     */
    this.port = port;

    /**
     * The local port this proxy will listen on.
     * @type {number}
     */
    this.listenPort = listenPort;

    /**
     * The logger instance used to record packets.
     * @type {PacketLogger}
     */
    this.logger = logger;

    /**
     * The internal bedrock-protocol Relay instance.
     * @type {Relay|null}
     */
    this.relay = null;
  }

  /**
   * Starts the proxy server, initializes the relay, and binds packet event listeners.
   */
  start() {
    console.log(`Starting proxy... listening on 0.0.0.0:${this.listenPort}`);
    console.log(`Forwarding to ${this.host}:${this.port}`);

    this.relay = new Relay({
      host: '0.0.0.0',
      port: this.listenPort,
      destination: {
        host: this.host,
        port: this.port
      }
    });

    this.relay.listen();

    this.relay.on('connect', (player) => {
      console.log(`[+] Player connected! Hooking packet events...`);

      player.on('serverbound', ({ name, params }) => {
        this.logger.logPacket('serverbound', name, params);
      });

      player.on('clientbound', ({ name, params }) => {
        this.logger.logPacket('clientbound', name, params);
      });
    });

    this.relay.on('error', (err) => {
      console.error('[Relay Error]', err);
    });
  }
}

const DB_FILE = process.env.DB_FILE || 'packets.db';
const TARGET_HOST = process.env.TARGET_HOST;
const TARGET_PORT = parseInt(process.env.TARGET_PORT, 10) || 19132;
const PROXY_PORT = parseInt(process.env.PROXY_PORT, 10) || 19131;

if (!TARGET_HOST) {
  console.error('Fatal: TARGET_HOST is not defined in the .env file. Fix your shit and try again.');
  process.exit(1);
}

const dbLogger = new PacketLogger(DB_FILE);
const proxy = new BedrockProxy(TARGET_HOST, TARGET_PORT, PROXY_PORT, dbLogger);

proxy.start();

process.on('SIGINT', () => {
  console.log('\nCaught interrupt signal, flushing database and shutting down...');
  dbLogger.close();
  process.exit(0);
});
