import type ProtoV2 from "../..";
import type { Connection, Stream } from "@libp2p/interface-connection";

import debug from "debug";
import { decode, encode } from "msgpack-lite";
import pkg1 from "kyber-crystals";
import pkg2 from "superdilithium";
const { kyber } = pkg1;
const { superDilithium } = pkg2;
import { convertLibp2pStream } from "../../stream_wrapper.js";
import ProtoV2Session from "../../session.js";

const log = debug("protov2:client:0.1.0");

// Compatibility with both NodeJS and Browser
const SubtleCrypto = globalThis.crypto.subtle;

export default (protov2: ProtoV2, appID: string, session: {
    publicKey: string,
    privateKey: string,
    existingSession?: ProtoV2Session
}, connection: Connection, stream: Stream): Promise<[new: boolean, session: ProtoV2Session]> => {
    return new Promise((resolve, reject) => {
        log(`connected to ${connection.remotePeer.toString()} for ${appID}`);

        let njsStream = convertLibp2pStream(stream);
        let handshaked = false;
        let randomVerifyString = "";
        let asymmKey: { privateKey: Uint8Array, publicKey: Uint8Array } | null = null;
        let encryptionKey: CryptoKey | null = null;
        let oSession: ProtoV2Session | null = null;

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
                            switch (data[0] as number) {
                                // Client HELLO: not allowed, we are the client
                                case 1: {
                                    log("terminated connection: client hello");
                                    njsStream.end();
                                    break;
                                }

                                // Server HELLO
                                case 2: {
                                    // Check if server returned correct signature
                                    let newPublicKey = Uint8Array.from((data[1] as string).match(/[0-9a-f]{2}/g)!.map((x) => parseInt(x, 16)));
                                    let signature = Uint8Array.from((data[2] as string).match(/[0-9a-f]{2}/g)!.map((x) => parseInt(x, 16)));

                                    let verified = false;
                                    for (let publicKeyString in protov2.config.identifiers[appID].publicKeys) {
                                        let rootPublicKey = Uint8Array.from(publicKeyString.match(/[0-9a-f]{2}/g)!.map((x) => parseInt(x, 16)));

                                        if (superDilithium.verifyDetached(signature, newPublicKey, rootPublicKey)) {
                                            verified = true;
                                            break;
                                        }
                                    }

                                    if (!verified) {
                                        log("terminated connection: invalid signature");
                                        njsStream.end();
                                        break;
                                    }

                                    let encryptedKey = await kyber.encrypt(newPublicKey);
                                    encryptionKey = await SubtleCrypto.importKey("raw", encryptedKey.secret, "AES-GCM", false, ["encrypt", "decrypt"]);

                                    // Send the encrypted key
                                    njsStream.write(Uint8Array.from([
                                        0x02,
                                        ...encode([
                                            3,
                                            Array.from(encryptedKey.cyphertext).map((x) => x.toString(16).padStart(2, "0")).join("")
                                        ])
                                    ]));
                                }

                                // Client AES key: not allowed, we are the client
                                case 3: {
                                    log("terminated connection: client aes key");
                                    njsStream.end();
                                    break;
                                }

                                // server encryption test
                                case 4: {
                                    randomVerifyString = data[1] as string;

                                    let signature = await superDilithium.signDetached(randomVerifyString, Uint8Array.from(session.privateKey.match(/[0-9a-f]{2}/g)!.map((x) => parseInt(x, 16))));
                                    let iv = crypto.getRandomValues(new Uint8Array(16));

                                    let encryptedData = await SubtleCrypto.encrypt({
                                        name: "AES-GCM",
                                        iv: iv
                                    }, encryptionKey!, encode([
                                        5,
                                        session.publicKey,
                                        Array.from(signature).map((x) => x.toString(16).padStart(2, "0")).join("")
                                    ]));

                                    njsStream.write(Uint8Array.from([
                                        0x02,
                                        ...iv,
                                        ...new Uint8Array(encryptedData)
                                    ]));
                                }

                                // client session connect: not allowed, we are the client
                                case 5: {
                                    log("terminated connection: client session connect");
                                    njsStream.end();
                                    break;
                                }

                                // server accept session
                                case 6: {
                                    log("handshake complete, connected session " + session.publicKey);
                                    
                                    if (session.existingSession) {
                                        oSession = session.existingSession;
                                    } else {
                                        oSession = new ProtoV2Session(session.publicKey, true);
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
                                                if (!oSession!.qos1Accepted.has(dupID!)) oSession!.qos1Buffer.push([dupID!, data]);
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
                                        for (let packet of oSession!.qos1Buffer) {
                                            handleDataSend(1, packet[1], packet[0]);
                                        }
                                    }

                                    // Hook up the connection
                                    oSession.on("data_ret", handleDataSend);

                                    // Send all queued data
                                    handleDataRequeue();
                                    oSession.on("qos1:queued", handleDataRequeue);

                                    njsStream.on("close", () => {
                                        log("disconnected");
                                        oSession!.removeListener("data_ret", handleDataSend);
                                        oSession!.removeListener("qos1:queued", handleDataRequeue);

                                        setTimeout(() => {
                                            if (oSession.listenerCount("data_ret") === 0) {
                                                oSession.emit("close");
                                                oSession.removeAllListeners();
                                                oSession = null;
                                                protov2._activeListen[appID].delete(data[1]);
                                            }
                                        }, protov2.config.resumptionWait);
                                    });

                                    resolve([data[1], oSession]);
                                }
                            }
                        } else {
                            log("terminated connection: unexpected handshake bytes");
                            njsStream.end();
                        }
                    }
                }
            } catch (e) {
                log(e);
                njsStream.end();
            }
        });

        njsStream.on("close", () => {
            reject(new Error("connection closed"));
        });

        njsStream.write(Uint8Array.from([0x02, 0xC0]));
    });
}