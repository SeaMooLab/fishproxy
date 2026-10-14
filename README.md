# 🐠🌐 (fishproxy)

A Man-In-The-Middle (MITM) RakNet proxy for Minecraft Bedrock. This utility sits between your Minecraft client and a Bedrock Dedicated Server, intercepts the encrypted traffic, decodes the payloads, and dumps them directly into a SQLite database. 

It specifically filters out movement/chunk-loading spam so your database doesn't bloat to 50GB in three minutes, making it perfect for reverse-engineering mechanics like fishing, entity interactions, and container transactions.

## Prerequisites

- **Node.js**: Minimum v20. If you don't have it, [go get it](https://nodejs.org/).
- **A Brain**: You need to know the IP of the server you are trying to proxy. Optional but strongly recommended.

## Setup & Installation

1. **Unpack the archive.** Don't try to run it from inside the Windows zip viewer like a psycho. Extract it to a real folder.
2. **Configure your environment.** Copy the `.env.example` file and rename it to `.env`. Open it and set the `TARGET_HOST` to the IP address of the Bedrock server you want to connect to.
3. **Install dependencies.** Open your terminal in this folder and run:

   ```bash
   npm ci
   ```

Note: Use npm ci, not npm install. We are using better-sqlite3 which relies on compiled C++ binaries. npm ci ensures you get the exact locked version built for your OS and architecture without fucking up the dependency treem

## Usage
 * Start the proxy:
   ```
   npm start
   ```

 * Open your Minecraft Bedrock client.
 * Add a new server. Instead of the real server's IP, connect to your proxy:
   * IP: 127.0.0.1 (or your local machine's IP)
   * Port: 19131 (or whatever PROXY_PORT you set in the .env)
 * Play the game. Go fish, move shit around in chests, whatever you need to test.
 * When you are done, press Ctrl + C in the terminal to gracefully shut down the proxy and flush the Write-Ahead Log (WAL) to disk.

## Querying the Data
The proxy writes everything to packets.db. You can open this file using DBeaver, DB Browser for SQLite, or the standard sqlite3 CLI.
Here are a few queries to get you started:
Isolate Fishing Mechanics
Look for the rod cast, bobber entity creation, bite splash particles, and the reel-in:

```sql
SELECT id, timestamp, direction, packet_name, payload
FROM packet_log 
WHERE packet_name IN ('inventory_transaction', 'level_sound_event', 'actor_event', 'level_event')
ORDER BY id ASC;
```

## Isolate Container / Inventory Mechanics
Mojang overhauled container networking to prevent inventory spoofing. You'll need to map client requests to server responses:
```sql
SELECT id, timestamp, direction, packet_name, payload
FROM packet_log 
WHERE packet_name IN ('interact', 'container_open', 'container_close', 'item_stack_request', 'item_stack_response', 'inventory_slot', 'inventory_content')
ORDER BY id ASC;
```

