import type ProtoV2 from "../..";
import type { Connection, Stream } from "@libp2p/interface-connection";

import debug from "debug";
import { decode, encode } from "msgpack-lite";
import pkg1 from "kyber-crystals";
import pkg2 from "superdilithium";
const { kyber } = pkg1;
const { superDilithium } = pkg2;
import { convertLibp2pStream } from "../../stream_wrapper.js";
import { randomString } from "../../utils.js";
import ProtoV2Session from "../../session.js";

const log = debug("protov2:server:0.1.0");

// Compatibility with both NodeJS and Browser
const SubtleCrypto = globalThis.crypto.subtle;

export default (protov2: ProtoV2, appID: string, connection: Connection, stream: Stream) => {
    log(`connection from ${connection.remotePeer.toString()} connecting to ${appID}`);

    let njsStream = convertLibp2pStream(stream);
    let handshaked = false;
    let randomVerifyString = "";
    let asymmKey: { privateKey: Uint8Array, publicKey: Uint8Array } | null = null;
    let encryptionKey: CryptoKey | null = null;
    let oConnection: ProtoV2Session | null = null;

    njsStream.on("data", async (d) => {
        try {
            let buf = Uint8Array.from(d);
            let data = await (encryptionKey ? (async () => {
                // First 16 bytes are the IV, excluding the first byte
                let iv = buf.slice(1, 17);

                // The rest is the encrypted data
                let encryptedData = buf.slice(17);

                // Decrypt the data
                let decryptedData = await SubtleCrypto.decrypt({
                    name: "AES-GCM",
                    iv: iv
                }, encryptionKey, encryptedData);

                // Decode the data
                return buf[0] === 0x03 ? new Uint8Array(decryptedData) : decode(new Uint8Array(decryptedData));
            })() : decode(buf.slice(1)));

            switch (buf[0]) {
                case 0x02: {
                    if (!handshaked) {
                        let op = data[0] as number;
                        switch (op) {
                            // Client HELLO
                            case 1: {
                                // Generate new key      
                                let keyPair = await kyber.keyPair();
                                asymmKey = keyPair;

                                // Sign the key with preconfigured key
                                let rootPrivKey = Uint8Array.from(
                                    (protov2.config.identifiers[appID].privateKey
                                        .match(/[0-9a-f]{2}/g) ?? []).map((x: string) => parseInt(x, 16))
                                );

                                let signature = await superDilithium.signDetached(keyPair.publicKey, rootPrivKey);

                                // Send the public key and signature
                                njsStream.write(Uint8Array.from([
                                    0x02,
                                    ...encode([
                                        2,
                                        Array.from(keyPair.publicKey).map((x) => x.toString(16).padStart(2, "0")).join(""),
                                        Array.from(signature).map((x) => x.toString(16).padStart(2, "0")).join("")
                                    ])
                                ]));
                                break;
                            }

                            // Server HELLO: not allowed here
                            case 2: {
                                njsStream.end();
                                break;
                            }

                            // Client AES key
                            case 3: {
                                // Decrypt to get AES key
                                let aesKey = await kyber.decrypt(Uint8Array.from(
                                    (data[1].match(/[0-9a-f]{2}/g) ?? []).map((x: string) => parseInt(x, 16))
                                ), asymmKey!.privateKey);

                                // Import the key
                                encryptionKey = await SubtleCrypto.importKey(
                                    "raw",
                                    aesKey,
                                    "AES-GCM",
                                    true,
                                    ["encrypt", "decrypt"]
                                );

                                // Send test encryption (packet 4)
                                randomVerifyString = randomString(64);
                                let iv = crypto.getRandomValues(new Uint8Array(16));
                                let encryptedData = await SubtleCrypto.encrypt({
                                    name: "AES-GCM",
                                    iv: iv
                                }, encryptionKey, encode([4, randomVerifyString]));

                                njsStream.write(Uint8Array.from([
                                    0x02,
                                    ...iv,
                                    ...new Uint8Array(encryptedData)
                                ]));
                                break;
                            }

                            // Server encryption test: not allowed here
                            case 4: {
                                njsStream.end();
                                break;
                            }

                            case 5: {
                                // Verify signature
                                if (await superDilithium.verifyDetached(
                                    Uint8Array.from(
                                        (data[2].match(/[0-9a-f]{2}/g) ?? []).map((x: string) => parseInt(x, 16))
                                    ),
                                    randomVerifyString,
                                    Uint8Array.from(
                                        (data[1].match(/[0-9a-f]{2}/g) ?? []).map((x: string) => parseInt(x, 16))
                                    )
                                )) {
                                    // Handshake successful
                                    handshaked = true;

                                    if (!Object.hasOwn(protov2._activeListen, appID)) protov2._activeListen[appID] = new Map();

                                    // Test if session exists
                                    if (protov2._activeListen[appID].has(data[1])) {
                                        // Session exists, hook up existing session
                                        oConnection = protov2._activeListen[appID].get(data[1])!;
                                    } else {
                                        // Session doesn't exist, create new session
                                        oConnection = new ProtoV2Session(data[1], false);
                                        protov2._activeListen[appID].set(data[1], oConnection);
                                        
                                    }

                                    async function handleDataSend(qos: number, data: Uint8Array, dupID?: number) {
                                        let constructedData: Uint8Array;
                                        if (qos === 1) {
                                            constructedData = Uint8Array.from([
                                                0x01,
                                                (dupID! >> 24) & 0xFF,
                                                (dupID! >> 16) & 0xFF,
                                                (dupID! >> 8) & 0xFF,
                                                dupID! & 0xFF,
                                                0x00,
                                                ...data
                                            ]);

                                            // Re-add the data to the queue if no ack is received
                                            setTimeout(() => {
                                                if (!oConnection!.qos1Accepted.has(dupID!)) oConnection!.qos1Buffer.push([dupID!, data]);
                                            }, 5000);
                                        } else {
                                            constructedData = Uint8Array.from([
                                                0x00,
                                                ...data
                                            ]);
                                        }

                                        let iv = crypto.getRandomValues(new Uint8Array(16));
                                        let encrypted = await SubtleCrypto.encrypt({
                                            name: "AES-GCM",
                                            iv: iv
                                        }, encryptionKey, constructedData);

                                        njsStream.write(Uint8Array.from([
                                            0x03,
                                            ...iv,
                                            ...new Uint8Array(encrypted)
                                        ]));
                                    }

                                    function handleDataRequeue() {
                                        for (let packet of oConnection!.qos1Buffer) {
                                            handleDataSend(1, packet[1], packet[0]);
                                        }
                                    }

                                    // Hook up the connection
                                    oConnection.on("data_ret", handleDataSend);

                                    // Send all queued data
                                    handleDataRequeue();
                                    oConnection.on("qos1:queued", handleDataRequeue);

                                    njsStream.on("close", () => {
                                        oConnection!.removeListener("data_ret", handleDataSend);
                                        oConnection!.removeListener("qos1:queued", handleDataRequeue);

                                        setTimeout(() => {
                                            if (oConnection.listenerCount("data_ret") === 0) {
                                                oConnection.emit("close");
                                                oConnection.removeAllListeners();
                                                oConnection = null;
                                                protov2._activeListen[appID].delete(data[1]);
                                            }
                                        }, protov2.config.resumptionWait);
                                    });
                                } else {
                                    // Invalid session ID
                                    njsStream.end();
                                }
                            }
                        }
                    } else njsStream.end();
                    break;
                }

                case 0x03: {
                    if (!handshaked) njsStream.end();

                    if (data[0] === 1) {
                        // QoS 1 packet
                        let dupID = (data[1] << 24) | (data[2] << 16) | (data[3] << 8) | data[4];
                        if (data[5] === 0xFF) {
                            // ACK packet
                            oConnection.qos1Accepted.add(dupID);
                        } else {
                            let packetData = (data as Uint8Array).slice(6);

                            oConnection.qos1Accepted.add(dupID);
                            oConnection.emit("data", 1, packetData);

                            // Send ACK
                            let iv = crypto.getRandomValues(new Uint8Array(16));
                            let encryptedData = await SubtleCrypto.encrypt({
                                name: "AES-GCM",
                                iv: iv
                            }, encryptionKey, Uint8Array.from([
                                1,
                                (dupID >> 24) & 0xFF,
                                (dupID >> 16) & 0xFF,
                                (dupID >> 8) & 0xFF,
                                dupID & 0xFF,
                                0xFF
                            ]));

                            njsStream.write(Uint8Array.from([
                                0x03,
                                ...iv,
                                ...new Uint8Array(encryptedData)
                            ]));
                        }
                    } else {
                        // QoS 0 packet
                        let packetData = (data as Uint8Array).slice(1);
                        oConnection.emit("data", 0, packetData);
                    }
                }
            }
        } catch (e) {
            log(e);
            njsStream.end();
        }
    });

    njsStream.on("end", () => {
        njsStream.removeAllListeners();
        njsStream = null;
        asymmKey = null;
        encryptionKey = null;
        oConnection = null;
    });
}