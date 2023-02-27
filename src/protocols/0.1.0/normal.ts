import type ProtoV2 from "../..";
import type { Connection, Stream } from "@libp2p/interface-connection";

import debug from "debug";
import { decode, encode } from "msgpack-lite";
import { kyber } from "kyber-crystals";
import { superDilithium } from "superdilithium";
import { convertLibp2pStream } from "../../stream_wrapper.js";
import { randomString } from "../../utils.js";

const log = debug("protov2:proto:0.1.0");

// Compatibility with both NodeJS and Browser
const SubtleCrypto = globalThis.crypto.subtle;

export default (protov2: ProtoV2, appID: string, connection: Connection, stream: Stream) => {
    log(`connection from ${connection.remotePeer.toString()} connecting to ${appID}`);

    let njsStream = convertLibp2pStream(stream);
    let handshaked = false;
    let randomVerifyString = "";
    let asymmKey: { privateKey: Uint8Array, publicKey: Uint8Array } | null = null;
    let encryptionKey: CryptoKey | null = null;

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
                return decode(new Uint8Array(decryptedData));
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
                                        Array.from(keyPair.publicKey).map((x) => x.toString(16)).join(""),
                                        Array.from(signature).map((x) => x.toString(16)).join("")
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
                                    
                                    // TODO: handle data
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
                }
            }
        } catch {

        }
    });
}